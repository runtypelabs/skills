# Surface types

Every surface has a **type** and carries **traits** that the platform uses to enforce channel-appropriate behavior. When designing a product, pick the surface type first. Its traits constrain everything downstream (max response length, streaming, markdown dialect, reasoning visibility).

Prefer live `get_platform_documentation(topic="surface-types")` and `runtype://types/surface-configs` when available. This file is fallback orientation.

Many surfaces carry an `executionHint` that should be appended to the agent's system prompt to enforce formatting. The platform may do this automatically; check before duplicating it manually.

## Contents

- [Trait dimensions](#trait-dimensions)
- [Surface type catalog](#surface-type-catalog)
- [Auto-generated REST and MCP APIs](#auto-generated-rest-and-mcp-apis)
- [Capability routing (multi-capability surfaces)](#capability-routing-multi-capability-surfaces)
- [Surface-specific auto-registered tools](#surface-specific-auto-registered-tools)
- [Picking a surface](#picking-a-surface)
- [Trait-driven prompt construction](#trait-driven-prompt-construction)

## Trait dimensions

| Trait                 | What it controls                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `streaming`           | `required` / `optional` / `none`: whether streaming is supported (and required)           |
| `messagesMutable`     | Whether messages in the thread can be edited after send (Slack, Discord, Telegram)        |
| `deliveryModel`       | `real_time` / `sync` / `async`: how the platform delivers responses                       |
| `mediaSupport`        | `none` / `images` / `rich`: inbound and outbound media                                    |
| `interactiveUI`       | `none` / `generative` / `forms` / `buttons`: interactive UI elements the channel supports |
| `inboundMediaSupport` | Whether the channel accepts inbound media (images, files)                                 |
| `consumerType`        | `human` / `machine` / `agent`: informs the eval framing                                   |
| `reasoningVisibility` | `pass_through` / `always_strip`: whether `<thinking>` traces are exposed                  |
| `markdownDialect`     | `none` / `markdown` / `mdx` / `mrkdwn` / `markdownv2` / `html` / `telegram_html`          |
| `threadModel`         | `flat` / `threaded` / `reply_chain`                                                       |
| `senderIdentity`      | `anonymous` / `authenticated` / `verified`                                                |
| `maxResponseLength`   | Response length budget/cap (chars)                                                        |
| `executionHint`       | A formatting instruction appended to the agent's system prompt                            |

## Surface type catalog

### `chat`

Website widget, support bots, conversational UIs.

- Use cases: support, onboarding, internal tools, FAQ bots
- Streaming: **required**, `mediaSupport: images`, `interactiveUI: generative` (the Persona widget supports rich generative components)
- `reasoningVisibility: pass_through`: reasoning is shown unless config opts out
- `markdownDialect: mdx`
- For the SDK and embed code, use `generate_persona_embed_code` and see `persona-widget.md`
- Optional WebMCP page tools are configured under `behavior.webmcp`. They are
  browser-side tools registered on `document.modelContext`, gated by
  `enabled` plus origin-scoped allow-list rules, and executed by Persona in the
  host page. Keep client-token `allowedOrigins` configured separately for CORS.

### `api`

Programmatic HTTP endpoints for backend integrations.

- Use cases: REST API, webhook consumer, integration endpoint
- Streaming: optional, no media, no UI
- `consumerType: machine`
- Authenticated via surface keys

### `mcp`

AI assistant integration. The agent's tool set becomes the MCP server's tool catalog. Consumed by Cursor, Claude Code, Claude Desktop, etc.

- Use cases: developer tools, code review, doc assistants, DB query helpers
- `consumerType: agent`
- Authenticated

### `mcp_code`

Code Mode MCP server for programmatic agent access, for advanced agent integrations and custom automation scripts.

- Similar to `mcp` but framed for code-mode (where the model generates code that calls tools rather than calling them directly).

### `email`

Email-triggered processing and automated responses.

- Use cases: auto-reply support agent, invoice processor, email-to-task converter
- `deliveryModel: async`, `mediaSupport: images`, `markdownDialect: html`
- `reasoningVisibility: always_strip`: never leak thinking traces
- `threadModel: reply_chain`
- **Execution hint**: "Respond via email. Write in a professional, organized tone. Use clear paragraphs. Avoid bullet-point overload; prefer flowing prose where appropriate. Don't include reasoning traces, tool call narration, or internal process details."

### `webhook`

Event-driven processing from third-party services. Accepts JSON and form-encoded payloads.

- Use cases: Stripe payment handler, GitHub event processor, Twilio inbound SMS, Shopify order webhook
- Payloads are **never** treated as a Runtype envelope. The full parsed body lands in `payload` in the execution message. Top-level fields are spread into flow inputs so `{{field}}` template variables resolve in `prompt` and `api-call` step bodies.
- `behavior.inputMapping` can rename or deep-pick fields by dot path.
- `behavior.response` returns a static HTTP body, useful for providers that require specific ACK shapes (e.g. empty TwiML for Twilio, 204 for Shopify). When set, the flow fires **async**.
- `consumerType: machine`, `deliveryModel: sync`

### `slack`

Slack bot for team collaboration.

- Use cases: team support, daily standups, alert channel manager
- `mediaSupport: rich`, `interactiveUI: forms`, `markdownDialect: mrkdwn`, `threadModel: threaded`
- `messagesMutable: true`: messages can be edited mid-thread
- `reasoningVisibility: always_strip`, `maxResponseLength: 4000`
- **Execution hint**: "Responding in Slack. Be concise and direct. Slack messages should be scannable. Avoid lengthy prose. No reasoning traces or tool call narration."
- Connect via the `slack-setup` runbook (`runtype://guide/slack-setup`), not `create_surface_key`. `install_slack_integration` only helps a caller who already holds a bot token and signing secret (migration or rotation)

### `schedule`

Cron jobs and periodic processing.

- Use cases: daily reports, weekly sync, hourly health check
- `deliveryModel: async`, no media, no UI
- `reasoningVisibility: always_strip`
- Triggered via `create_schedule` + the flow/agent target

### `sms`

SMS messaging, typically through Twilio.

- Use cases: SMS support, reminders, two-way texting, surveys
- `deliveryModel: async`, no media, `markdownDialect: none`, `maxResponseLength: 160`
- **Execution hint**: "Responding via SMS. Be extremely brief: one or two short sentences. Plain text only, no markdown, no lists. No reasoning traces."

### `imessage`

iMessage messaging via Sendblue for Apple ecosystem.

- Use cases: customer support, appointment reminders, rich messaging
- `mediaSupport: images`, `inboundMediaSupport: true`
- `senderIdentity: verified`, `maxResponseLength: 1200`
- **Execution hint** is extensive. It covers texting tone, no greetings/closings, lowercase OK, one-emoji-max, multi-bubble formatting via blank lines. Read it in full when configuring an iMessage agent; it's strict.

### `discord`

Discord bot for community engagement.

- Use cases: community FAQ, moderation, welcome bots
- `mediaSupport: rich`, `interactiveUI: buttons`, `markdownDialect: markdown`, `threadModel: threaded`
- `reasoningVisibility: always_strip`
- **Execution hint**: friendly, community-appropriate, markdown OK, concise

### `whatsapp`

WhatsApp Business for customer communication.

- Use cases: support, order updates, scheduling
- `mediaSupport: rich`, `interactiveUI: buttons`, `markdownDialect: none`, `maxResponseLength: 1024`
- `senderIdentity: verified`
- **Execution hint**: concise, conversational, plain text. No reasoning traces.

### `telegram`

Telegram bot for messaging.

- Use cases: support, notifications, group admin
- `mediaSupport: rich`, `interactiveUI: buttons`, `markdownDialect: telegram_html`, `maxResponseLength: 4096`
- `messagesMutable: true`, `threadModel: flat`
- **Execution hint**: clear and concise, no unnecessary verbosity, no reasoning traces

### Retired: `messaging`

The generic `messaging` type is retired, and no route serves it. An FPO that names it still parses, with a warning. Use one surface per channel (`sms`, `whatsapp`, `telegram`, and so on).

### `a2a`

Agent-to-agent communication protocol.

- Use cases: multi-agent workflows, agent orchestration, distributed processing
- `consumerType: agent`, `deliveryModel: sync`
- Use when one agent product needs to be invokable as a tool by another agent product.

### `hosted-page`

Hosted publisher page for exposing one or more capabilities as a branded mini-app.

- Use cases: public mini-apps, customer-facing tools, authenticated internal pages
- Presentation config lives on surface items; product-level page behavior controls route, auth requirement, nav style, branding, and social metadata
- Read `runtype://types/surface-configs` before authoring because this surface has structured `HostedPageBehavior` and `HostedPagePresentation` fields
- Hidden from the dashboard and from MCP `create_surface`

### `chrome_extension`

Downloadable Manifest V3 Chrome extension that embeds the agent in the browser side panel.

- Use cases: browser copilots, page-aware assistants, form filling and data extraction, internal browser tooling
- Streaming is required. `mediaSupport: images`, `interactiveUI: generative`, `markdownDialect: mdx`
- Caller credential: client token

### `ag-ui`

AG-UI protocol endpoint for custom agent front ends, such as CopilotKit clients.

- Hidden from the catalog and flag-gated, and MCP `create_surface` does not accept it
- Streaming is required. `deliveryModel: real_time`, `mediaSupport: none`
- Caller credential: client token

MCP `create_surface` also does not accept `imessage`.

## Auto-generated REST and MCP APIs

When you bind capabilities to a `mcp` or `api` surface, the platform **auto-generates** endpoints (for REST) or tools (for MCP) from each capability. You don't write the endpoints yourself.

- Each capability connected to an `api` surface becomes a REST endpoint.
- Each capability connected to an `mcp` surface becomes an MCP tool.
- You pick the auth scheme.
- You get a hosted URL.

So mapping three agents to one `mcp` surface gives you three MCP tools on one server. Mapping the same three agents to one `api` surface gives three REST endpoints.

## Capability routing (multi-capability surfaces)

**On `chat`**, `behavior.mode` decides which capability handles a message:

- `single_orchestrator` (default): every message goes to the enabled entry point, then `orchestratorCapabilityId`, then the first capability.
- `multi_capability`: a router picks a capability for each message. An active chat surface still needs exactly one enabled entry point.

The router makes one call at temperature 0, with `gpt-5.4-nano` by default. It lists capabilities as `[n] name: description` and reads a number from the reply, then tries a capability name, then uses the fallback. The fallback is `behavior.fallbackCapabilityId` if that capability can be routed to, or the first capability.

Set `behavior.router.model` and `behavior.router.prompt` to override it. A custom prompt must keep `{{capabilities}}`, `{{fallback}}`, and `{{message}}`. Routing runs on product chat (`POST /v1/products/{productId}/surfaces/{surfaceId}/chat`) and in surface evals. Client-token chat (`/v1/client/chat`) runs the token's target and does not route. **Run a surface eval (dashboard)** to compare strategies: default vs. tuned prompt, small model vs. larger.

**On messaging channels** (`slack`, `telegram`, `discord`, `email`, `whatsapp`, and others), modes do not apply. Runtype applies these rules in order:

1. An enabled entry point handles the message.
2. If at most one capability is enabled, it handles the message.
3. A platform judgment picks among up to 20 capabilities.
4. With more than 20, the first routable capability handles the message.

Routing should usually be a sub-second operation.

## Surface-specific auto-registered tools

When an agent is bound to a surface, **surface-specific tools auto-register** with the agent. Same agent definition, different tool surface per channel.

Examples:

- **Persona chat**: artifact generation, document toolbar tools.
- **Slack**: thread-context lookup, rich-mrkdwn formatting helpers.
- **Telegram**, **Discord**: channel-appropriate helpers.

You don't manually add these. The agent adapts.

## Picking a surface

> "I need a chat window on a website" → `chat` (+ Persona widget)
> "I need a Slack bot" → `slack`
> "I need to receive Stripe / Twilio / Shopify webhooks" → `webhook` (set `behavior.response` for ACK-shape requirements)
> "I want to expose my tools to Cursor / Claude Code" → `mcp`
> "I want an auto-generated REST API for my product's agents" → `api`
> "I want to run something every morning at 9" → `schedule`
> "I need an email auto-responder" → `email`
> "I have one bot that should work over SMS, WhatsApp, and Telegram" → three surfaces (one per channel) with channel-specific tuning. The channels' constraints diverge enough that per-surface configuration almost always beats a single shared surface.
> "I want to federate an external agent into my product" → `create_agent` with `agent_type: "external"` (A2A or `runtype-stream` endpoint), then add it as a capability
> "I want other agents to call my product over A2A" → `a2a`
> "I want Runtype to host a branded mini-app for this product" → `hosted-page`
> "I want the agent in the Chrome side panel" → `chrome_extension`

## Trait-driven prompt construction

When writing an agent's system prompt, factor in the surface trait:

- If `reasoningVisibility: always_strip`, end the prompt with: "Do not include reasoning traces, tool call narration, or process details in your response."
- If `maxResponseLength` is set, mention it explicitly: "Keep responses under N characters."
- If `markdownDialect` ≠ user's default formatting (e.g. `mrkdwn` for Slack), call it out: "Use Slack mrkdwn (`*bold*`, `_italic_`), not standard markdown."
- If `executionHint` is set on the surface type, append it (the platform may do this automatically; check, don't double up).
