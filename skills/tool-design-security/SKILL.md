---
name: tool-design-security
description: "Design or audit a tool's trust boundary: keep API keys and tenant ids out of model-visible parameters, resist prompt injection, enforce permissions and approval gates in code, declare scopes, and log calls safely."
---

# Tool Security and Context Design

Prompts express intent; code enforces rules. An agent under prompt injection will try
to call the wrong tool with the wrong arguments and will produce a persuasive reason
for doing so. The only defenses that hold are the ones the tool layer enforces without
consulting the model.

Tool results are a common way in. A result can carry text that a user or a third party
wrote, and the model reads it in the same context as your instructions.

## Procedure

1. **Name the principal.** Who is the tool acting as: a user, a service account, an
   organization? Where does that identity come from (session, token, context object)?
2. **Route every credential through injection.** No secret, token, or key is ever a
   model-visible parameter.
3. **Write the permission check in code**, before the operation, for both the action
   ("can this principal delete users") and the target ("this user, in this org").
4. **Declare scopes** per tool and pre-check them.
5. **Fix the boundary**: tenant, root path, allowed hosts, quotas.
6. **Log every invocation** with redacted parameters.
7. **Decide what context to inject** automatically (team, timezone, environment) and
   what the agent must establish itself through an identity anchor.

## Rules with examples

### Treat tool results as untrusted data

Sanitize tool output and validate it before it reaches the model. Mark results that
carry user-authored or third-party text. A result never authorizes the next action: an
instruction found in a result gets the same permission checks as any other call.

### Secrets never pass through the model (Secret Injection)

Before (the key is in the schema, so it is in the prompt, the trace, and the transcript):

```json
{
  "name": "call_api",
  "parameters": { "apiKey": { "type": "string" }, "endpoint": { "type": "string" } }
}
```

After (the key is resolved from server-side context at execution, and the host is fixed
in config so the model cannot send the credential anywhere else):

```json
{
  "name": "call_api",
  "parameters": { "resource": { "type": "string", "enum": ["orders", "invoices"] } },
  "config": {
    "url": "https://api.example.com/{{resource}}",
    "headers": { "Authorization": "Bearer {{secret:SERVICE_API_KEY}}" }
  }
}
```

Store credentials encrypted at rest, resolve them at call time, log the access, and
never log or return the value. If a parameter's only purpose is to carry a credential
or a trust decision, it is not a parameter.

### Access control lives in code (Permission Gate)

Check permissions at the top of execution, on the principal from context, not from any
argument the model supplied. Check the action and the target. Deny with a `permanent`
error that names the required role, and log every denial. Re-authenticating does not
fix a missing role, so reserve `authRequired` for a missing or expired credential or scope.

```text
if "admin" not in principal.roles: deny(required="admin")
if target.orgId != principal.orgId: deny(reason="outside your organization")
```

A system prompt that says "never delete users" is a UX hint, not a control. Approval
gates on destructive or costly commands are a backstop for residual risk, not a
substitute for least-privilege tool selection; gate the few dangerous calls, not
everything, or the human learns to rubber-stamp.

### Declare the scopes each tool needs (Scope Declaration)

List the minimum required scopes and any optional ones in the tool definition and in
the description ("Requires `gmail.send`"). Pre-check before the upstream call and return
an `authRequired` error that names the missing scope and how to re-authenticate. Use
the narrowest scope that works; different tools in the same set can require different
scopes.

An MCP server over HTTP reports a missing scope at run time with `403 Forbidden` and a
`WWW-Authenticate: Bearer error="insufficient_scope"` header. The header's `scope`
parameter lists every scope the operation needs, in one challenge, and the client runs
step-up authorization to get them.

### Every call is logged (Audit Trail)

Record what (tool name, parameters with secrets and PII redacted), who (principal,
session), when, and the result (success or failure, duration, error class). Set a
retention period. This is how abuse is detected and how "why did the agent do that" is
answered later.

### The agent can ask who it is (Identity Anchor)

Provide a `who_am_i` discovery tool that returns the principal's id, name, roles,
permissions, and team or organization, and either recommend it as the first call in
tool descriptions or run it automatically and inject the result into the system prompt.
Cache it for the session. Downstream tools reference the ids it returns.

### State across calls is explicit (Session Context)

MCP revision 2026-07-28 removed protocol sessions. When tools share working state
(current project, selected account, scope), have the server mint an opaque handle and
pass it as an argument to the calls that use it:

- A handle names state. It does not authenticate the caller, so check authorization
  on every call that uses it.
- State how long a handle lives. An expired handle returns a tool execution error that
  says how to get a new one.
- Echo the active context in results so the agent and the user can see what scope a
  call ran in.

### Inject what the agent would not think to ask for (Context Injection)

Presentation context (timezone, locale, region) is supplied from context by default and
may be overridden by explicit parameters. Feature flags, entitlements, and authorization
scope (team, organization, tenant) are also injected from context, but the model can
never override them: a tool that needs to act on another team resolves that through the
permission gate, not through a parameter. Document what is injected, return the
effective values in the response, and expand machine ids to names where a human will
read the result.

### Boundaries are enforced, not described (Context Boundary)

File tools resolve every path against a root and refuse anything outside it. Data tools
carry a tenant scope from context and never accept one from the model. Network tools
check hosts against an allowlist. Quotas and rate limits are applied in the tool layer.
Violations return a clear, logged error.

## Anti-patterns

- `apiKey`, `token`, `tenantId`, or `actAsUserId` as model-visible parameters.
- Authorization decided by reading the agent's stated reason for a call.
- Permission rules that exist only in the system prompt.
- A file tool that joins a user-supplied path without checking it stays under the root.
- Logging full parameters, including the secret that was injected.
- One broad OAuth scope for the whole server because it was easier.

## On Runtype

- **Principal.** Your server passes `tenant: { id }` and `endUser: { id }` on dispatch or
  agent execute. Tools read them as `{{_tenant.id}}` and `{{_endUser.id}}`, next to
  `{{_user.id}}` for your own account. A plain `tenant` or `endUser` value is asserted by
  the caller, so set it only from a trusted server, never from a model argument. From a
  browser, or to prove who the user is, send `identityProof` instead, and set
  `config.tenancyStrategy` on the saved agent to require that identity. Use `.id`, not
  `.projectedId`.
- **Principal your API can verify.** When your API must check the identity itself, put
  `Authorization: Bearer {{_identity.token}}` on an `external` tool (or an inline MCP
  server header). Runtype signs a five-minute ES256 JWT per call with `aud` = the tool's
  fixed host and `iss` = `https://api.runtype.com/orgs/<organizationId>`; the model never
  sees it. It is minted only for an agent with `tenancyStrategy` and a resolved identity.
  The receiver must verify against `https://api.runtype.com/.well-known/jwks.json` and pin
  `iss` to its own customer's org, because every org shares the signing key.
- **Secrets.** `{{secret:KEY}}` references resolve from the managed secret store at
  execution and are the only credential contract. They resolve in `external` tool
  `url`, `headers`, and `body`; in the HTTP flow steps (`fetch-url`, `api-call`,
  `wait-until`, `paginate-api`); and in custom MCP server auth (`token`, `username`,
  `password`, `headers` values, and OAuth client credentials). They do not resolve in
  prompts, code, or a saved MCP tool's config. Full list:
  https://docs.runtype.com/user-guide/settings/managing-secrets
  - For an `external` tool, put the credential in a header, for example
    `"Authorization": "Bearer {{secret:KEY}}"`. No executor reads an auth field on an
    `external` tool.
  - A runtime tool of any other type (`custom`, `flow`, `local`) that contains a
    `{{secret:KEY}}` reference is rejected with 400. A `custom` tool can instead declare
    managed secrets in `config.secrets`, which needs `SECRETS:READ`. Otherwise, move the
    credential into an `external` tool.
  - An API key that dispatches runtime tools with secret references needs `SECRETS:READ`
    (or `SECRETS:*`), or the request fails with 403.
  - Before a run, call `check_secrets` with the referenced keys to confirm none is
    missing or revoked.
  - Never collect secret values in chat. Hand users the dashboard intake URL from
    `get_secret_intake_manifest`, and create pending secrets with `create_secret` (no
    `value`) so the reference resolves once the owner fills it in.
- **Context injection.** `hiddenParameterNames` on a runtime tool (the same field in the
  API, SDK, and product definitions) removes those parameters from the schema the model
  sees and fills them from execution variables or `_record.metadata`. Names that start
  with `_internal` are rejected.
- **Least privilege.** Enable only the tools the agent needs in `toolIds`. On a custom
  MCP server, set `allowedTools` so the model sees only the listed tools, not the
  server's whole catalog.
- **Local tools.** A `local` tool runs in the caller's client (SDK or Persona), outside
  your server. Put no credentials or authorization decisions in it, and treat its result
  as untrusted input. Enforce permissions in an `external` tool or your own backend.
- **Boundaries.** Cap calls with `tools.maxToolCalls` (1 to 100 per turn). A call past
  the cap gets the tool error `Tool call limit of N reached`. Bound the loop with
  `loopConfig.maxTurns` or `loopConfig.maxCost`. For expensive or destructive tools,
  enforce a per-tool budget inside the tool. Do not set `tools.perToolLimits`: it is
  retired. A save reports it as an advisory, and dispatch refuses the agent. Runtype caps a
  request's serialized `runtimeTools` at 1 MB and does not cap the tool count, so a
  smaller tool set is not an injection defense. Pin the host in an external tool's `url`
  instead of accepting it as a parameter.
- **Permission gate.** `config.tools.approval` pauses gated tool calls for a human:
  - `require` takes tool names or patterns (`mcp:*`, `builtin:*`), or `true` for every
    tool. Prefer the list.
  - `timeout` is in milliseconds (default 300000, five minutes).
  - `requestReason` (on by default) asks the model for a justification, carried as the
    reserved `_approvalReason` parameter. The reason is display-only and must never
    drive the decision.
  - `choices` (`alwaysAllow`, `alwaysDeny`, both off by default) offers persistent
    decisions at the prompt. List remembered grants with
    `GET /v1/tool-approval-grants?agentId=` and revoke one with
    `DELETE /v1/tool-approval-grants/{id}`. Review them when you tighten a tool.
  - The approver answers with `POST /v1/dispatch/approve` (or
    `POST /v1/agents/{id}/approve` for a saved agent).
  - Approval needs someone to answer it. API dispatch, agent execute, and the Product
    API wait for the approve call. AG-UI answers through an interrupt and `resume[]`.
    Slack, Telegram, SMS, and iMessage surfaces running a multi-turn agent collect the
    decision in the conversation.
  - Product chat refuses every approval-gated agent with 501
    `APPROVAL_MODE_UNSUPPORTED`. Client-token (Persona) chat refuses them too, except a
    root gate with `tools.approval.approver: "end-user"`, which the Persona visitor
    approves in the widget. Use `end-user` only when the gate asks for the
    visitor's own consent (confirming their order, booking, or message). Keep
    `owner` for gates that enforce your policy or budget (refunds, discounts,
    credits, spend on your account): the visitor must not grant those to themselves.
    Email, schedule, webhook, Discord, and WhatsApp surfaces cannot collect a decision,
    and neither can Slack, Telegram, SMS, or iMessage for a single-pass agent. Watch
    for the `APPROVAL_UNANSWERABLE_ON_SURFACE` warning when you save an agent or bind it
    to a surface; on those surfaces, remove the gate and enforce the rule in the tool.
  - A2A and Product MCP surfaces also refuse a run that reaches an approval gate, and
    Claude Managed agents return 501. These surfaces do not raise the save warning, so
    check gated agents on them yourself.
  - Approval covers only tool calls a model chooses in an agent or a prompt step. A flow
    Tool Call step has no approval gate and always runs.
- **Session context.** Keep per-conversation working state (current project, selected
  account) in the conversation's messages or variables, or in a record keyed by
  conversation. Use memory (`save_memory` / `recall_memory`, enabled with
  `config.memory.enabled`) only for facts and preferences that must survive across
  sessions, and scope it with `config.memory.profileTemplate` (for example
  `{{_endUser.id}}`) so one end user's state never reaches another. An agent with a
  `tenancyStrategy` ignores `profileTemplate` and scopes memory by the strategy's
  `dataScope`: per agent for `product`, per tenant for `tenant`, and per end user for
  `end-user`.
- **Audit.** Every tool call is traced on the run (`trace_execution`, `list_logs`).
  Values of parameters listed in `hiddenParameterNames` are redacted in tool-input
  events; every other argument is recorded as sent, so keep PII and secrets out of
  model-visible parameters and results.
- Read `get_platform_documentation(topic="agent-design")` for the approval-gate
  contract and `get_platform_documentation(topic="external-tools")` for the secret
  syntax rules.
