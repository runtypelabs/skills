#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skillsDir = path.join(root, 'skills')
const failures = []

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

function exists(file) {
  return fs.existsSync(file)
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return {}

  const data = {}
  const lines = match[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const kv = lines[i].match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/)
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function skillDirs(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

function filesInTree(dir) {
  const files = []
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      if (entry.isFile()) files.push(full)
    }
  }
  return files.sort((a, b) => a.localeCompare(b))
}

function assertInside(baseDir, target, label) {
  const relative = path.relative(baseDir, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    failures.push(`${label}: resolves outside the standalone skill install`)
    return false
  }
  return true
}

function checkOpenAiYaml(skillName, skillDir) {
  const file = path.join(skillDir, 'agents/openai.yaml')
  if (!exists(file)) {
    failures.push(`${skillName}: standalone install is missing agents/openai.yaml`)
    return
  }

  const text = read(file)
  for (const key of ['display_name:', 'short_description:', 'default_prompt:']) {
    if (!text.includes(key)) failures.push(`${file}: missing interface.${key.replace(':', '')}`)
  }

  const exactSkillToken = new RegExp(
    `(^|[^A-Za-z0-9_-])\\$${escapeRegExp(skillName)}(?![A-Za-z0-9_-])`
  )
  if (!exactSkillToken.test(text)) {
    failures.push(`${file}: default_prompt must mention $${skillName}`)
  }
}

function checkStandaloneLocalReferences(skillName, skillDir) {
  const localPathPattern =
    /(?:\]\(|`)(\.{1,2}\/[^`)`\s]+|references\/[^`)`\s]+|scripts\/[^`)`\s]+|agents\/[^`)`\s]+)(?:\)|`)/g

  for (const file of filesInTree(skillDir).filter((item) => /\.(md|ya?ml)$/.test(item))) {
    const text = read(file)
    for (const match of text.matchAll(localPathPattern)) {
      const target = match[1]
      const resolved = path.resolve(path.dirname(file), target)
      const label = `${file}: local reference ${target}`
      if (!assertInside(skillDir, resolved, label)) continue
      if (!exists(resolved)) {
        failures.push(`${label} does not exist in standalone install of ${skillName}`)
      }
    }
  }
}

const skillNames = skillDirs(skillsDir)
if (skillNames.length === 0) failures.push('No skills found under skills/')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtype-skills-smoke-'))
const installedRoot = path.join(tempRoot, 'skills')
fs.mkdirSync(installedRoot, { recursive: true })

for (const skillName of skillNames) {
  const source = path.join(skillsDir, skillName)
  const installed = path.join(installedRoot, skillName)
  fs.cpSync(source, installed, { recursive: true })

  const skillFile = path.join(installed, 'SKILL.md')
  if (!exists(skillFile)) {
    failures.push(`${skillName}: standalone install is missing SKILL.md`)
    continue
  }

  const frontmatter = parseFrontmatter(read(skillFile))
  if (frontmatter.name !== skillName) {
    failures.push(`${skillFile}: frontmatter name must match standalone skill directory`)
  }
  if (!frontmatter.description) {
    failures.push(`${skillFile}: missing description`)
  }

  checkOpenAiYaml(skillName, installed)
  checkStandaloneLocalReferences(skillName, installed)
}

if (failures.length) {
  for (const failure of failures) console.error(`error: ${failure}`)
  process.exit(1)
}

console.log(`ok: ${skillNames.length} skills passed standalone install smoke test`)
