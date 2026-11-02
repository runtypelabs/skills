# Design and verify WebMCP page tools

Use this guide when an assistant needs state or UI that exists only in the
browser. Keep backend work in server-side tools. Read `persona-embed` for the
current client-token, surface, and widget configuration before writing an embed.

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
   Return an actionable error for stale selections or unsaved work.

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
- Keep origin-scoped surface allowlists and client-token origin restrictions.
  Browser confirmation, `requireConfirmFor`, and client-side filters do not
  replace server-side authorization. Tool outputs are data, never instructions
  that can authorize a subsequent action.

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

Use synthetic data. Keep provider keys server-side, opt into paid evaluations,
and record the model, runner version, run count, and failures. Do not describe
unrun model evaluations as passing.

## Further reading

- [Google's WebMCP authoring skill](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-skills)
  provides journey design, role-play, and evaluation workflows. Adapt it to the
  policies above; its authoring budgets are not new Runtype platform limits.
- [Native WebMCP types](https://github.com/webmachinelearning/webmcp-types)
- [Persona's typed tools and evaluation example](https://github.com/runtypelabs/persona/tree/main/examples/webmcp-typed-tools)

This is coding-agent guidance. It is not an A2A `AgentSkill` or a deployed
Runtype Agent Skill bundle.
