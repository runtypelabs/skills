#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skillsDir = path.join(root, 'skills')
const coreDir = path.resolve(root, '../core')

const failures = []
const warnings = []

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

function exists(file) {
  return fs.existsSync(file)
}

function filesInDir(dir) {
  if (!exists(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
}

function parseFrontmatter(text, file) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) {
    failures.push(`${file}: missing YAML frontmatter`)
    return {}
  }

  const frontmatter = match[1]
  const lines = frontmatter.split('\n')
  const data = {}

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const kv = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/)
    if (!kv) continue

    const key = kv[1]
    let value = (kv[2] ?? '').trim()

    if (value === '>-' || value === '>' || value === '|') {
      const parts = []
      i += 1
      while (i < lines.length && (/^\s+/.test(lines[i]) || lines[i].trim() === '')) {
        if (lines[i].trim()) parts.push(lines[i].trim())
        i += 1
      }
      i -= 1
      value = parts.join(' ')
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    data[key] = value
  }

  return data
}

function skillFiles() {
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      dir: path.join(skillsDir, entry.name),
      file: path.join(skillsDir, entry.name, 'SKILL.md'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function checkLinkedReferences(skillDir, text, file) {
  const matches = text.matchAll(/(?:\]\(|`)([^`)`\s]*references\/[A-Za-z0-9._/-]+\.md)/g)
  for (const match of matches) {
    const target = match[1]
    const resolved = path.resolve(skillDir, target)
    if (!exists(resolved)) {
      failures.push(`${file}: linked reference does not exist: ${target}`)
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function checkOpenAiYaml(skillName, skillDir) {
  const file = path.join(skillDir, 'agents/openai.yaml')
  if (!exists(file)) {
    failures.push(`${skillName}: missing agents/openai.yaml`)
    return
  }
  const text = read(file)
  for (const key of ['display_name:', 'short_description:', 'default_prompt:']) {
    if (!text.includes(key)) failures.push(`${file}: missing interface.${key.replace(':', '')}`)
  }
  const skillTokenPattern = new RegExp(
    `(^|[^A-Za-z0-9_-])\\$${escapeRegExp(skillName)}(?![A-Za-z0-9_-])`
  )
  if (!skillTokenPattern.test(text)) {
    failures.push(`${file}: default_prompt must mention $${skillName}`)
  }
}

function checkForbiddenContent(file, text) {
  const forbiddenInternalUrl = /(?:https?:\/\/)?[A-Za-z0-9.-]*runtype-staging\.com\b/i
  if (forbiddenInternalUrl.test(text)) {
    failures.push(`${file}: contains forbidden internal staging URL`)
  }

  const leakedSecretPatterns = [
    /\b(?:rt_live|rt_test|tv)_[A-Za-z0-9]{16,}\b/,
    /\bsk-[A-Za-z0-9]{20,}\b/,
    /\bBearer\s+(?!\{\{secret:)[A-Za-z0-9._-]{24,}\b/,
  ]

  for (const pattern of leakedSecretPatterns) {
    if (pattern.test(text)) {
      failures.push(`${file}: contains a value that looks like a real secret`)
      break
    }
  }
}

function allSkillText(files) {
  const chunks = []
  for (const skill of files) {
    const stack = [skill.dir]
    while (stack.length) {
      const current = stack.pop()
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) stack.push(full)
        if (entry.isFile() && /\.(md|yaml|json)$/.test(entry.name)) chunks.push(read(full))
      }
    }
  }
  return chunks.join('\n')
}

function extractArrayStrings(text, constName) {
  const block = text.match(new RegExp(`const ${constName}:[\\s\\S]*?= \\[([\\s\\S]*?)\\]`, 'm'))
  if (!block) return []
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
}

function extractObjectLiteralBody(text, constName) {
  const match = new RegExp(`const\\s+${constName}\\b[\\s\\S]*?=\\s*\\{`, 'm').exec(text)
  if (!match) return ''

  const start = match.index + match[0].lastIndexOf('{')
  let depth = 0
  let quote = null
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        i += 1
      }
      continue
    }

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '/' && next === '/') {
      lineComment = true
      i += 1
      continue
    }

    if (char === '/' && next === '*') {
      blockComment = true
      i += 1
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start + 1, i)
    }
  }

  return ''
}

function extractMapKeys(text, constName) {
  const body = extractObjectLiteralBody(text, constName)
  if (!body) return []
  return [...body.matchAll(/^ {2}(?:'([^']+)'|([A-Za-z][A-Za-z0-9_-]*))\s*:/gm)].map(
    (match) => match[1] || match[2]
  )
}

function checkCoreDrift(files) {
  if (!exists(coreDir)) {
    warnings.push('Skipping core drift checks because ../core is not present')
    return
  }

  const text = allSkillText(files)
  const surfacesDoc = path.join(skillsDir, 'runtype/references/surfaces.md')
  const flowStepsDoc = path.join(skillsDir, 'runtype/references/flow-steps.md')

  const surfaceSource = path.join(
    coreDir,
    'packages/shared/src/product-generation/surface-type-metadata.ts'
  )
  if (exists(surfaceSource) && exists(surfacesDoc)) {
    const surfaceNames = [
      ...read(surfaceSource).matchAll(/^\s{2}([a-zA-Z0-9_]+): \{/gm),
    ].map((match) => match[1])
    const surfacesText = read(surfacesDoc)
    for (const name of surfaceNames) {
      if (!surfacesText.includes(`### \`${name}\``)) {
        failures.push(`${surfacesDoc}: missing surface section for ${name}`)
      }
    }

    const validatorSource = path.join(
      coreDir,
      'packages/shared/src/product-generation/validators/surface-validator.ts'
    )
    if (exists(validatorSource)) {
      const validatorBlock = read(validatorSource).match(/VALID_SURFACE_TYPES[\s\S]*?new Set\(\[([\s\S]*?)\]\)/)
      if (validatorBlock) {
        const validatorNames = [...validatorBlock[1].matchAll(/'([^']+)'/g)].map(
          (match) => match[1]
        )
        const missingInValidator = surfaceNames.filter((name) => !validatorNames.includes(name))
        if (missingInValidator.length) {
          warnings.push(
            `Core surface validator is missing surface metadata types: ${missingInValidator.join(', ')}`
          )
        }
      }
    }
  }

  const stepSource = path.join(coreDir, 'packages/shared/src/flow-step-types.ts')
  if (exists(stepSource) && exists(flowStepsDoc)) {
    const stepNames = extractArrayStrings(read(stepSource), 'CONTEXT_STEP_TYPES')
    const flowStepsText = read(flowStepsDoc)
    for (const name of stepNames) {
      if (!flowStepsText.includes(`### \`${name}\``)) {
        failures.push(`${flowStepsDoc}: missing flow step section for ${name}`)
      }
    }
  }

  const docSource = path.join(
    coreDir,
    'packages/shared/src/product-generation/mcp-tool-resources.ts'
  )
  if (exists(docSource)) {
    const topics = extractMapKeys(read(docSource), 'DOCUMENTATION_TOPIC_MAP')
    for (const topic of topics) {
      if (!text.includes(topic)) {
        failures.push(`skills/: missing MCP documentation topic mention: ${topic}`)
      }
    }
  }

  const catalogSource = path.join(
    coreDir,
    'packages/shared/src/product-generation/mcp-catalog-data.ts'
  )
  if (exists(catalogSource)) {
    const promptBlock = read(catalogSource).match(
      /export const MCP_PROMPT_DEFINITIONS:[\s\S]*?= \[([\s\S]*?)\n\]/
    )
    const prompts = promptBlock
      ? [...promptBlock[1].matchAll(/^\s{4}name: '([^']+)'/gm)].map((match) => match[1])
      : []
    for (const prompt of prompts) {
      if (!text.includes(prompt)) {
        failures.push(`skills/: missing MCP prompt mention: ${prompt}`)
      }
    }

    const resources = [...read(catalogSource).matchAll(/uri: '(runtype:\/\/[^']+)'/g)].map(
      (match) => match[1]
    )
    const missingResources = resources.filter((resource) => !text.includes(resource))
    if (missingResources.length) {
      warnings.push(`MCP resource URIs not mentioned explicitly: ${missingResources.join(', ')}`)
    }
  }
}

function checkSemanticAssertions(files) {
  const docs = {
    persona: path.join(skillsDir, 'runtype/references/persona-widget.md'),
    primitives: path.join(skillsDir, 'runtype/references/primitives.md'),
    recipes: path.join(skillsDir, 'runtype/references/recipes.md'),
    workingModes: path.join(skillsDir, 'runtype/references/working-modes.md'),
  }
  const text = allSkillText(files)

  function failIfAnySkillMatches(pattern, message) {
    if (pattern.test(text)) failures.push(`skills/: ${message}`)
  }

  function requireText(file, pattern, message) {
    if (exists(file) && !pattern.test(read(file))) {
      failures.push(`${file}: ${message}`)
    }
  }

  failIfAnySkillMatches(
    /YOUR_SURFACE_KEY|Surface key from Runtype dashboard/i,
    'Persona guidance must use client-token terminology, not surface-key terminology'
  )
  requireText(
    docs.persona,
    /create_client_token[\s\S]*not a surface key|not a surface key[\s\S]*create_client_token/i,
    'Persona embed docs must explicitly say client tokens are created with create_client_token and are not surface keys'
  )

  failIfAnySkillMatches(
    /default high|30-50 is typical|Default to high `maxToolCalls`|30x faster|300ms vs 10s|short-lived `clientToken`/i,
    'guidance contains an outdated or unsupported runtime assertion'
  )
  requireText(
    docs.primitives,
    /maxToolCalls[\s\S]*default is 10/i,
    'agent primitive docs must state the current maxToolCalls default'
  )

  failIfAnySkillMatches(
    /`maxTurns`: 5|client token[^.\n]*short-lived|short-lived[^.\n]*(?:clientToken|client token)|`behavior` lists the tools to expose/i,
    'guidance contains an outdated MCP, agent-loop, or client-token assertion'
  )
  requireText(
    docs.recipes,
    /add_surface_item[\s\S]*Each bound capability becomes an MCP tool/i,
    'MCP surface recipe must describe capability-to-surface-item wiring'
  )

  failIfAnySkillMatches(
    /100% API coverage|Zero telemetry|No phone home/i,
    'guidance contains absolute API coverage or telemetry claims that must stay conditional'
  )
  requireText(
    docs.workingModes,
    /Standalone deployments can run silent by omitting or disabling telemetry/i,
    'on-prem docs must describe telemetry as configurable rather than absolutely absent'
  )
}

function checkActivationSmoke(files) {
  const byName = new Map(
    files.map((skill) => [skill.name, read(skill.file).toLowerCase()])
  )
  const expected = [
    ['runtype-build-product', ['slack', 'product']],
    ['runtype-persona', ['chat widget', 'persona']],
    ['runtype-templates', ['fpo', 'template']],
    ['runtype-admin', ['debug', 'flow']],
    ['runtype-sdk-marathon', ['marathon', 'cli']],
  ]

  for (const [skill, words] of expected) {
    const text = byName.get(skill)
    if (!text) {
      failures.push(`activation smoke: missing expected skill ${skill}`)
      continue
    }
    for (const word of words) {
      if (!text.includes(word)) failures.push(`activation smoke: ${skill} missing "${word}"`)
    }
  }

  const descriptions = files
    .map((skill) => parseFrontmatter(read(skill.file), skill.file).description ?? '')
    .join('\n')
    .toLowerCase()
  if (descriptions.includes('vercel ai sdk')) {
    failures.push('activation smoke: generic Vercel AI SDK should not trigger Runtype skills')
  }
}

const files = skillFiles()

for (const skill of files) {
  if (!exists(skill.file)) {
    failures.push(`${skill.name}: missing SKILL.md`)
    continue
  }

  const text = read(skill.file)
  const fm = parseFrontmatter(text, skill.file)

  if (fm.name !== skill.name) {
    failures.push(`${skill.file}: frontmatter name "${fm.name}" must match directory "${skill.name}"`)
  }

  if (!fm.description) {
    failures.push(`${skill.file}: missing description`)
  } else if (fm.description.length > 1024) {
    failures.push(`${skill.file}: description is ${fm.description.length} chars; max is 1024`)
  }

  if (text.split('\n').length > 500) {
    failures.push(`${skill.file}: SKILL.md exceeds 500 lines`)
  }

  checkForbiddenContent(skill.file, text)
  checkLinkedReferences(skill.dir, text, skill.file)
  checkOpenAiYaml(skill.name, skill.dir)
}

for (const file of [
  path.join(root, 'README.md'),
  path.join(root, '.claude-plugin/plugin.json'),
  path.join(root, '.codex-plugin/plugin.json'),
  ...filesInDir(path.join(root, 'docs')),
  ...filesInDir(path.join(skillsDir, 'runtype/references')),
]) {
  if (exists(file)) checkForbiddenContent(file, read(file))
}

checkCoreDrift(files)
checkSemanticAssertions(files)
checkActivationSmoke(files)

for (const warning of warnings) {
  console.warn(`warn: ${warning}`)
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`error: ${failure}`)
  }
  process.exit(1)
}

console.log(`ok: ${files.length} skills passed lint`)
