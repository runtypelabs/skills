---
name: build-runtype-app
description: >-
  Use when building or deploying a Runtype App: a static web app hosted at
  {slug}-{shortId}.runtype.run, backed by Runtype AI APIs through an
  auto-provisioned client token. Covers the runtype.app.json manifest format,
  bundle rules, the window.__RUNTYPE_APP__ boot config, and deploying end to
  end with the deploy_app_version MCP tool, the REST API, or the CLI.
user-invocable: true
argument-hint: '[app to build or deploy]'
---

# Build a Runtype App

A Runtype App is a static bundle (HTML/CSS/JS) deployed to a real URL in seconds. No keys in the browser, no backend, no DevOps: everything dynamic (AI chat, agents) comes from Runtype APIs through a client token that Runtype injects at serve time. Deploys are instant pointer flips; rollback is activating an older version.

## The deploy loop (MCP, preferred)

1. `create_app` with a slug (lowercase, must start with a letter, max 40 chars), a name, and visibility (`unlisted` by default; `public` needs a paid plan). The response includes the app id and the final URL.
2. Build the app as a set of files. Include `index.html` and `runtype.app.json` at the root.
3. `deploy_app_version` with the app id and the files (`files` for text, `filesBase64` for binary assets). It uploads and activates in one call and returns the live URL. Pass `activate: false` to stage without serving.
4. Iterate: every `deploy_app_version` call creates a new version. Roll back anytime with `activate_app_version` and an older version id (`get_app` with `includeVersions: true` lists them).

REST equivalent: `POST /v1/apps`, then `POST /v1/apps/:id/versions` (raw `application/zip` body, or JSON `{ files, filesBase64 }`), then `POST /v1/apps/:id/activate`. CLI equivalent: `runtype apps create`, then `runtype apps deploy ./dist --app <id>`.

## The manifest (`runtype.app.json`)

Ship it at the bundle root. It declares everything the app may touch:

```json
{
  "name": "Retro Board",
  "capabilities": {
    "flows": ["flow_..."],
    "agents": ["agent_..."]
  },
  "data": [
    { "namespace": "retro_card", "access": "read-write" },
    { "namespace": "retro_summary", "access": "read" }
  ],
  "auth": "none"
}
```

- `capabilities.flows` / `capabilities.agents`: the flows and agents the app's browser sessions may dispatch (via `/v1/client/*`). Every id must exist and belong to the app owner; upload fails otherwise. Activation scopes the app's client token to exactly this set.
- `data`: the record namespaces the app may read or write (see the data plane below). Each entry grants `read` or `read-write` on records of that `namespace`. Leave `[]` if the app does not persist data.
- `auth`: must be `"none"`. `"optional"` / `"required"` are reserved for Log in with Runtype and are rejected at upload (422).

## Bundle rules

- `index.html` and `runtype.app.json` required at the root (a single wrapper directory like `dist/` is tolerated and stripped).
- Dotfiles (`.env`, `.git`, `.well-known`, ...) are never stored or served.
- Max 500 files; bundle size is plan-gated (10 MB on free plans, 50 MB hard cap).
- Content types are inferred from file extensions. Unmatched extension-less paths fall back to `index.html`, so client-side routing works by default.

## Use the boot config, never hard-code credentials

At serve time Runtype injects a script into every HTML entrypoint:

```js
window.__RUNTYPE_APP__ = { appId, versionId, apiUrl, clientToken }
```

Generated apps must read this object instead of embedding tokens:

```js
const { apiUrl, clientToken } = window.__RUNTYPE_APP__
const init = await fetch(`${apiUrl}/v1/client/init`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: clientToken }),
}).then((r) => r.json())
// then chat via /v1/client/chat with the session from init
```

The client token is origin-locked to the app's own URL and scoped to the manifest's flows/agents. Rotating it never requires a redeploy.

## The records data plane (persisting data)

An app persists data through `/v1/client/records`, governed entirely by the manifest's `data[]` grants. Records are stored under the app owner's account; the app's anonymous browser sessions can only touch the namespaces the manifest grants, and only `read-write` namespaces accept writes. There is no SQL, no schema migration: a record is `{ id, namespace, name, metadata }` where `metadata` is any JSON object.

Every records call is **session-authed** with the session id from `/v1/client/init` (the same session you use for chat). For a data-only app (no flows/agents in the manifest), `init` still returns a session — the response carries an `app` object instead of a `flow` object.

```
GET    /v1/client/records?sessionId=…&namespace=retro_card   list (cursor-paginated)
POST   /v1/client/records                                    create { sessionId, namespace, name?, metadata }
GET    /v1/client/records/:id?sessionId=…                    read one
PUT    /v1/client/records/:id                                update { sessionId, name?, metadata? }
DELETE /v1/client/records/:id?sessionId=…                    delete
```

Rules to design around:

- The `namespace` must appear in the manifest's `data[]`, or the call returns 403. Writes (POST/PUT/DELETE) require `access: "read-write"`; a `read` namespace is list/get only.
- `name` is unique per namespace within the owner's account. Omit it to auto-assign a unique id; pass your own to make a record addressable/upsert-like (a duplicate name returns 409).
- `metadata` is capped at 64 KB serialized. The reserved `_app` key is stripped from your input and used for server-set provenance, so don't rely on it.
- Each app holds at most 10,000 records across all its namespaces. A create over the cap returns 403 — delete unused records or split data across apps. Design UIs that prune (e.g. cap a list, delete on dismiss) rather than accumulate unbounded rows.
- Writes (POST/PUT/DELETE) are rate limited per app and per session. A burst over the limit returns 429 with a `Retry-After` header — back off and retry; don't hammer in a tight loop. Reads are not rate limited. Batch UI actions so a single user gesture is a small number of writes.
- List is newest-first and cursor-paginated: follow `nextCursor` until it is `null` (default page size 50, max 100).
- App-created records show up in the owner's dashboard Records views under a per-app record `type` of `app:{appId}:{namespace}`. App data is always isolated from the owner's other record types: the data plane can never read or write a bare record type, and two apps never share data. Flows or agents that should consume app data address the prefixed type directly (e.g. a get-records step over `app:app_01h…:retro_card`).

### End-to-end example (a data-only app)

```html
<!doctype html>
<html>
  <body>
    <ul id="cards"></ul>
    <input id="text" placeholder="Add a card" />
    <button id="add">Add</button>
    <script>
      const { apiUrl, clientToken } = window.__RUNTYPE_APP__
      let sessionId

      async function api(path, init) {
        const res = await fetch(`${apiUrl}${path}`, {
          ...init,
          headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
        })
        if (!res.ok) throw new Error(`${path}: ${res.status}`)
        return res.status === 204 ? null : res.json()
      }

      async function start() {
        const init = await api('/v1/client/init', {
          method: 'POST',
          body: JSON.stringify({ token: clientToken }),
        })
        sessionId = init.sessionId
        await render()
      }

      async function render() {
        const { data } = await api(`/v1/client/records?sessionId=${sessionId}&namespace=retro_card`)
        document.getElementById('cards').innerHTML = data
          .map((r) => `<li>${r.metadata.text}</li>`)
          .join('')
      }

      document.getElementById('add').onclick = async () => {
        const text = document.getElementById('text').value
        await api('/v1/client/records', {
          method: 'POST',
          body: JSON.stringify({ sessionId, namespace: 'retro_card', metadata: { text } }),
        })
        document.getElementById('text').value = ''
        await render()
      }

      start()
    </script>
  </body>
</html>
```

The matching `runtype.app.json` only needs the namespace grant:

```json
{
  "name": "Retro Board",
  "data": [{ "namespace": "retro_card", "access": "read-write" }],
  "auth": "none"
}
```

## Constraints to design around

- The page's CSP allows the app's own origin and the Runtype API (`connect-src 'self' {apiUrl}`). Direct `fetch` calls to third-party APIs are blocked; route dynamic behavior through Runtype flows/agents instead.
- No server-side code in v1: the bundle is static. Anything dynamic is a flow or agent dispatch.
- `unlisted` apps are served with `X-Robots-Tag: noindex`; suspended apps serve 410.
- One version is live at a time; uploads do not change what is served until activated.
