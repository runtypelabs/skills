---
name: runtype-external-agents
description: 'Connect externally executed agents to Runtype traces, evals, or surfaces; not Runtype-hosted execution.'
user-invocable: true
argument-hint: '[framework and what you want from Runtype: traces, evals, chat UI]'
---

# Runtype for agents that run elsewhere

Runtype is a suite of components, not only a hosted runtime. An agent that executes on
the user's own infrastructure can still use Runtype's Runs and Logs, trace trees, cost
estimates, eval capture, Persona chat UI, surfaces, and the MCP-driven improvement loop.
Your job is to pick the lane that serves what the user actually wants, wire it, and be
precise about what each lane does not do.

If the Runtype MCP server is connected, read
`get_platform_documentation(topic="external-agents")` first; it is the live version of
this skill. Public docs: `https://docs.runtype.com/developer-guides/guides/bring-your-own-agent`.

## Pick a lane (they compose)

| User wants                                                                | Lane                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| See runs, traces, tokens, cost; capture real runs as eval cases           | **A. Push telemetry in** (OTLP to `https://api.runtype.com/v1/otel`)                                          |
| Test the agent from Runtype, put a Persona chat or surface in front of it | **B. Let Runtype call the agent** (`external` agent, `runtype-stream` or A2A endpoint)                        |
| Run an agent authored in Runtype on their own cloud                       | **C. Export** (`export_agent_runtime`, Enterprise-gated preview; do not propose for hackathons or free tiers) |

Capability matrix to state plainly:

- Eval **capture** (`add_eval_case_from_execution`) needs a transcript on the run:
  `gen_ai.input.messages` / `gen_ai.output.messages` on the spans. `@runtypelabs/flue-otel`
  > = 0.5 sends them by default (`content: false` turns them off); 0.4 and earlier never did.
- Eval **re-run** (`run_eval_suite`) needs Runtype to be able to call the agent: an
  `external` agent over A2A works (recorded-tool replay cases are skipped);
  `runtype-stream` endpoints are not eval targets yet. Telemetry-only runs cannot be
  re-run.
- The "fix" step is a change in the user's repository, never `update_agent`.
- The JSON compatibility endpoint `POST /v1/executions/ingest` yields Runs but no trace
  tree; prefer OTLP.

## Prerequisites

1. An agent record that owns the runs: `create_agent` (a plain agent with a model is a
   fine attribution target) or an `external` agent for lane B. Read the `agent_...` id
   back from `list_agents`.
2. A telemetry API key: dashboard **Settings → API Keys → Telemetry Ingest**
   (`TELEMETRY:WRITE`, append-only). No MCP tool mints API keys; `request_api_key` with
   `["TELEMETRY:WRITE"]` files a request a human approves. Never paste key values into
   chat; write them to `.dev.vars`, `wrangler secret put`, or the user's secret store.

## Lane A recipes

**Flue on Cloudflare Workers (zero code).** Flue v2 deployed with `@flue/vite` +
`@cloudflare/vite-plugin` is traced by Workers Observability automatically
(`invoke_agent`, `chat`, `execute_tool` spans, GenAI semantic conventions, conversation
content on by default). Export to Runtype:

1. Cloudflare dashboard → **Workers Observability → add destination**: type Traces,
   endpoint `https://api.runtype.com/v1/otel/v1/traces`, headers
   `Authorization: Bearer rt_...` and `x-runtype-agent-id: agent_...`. Requires a
   Workers Paid plan.
2. `wrangler.jsonc`:
   `{ "observability": { "traces": { "enabled": true, "destinations": ["runtype"], "head_sampling_rate": 1 } } }`
3. `npx vite build && npx wrangler deploy`, then run one conversation and confirm it in
   `list_agent_executions` / `trace_execution`.

To keep prompts and tool payloads out of the export, add
`instrument(createCloudflareTracing({ content: false }))` from `@flue/runtime/cloudflare`
at module scope in `app.ts`, and tell the user this also removes eval capture. Cloudflare
Agents SDK and Think apps use the same destination; Think stores no payloads unless the
agent class sets `storeMessages = true` and `storeTools = true`.

**Flue on Node / Cloud Run / anywhere else.** Point exactly ONE Flue instrumentation at
Runtype (two would double tokens and cost):

- `@runtypelabs/flue-otel` >= 0.5 → `instrument(createRuntypeFlueInstrumentation())`.
  Transcript, system prompt and tool arguments/results by default (each kind has an off
  switch; `content: false` sends none), plus an exact iteration count, run-level stop
  reason and summed usage. Prefer this: the improvement loop and loop analytics in one.
- `@flue/opentelemetry` → `instrument(createOpenTelemetryInstrumentation())`. Exports
  the conversation by default; Runtype derives loop structure from Flue's `flue.*`
  attributes server-side, without the exact iteration count or run-level stop reason.

The app owns the OTel SDK: `NodeTracerProvider` + `BatchSpanProcessor` +
`OTLPTraceExporter({ url: 'https://api.runtype.com/v1/otel/v1/traces', headers: { Authorization: 'Bearer ' + key } })`,
`provider.register()` (otherwise every span is its own trace), attribution via
`runtypeFlueResourceAttributes({ agentId })` or the `x-runtype-agent-id` header, and
`await provider.forceFlush()` before a serverless handler returns. Node 22+.

**Any OpenTelemetry-instrumented agent.** Stock env vars, HTTP only:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.runtype.com/v1/otel
OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer rt_...,x-runtype-agent-id=agent_...
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

Runtype reads `gen_ai.operation.name` = `invoke_agent` / `chat` / `execute_tool` (an HTTP
root span above them is fine) and the GenAI content attributes. Attribution per trace:
`runtype.agent.id` resource attribute → `x-runtype-agent-id` header → `runtype.agent.id`
on the `invoke_agent` span. One agent invocation per trace.

## Lane B recipe

Register the endpoint so Runtype can call it:

```json
{
  "name": "Support agent (Flue)",
  "agent_type": "external",
  "external_config": {
    "endpoint": "https://my-worker.example.workers.dev/dispatch",
    "protocol": "runtype-stream",
    "framework": "flue",
    "auth": { "type": "bearer", "credentials": "{{secret:MY_AGENT_TOKEN}}" }
  }
}
```

A `runtype-stream` endpoint answers `POST {endpoint}` with
`{ "messages": [{ "role": "user", "content": "..." }], "context": { "conversationId": "..." } }`
and streams `text/event-stream` frames in Runtype's unified vocabulary (`execution_start`
first, one terminal `execution_complete` / `execution_error` last, `id:` mirroring a
0-based `seq`; schemas: the `ExecutionStreamEvent` union in the public OpenAPI spec, the
same stream `execute_agent` returns for a hosted agent). In a Flue 2 app the route runs
the turn with `init(agent, { id: conversationId })` + `handle.dispatch(message)` and maps
each chunk from `handle.read(receipt, { onEvent })` onto a frame. Omit `protocol` for an
A2A JSON-RPC endpoint. Then `execute_agent` to test, add the agent to a product as
a capability, or `generate_persona_embed_code` for a chat widget.

## Improvement loop for an external agent

1. Observe: `list_agent_executions` (ingested runs have `otel-...` execution ids and
   `agentSource: "external"`; timings and cost are as reported by the agent) or
   `list_logs`.
2. Diagnose: `trace_execution`; quote the failing iteration, tool call, or model turn.
3. Capture: `get_eval_capture_preview`, then `add_eval_case_from_execution`
   (`create_eval_suite` first if needed). No capturable content means the export lacks
   `gen_ai.*.messages`.
4. Fix: propose the change in the user's agent code and show it.
5. Verify: `run_eval_suite` when Runtype can call the agent (A2A); otherwise re-run the
   scenario against the redeployed agent and inspect the new run. The captured cases
   remain the regression record either way.

## Troubleshooting

- `curl -X POST https://api.runtype.com/v1/otel/v1/traces -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"resourceSpans":[]}'`
  returns `200 {}` when key and endpoint are right; `403` means the key lacks
  `TELEMETRY:WRITE`.
- Run stuck "in flight": the closing `invoke_agent` span was never flushed.
- `ambiguous_agent_attribution` or no run at all: two invocations in one trace, or no
  attribution source; set the resource attribute or header.
- Doubled tokens and cost: two instrumentations export to the same endpoint.
- "No tool content in this trace": content capture is off on the producer.
- `partial_success` in the exporter log: some traces named an agent the key cannot use.

## Do Not Do

- Do not promise eval re-runs for telemetry-only or `runtype-stream` agents.
- Do not send both Flue instrumentations to Runtype.
- Do not recommend `export_agent_runtime` / self-hosting for an agent that already
  exists elsewhere, or for non-Enterprise accounts.
- Do not put key values in chat, commits, or generated code; use secrets.
