---
name: tool-design
description: >-
  Use when designing, building, or reviewing tools that an AI agent will call: MCP
  server tools, function-calling schemas, agent toolkits, runtime tools, or an API
  being wrapped for an LLM. Covers classifying a tool (query, command, discovery;
  sync or async; atomic to orchestrated), the four rules every tool must satisfy, a
  pre-ship checklist, and an audit procedure for an existing tool set. Routes deeper
  work to tool-design-interface, tool-design-output, tool-design-errors,
  tool-design-composition, tool-design-execution, and tool-design-security. Trigger
  phrases: "design a tool", "tool schema", "MCP tool", "function calling", "agent
  can't figure out which tool", "review my tools", "why does the agent keep retrying".
user-invocable: true
argument-hint: '[tool or tool set to design or review]'
---

# Tool Design

A tool that returns correct data can still fail in production because the agent could
not tell when to call it, what to pass, or what to do with the result. "Working" is not
the same as "agent-usable". This skill family treats the agent as the consumer and
designs for it.

The guidance is framework-neutral: it applies to MCP servers, native function calling,
Runtype runtime tools, and any custom loop. It is organized as 54 named patterns across
ten questions; `references/pattern-index.md` maps every pattern to the skill that owns
it.

## The consumer changed, so the design rules changed

| Aspect        | Integration middleware | Agent tools                             |
| ------------- | ---------------------- | --------------------------------------- |
| Consumer      | Applications           | An LLM                                  |
| Routing       | Predetermined flows    | Chosen by the agent at runtime          |
| Errors        | Dead-letter queue      | Recovery guidance the agent can act on  |
| Documentation | Written for humans     | Written for machine comprehension       |
| Composition   | Orchestrated by a bus  | Chained by the agent, non-deterministic |

Nothing enforces sequence for the agent. The tool descriptions, parameter shapes, result
shapes, and error messages are the only orchestration layer there is.

## Four rules that apply to every tool

1. **Design for the model, not the human.** Names, descriptions, parameter names, and
   error text are read by an LLM. Be literal, structured, and complete.
2. **Prompts express intent; code enforces rules.** Authorization, secrets, boundaries,
   and audit live in the tool layer. Never rely on the agent to police itself.
3. **Errors teach, not just fail.** Every failure says what went wrong, why, and the
   exact next call to make.
4. **Hint at what comes next.** Descriptions and results name prerequisites and
   follow-ups so the agent builds the workflow without trial and error.

## Procedure: design a new tool

1. **Classify it** on the three axes and write the answers down before writing a schema:
   - Type: `query` (read-only, retryable, cacheable), `command` (side effects, document
     irreversibility), or `discovery` (reveals what exists, schema, capabilities).
   - Integration: API, database, file system, or system operation. Databases and
     command tools need idempotency because agents retry on timeout.
   - Access pattern: synchronous (most tools; bounded seconds), async job (minutes;
     return a job id), streaming, or event-driven.
   - Maturity: start **atomic**. Move to enhanced, composite, or orchestrated only
     when traces show the signal (see "Level up on evidence").
2. **Write the interface** with `tool-design-interface`: a verb-object name, a description
   that says when to use it and when not to, constrained parameters, smart defaults,
   natural identifiers, and dependency hints.
3. **Shape the result** with `tool-design-output`: flat, token-efficient, paginated by
   cursor, summary by default, with GUI links and a next-action hint.
4. **Design the failure paths** with `tool-design-errors`: classify every error as
   retryable, permanent, needs-user-input, or needs-auth, and attach recovery steps.
5. **Decide execution semantics** with `tool-design-execution`: timeout, idempotency
   key, transaction or compensation, async job when work exceeds the sync budget.
6. **Lock the boundary** with `tool-design-security`: secrets injected server-side,
   permission checks in code, declared scopes, audit log, identity anchor.
7. **Place it in the set** with `tool-design-composition`: does it bundle a common
   sequence, accept a batch, offer preview mode, sit on an abstraction ladder?
8. **Test it as the agent would.** Call it with the inputs an LLM will plausibly send
   (natural-language dates, display names instead of ids, a single item where an array
   is expected) and read the errors back as if you knew nothing but the description.

## Procedure: review an existing tool set

Run this when asked to audit, review, or "figure out why the agent misuses" a toolkit.

1. **Inventory.** List every tool with type (query/command/discovery), parameter count,
   required-parameter count, and whether it has side effects. Flag any tool whose type
   is not obvious from its name.
2. **Read every description as the model.** For each tool, answer only from the
   description: when do I call this? what do I need first? what do I get back? If any
   answer is unclear, that is a finding.
3. **Check the parameters** against `tool-design-interface`: free-form strings that
   should be enums, required parameters that could default, ids where a natural
   identifier would do, secrets accepted as parameters (a security finding, not a
   style one), ambiguous "one of X or Y" pairs without enforcement.
4. **Check the results** against `tool-design-output`: raw upstream payloads, nested
   blobs, unbounded lists, missing `hasMore` and cursor, no GUI link, batch results
   that collapse to all-or-nothing.
5. **Check the errors** against `tool-design-errors`: raw status codes, messages with
   no next step, no retryable/permanent distinction, ambiguity resolved by guessing.
6. **Check execution and security** against `tool-design-execution` and
   `tool-design-security`: command tools with no idempotency story, work that cannot
   finish inside the timeout, permission logic in the system prompt, no audit trail.
7. **Check the set as a whole** against `tool-design-composition`: near-duplicate tools,
   sequences the agent always performs together (bundle candidates), N-item loops
   (batch candidates), destructive tools without a preview mode, more tools than the
   model can hold in context at once.
8. **Report** findings as a table: tool, pattern violated, severity (blocks the agent /
   degrades reliability / polish), concrete fix. Lead with the findings that make the
   agent choose the wrong tool or fail to recover; those dominate observed failures.

## Level up on evidence, not ambition

Start atomic and watch traces. Each signal maps to a specific move:

| Signal in traces                               | Move                                            |
| ---------------------------------------------- | ----------------------------------------------- |
| High retry rate on one tool                    | Fix description and error guidance first        |
| The same tool sequence repeated across runs    | Bundle it into a task tool                      |
| Per-item loops over the same tool              | Add a batch variant                             |
| Partial completion of multi-step operations    | Add a transaction boundary or compensation      |
| Agent calls a tool it lacks prerequisites for  | Add dependency hints and a discovery tool       |
| Agent picks the wrong one of two similar tools | Merge them or sharpen the "use when / not when" |
| Long-running calls time out                    | Convert to an async job                         |

Do not build the orchestrated version first. Composite tools built before atomic usage
is understood encode guesses about workflows the agent never runs.

## Pre-ship checklist

Every tool must pass all of these before it reaches an agent:

- Name is verb-object and unambiguous next to every sibling tool.
- Description says what it does, when to use it, when not to, and what to call first.
- Every string input that has a finite set of valid values is an enum.
- Every optional parameter has a documented default; required parameters are minimal.
- Human-friendly identifiers are accepted and resolved internally.
- Result is flat, token-efficient, and consistent in shape across calls.
- Large results are cursor-paginated with an explicit `hasMore`.
- Errors carry a class (retryable / permanent / user input / auth) and a next step.
- Command tools state whether they are idempotent and how.
- Secrets are injected from context, never accepted as parameters.
- Permission checks run in code before the operation.
- Invocations are logged with redacted parameters.
- Destructive or costly commands are gated (approval, preview mode, or both).

`references/checklist.md` carries the same list with the pattern each row comes from.

## On Runtype

The rules are the same; the platform provides the enforcement:

- Runtime tools are defined by `name`, `description`, `parametersSchema` (JSON Schema),
  a `toolType` (`external`, `custom`, `mcp`, `local`, `flow`, `subagent`, and more),
  and `config`. Create and test them with the MCP tools `create_tool`, `execute_tool`,
  and `validate_flow`; read `get_platform_documentation(topic="external-tools")` and
  `get_platform_documentation(topic="limits")` before designing.
- Credentials are `{{secret:KEY}}` references resolved server-side; hidden parameters
  (`hiddenParameterNames`) are stripped from the model-facing schema and re-injected
  at execution. Both are the platform's secret-injection and context-injection seams.
- Approval gates (`config.tools.approval.require`) are the permission gate for
  irreversible or costly commands. The agent-supplied approval reason is display-only
  and never a control signal.
- Tool calls cap at 30 seconds. Longer work belongs in a flow step or a subagent, which
  is the platform's async-job shape.
- A request carries at most 50 runtime tools, and tool search activates at 20, after
  which rarely used tools are found by search rather than seen up front. Fewer,
  better-described tools beat many near-duplicates.

## Do not

- Do not accept credentials, tokens, or tenant ids as model-visible parameters.
- Do not return the raw upstream payload.
- Do not return a bare status code or exception string as the error.
- Do not write descriptions for the developer reading the code.
- Do not build composite tools before atomic usage is observed.
- Do not put access-control rules only in the system prompt.
