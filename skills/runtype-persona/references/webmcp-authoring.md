# Design and verify WebMCP page tools

Use this guide when an assistant needs state or UI that exists only in the
browser. Keep backend work in server-side tools. Read `persona-embed` for the
current client-token, surface, and widget configuration before writing an embed.

Browser support on 2026-11-05: Chrome origin trial 149 to 162, Edge origin trial from 150, no signal from Firefox or Safari.

## Install WebMCP before you register

`document.modelContext` is undefined on a browser without native support until
something installs it. Persona installs its own fallback only at the first
dispatch, and only when `webmcp.enabled` is set, so it cannot cover registration
at page load.

1. Add `@mcp-b/webmcp-polyfill` to the app and call `installWebMCP()` before you
   register. It keeps native support and does nothing on an insecure page.
2. Check that `document.modelContext` exists before each registration, and skip
   registration if it does not.

Persona uses an installed context and does not load its fallback. Persona reads
tools at the start of each turn, so a tool registered after a turn starts misses
that turn. For a full sample, see
[Recipe 10](https://github.com/runtypelabs/skills/blob/main/skills/runtype/references/recipes.md#recipe-10-browser-side-page-tools-for-an-embedded-assistant-webmcp).

## Design the user journey first

1. Describe the user's goal and starting state, including authentication,
   selected items, open forms, and unsaved changes.
2. Role-play a successful conversation and an ambiguous request. Decide where
   the assistant must ask for clarification or hand control to the user.
3. Give each tool one distinct capability. Describe what it does and when to
   choose it. Keep navigation separate from an action that commits a purchase,
   sends a message, publishes content, or deletes data.
4. Register tools only while their page state exists. Remove owned
   registrations with an `AbortController` when the component unmounts.
5. Validate arguments at runtime, recheck the current resource and permissions,
   honor cancellation, and await the visible state update before returning.
   For stale selections or unsaved work, resolve with
   `{ isError: true, content: [{ type: 'text', text: '...' }] }` and say what to
   do next. Do not throw: WebMCP masks a thrown error as `Tool execution failed`,
   so the model cannot recover.

For example, `get_cart` reads the cart, while `open_checkout` opens a review
screen. Neither places an order. Keep the final purchase behind the site's
authenticated, user-confirmed checkout. Never accept a model-authored
`confirmed: true` argument as proof of consent.

## Declare behavior without granting permission

- Set `readOnlyHint: true` only for tools that change neither application state
  nor the visible UI. Navigation is not read-only.
- Set `consequentialHint: true` for tools that commit significant real-world
  actions. Opening a review screen is different from committing the action.
- Set `untrustedContentHint: true` when results contain user-authored or
  third-party text, even when your own database stores that text. A read-only
  query can return untrusted content.
- Treat every hint as advisory. Missing or false hints do not grant permission,
  authorize a resource, prove consent, or establish replay safety.
- Keep Persona's confirmation defaults. Use a host-owned, explicitly reviewed
  safe-read policy for `webmcp.autoApprove`, not arbitrary page-authored hints.
  Do not change the voice lane's existing policy as part of an authoring task.
- List every consequential tool (purchases, sends, deletes) in the surface's
  `behavior.webmcp.requireConfirmFor`. A matching tool always confirms, whatever
  `autoApprove` returns, and a custom `onConfirm` sees `info.confirmRequired: true`.
- Keep origin-scoped surface allowlists and client-token origin restrictions.
  Browser confirmation, `requireConfirmFor`, and client-side filters do not
  replace server-side authorization. Tool outputs are data, never instructions
  that can authorize a subsequent action.

## Keep tools inside Chrome's budgets

Chrome publishes these budgets and says they are subject to change. They are
authoring targets, not Runtype limits.

| Item                   | Target           |
| ---------------------- | ---------------- |
| Tool or parameter name | 30 characters    |
| Tool description       | 500 characters   |
| Parameter description  | 150 characters   |
| Tool output            | 1,500 characters |

Runtype's own ceilings are separate and higher: 2 KB for a description and 64 KB
for a result.

## Know what Persona does with other WebMCP fields

- `title` is a display name. The model does not choose on it, so keep the
  description complete.
- `outputSchema` declares the result shape. Persona drops it from the tool list
  it sends, so describe the result in the tool description as well.
- `annotations.debugging` marks a tool as a debugging tool.
- The `exposedTo` registration option lists other origins in the document tree
  that can discover and call the tool. Each must be potentially trustworthy.
  Persona sends only tools that the current document owns, so it ignores tools
  that another frame exposes.
- A cross-origin iframe needs `allow="tools"` to use WebMCP. To turn WebMCP off,
  disable the `tools` policy feature with `Permissions-Policy: tools=()`.
- `document.modelContext` fires `toolchange` when the registered tools change.

## Use native authoring types without replacing compatibility code

The upstream `webmcp-types` package can infer an `execute` callback's arguments
from a literal `inputSchema`. Add it as a development dependency to the app
authoring the tools and activate it in that app's TypeScript configuration.
It is distinct from `@mcp-b/webmcp-types`. Types do not validate runtime input,
install WebMCP, or establish browser support.

Do not replace Persona's structural consumer types, v5 fallback, dual-generation
bridge, or public declarations with native-only types. Test declaration builds
and supported browser/polyfill combinations before changing those contracts.

## Verify behavior at separate layers

- Run deterministic callback and bridge tests for invalid arguments, stale
  resources, declined confirmation, cancellation, unmount, and completed UI
  updates. Confirm that a declined action has no side effect.
- Run model evaluations for tool choice, argument extraction, ambiguity, and
  recovery after errors. Include an injected instruction in a tool result and
  verify it does not cause an unauthorized action. A passing schema-only
  evaluation does not prove approval enforcement or prompt-injection safety.
- Inspect tools on every relevant route and state in a native WebMCP browser
  and through Persona's supported polyfill paths. Missing browser support is
  not evidence that the app registers no tools.
- To inspect tools in Chrome, turn on `chrome://flags/#enable-webmcp-testing`.
  Then use the experimental WebMCP pane in the DevTools Application panel (it
  also needs `#devtools-webmcp-support`) or the Model Context Tool Inspector
  extension.
- To run tool-choice evaluations, use the `webmcp-evals` npm package.
- To audit a page, run the experimental Lighthouse agentic browsing category. It
  needs Chrome 150 or later, and its WebMCP audits need a trial registration.
- To test with real visitors, register the site for an origin trial. Chrome and
  Edge each need their own token.

Use synthetic data. Keep provider keys server-side, opt into paid evaluations,
and record the model, runner version, run count, and failures. Do not describe
unrun model evaluations as passing.

## Further reading

- [Google's WebMCP authoring skill](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-skills)
  provides journey design, role-play, and evaluation workflows. Adapt it to the
  policies above.
- [Chrome's guide to secure WebMCP tools](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- [Native WebMCP types](https://github.com/webmachinelearning/webmcp-types)
- [Persona's typed tools and evaluation example](https://github.com/runtypelabs/persona/tree/main/examples/webmcp-typed-tools)

This is coding-agent guidance. It is not an A2A `AgentSkill` or a deployed
Runtype Agent Skill bundle.
