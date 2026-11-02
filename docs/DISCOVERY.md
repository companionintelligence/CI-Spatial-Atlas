# Companion discovery and sign-on

How the Companion Atlas viewer finds its Companion Memory server, and how a person signs in to that server with their Companion account.

**Status.** The viewer side is built and tested. Two things outside this repository decide whether it works live. The Companion Hub does not publish its resource document yet, so discovery finds nothing until it does. CI-Portal must list `companion-atlas` before the Portal sign-in can succeed.

## Build settings

Set these when the viewer is built. Vite inlines them, so they are public in the bundle. Put no secret in them.

| Variable | Purpose |
|---|---|
| `VITE_COMPANION_HUB_URL` | The Companion Hub to ask for resources. Discovery is off when unset. |
| `VITE_OIDC_ISSUER` | The Portal issuer, `<portal-origin>/api/auth`. |
| `VITE_OIDC_CLIENT_ID` | The Portal client, `companion-atlas`. |
| `VITE_OIDC_REDIRECT_URI` | The viewer's own URL. The Portal must accept it. |

The Hub URL comes from the build only. The page address cannot set it.

A service URL the viewer will call must be `https://…`, or plain `http://` for `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` or `*.test`. A URL with a username or password is refused. The check is `safeServiceUrl` in `viewer-react/src/discovery/companion.ts`.

## The resource document

The Hub serves this document:

```
GET <hub>/.well-known/companion-resources
Accept: application/json
```

```json
{
  "memory": { "url": "https://memory.example.com" },
  "llm": {
    "url": "https://llm.example.com/v1",
    "provider": "anthropic",
    "models": ["claude-haiku-5-5"]
  }
}
```

- Both entries are optional. A document with neither counts as no resources.
- The viewer reads `memory.url`, `llm.url`, `llm.provider` (up to 64 characters) and `llm.models` (up to 20 names of up to 100 characters each). It drops every other field.
- Each URL must pass the rule above.
- The request sends no credentials and gives up after 5 seconds. A failed request, a body that is not JSON, or a document with nothing usable all mean "no resources". The viewer then behaves as if discovery were off.

## Which Memory server the viewer uses

The first match wins:

1. `?story=<url>` is an explicit choice. Discovery is skipped and the story loads from that URL.
2. A Memory server from the build (`VITE_MEMORY_URL`), or from `?memory=` where the address bar is allowed to set it (see `viewer-react/src/story/useStory.ts`). Discovery is skipped.
3. Neither, and `VITE_COMPANION_HUB_URL` is set. The viewer asks the Hub and uses the Memory server it names.
4. Otherwise the bundled sample story opens, labelled as demo data.

A Memory server found through the Hub gets only the access token this tab holds for that exact server. It never gets the build's `VITE_MEMORY_TOKEN` or `VITE_MEMORY_API_KEY`. A Memory server named in the build keeps those build credentials, as before.

`useStory()` returns the discovery result as `companion`: the Hub, whether it named a Memory server, and the LLM it named. **The LLM is recorded only. Nothing calls it.** "Curate" in the scrapbook is a local template (`curateJourney` in `packages/story-schema`), not an LLM.

The Hub URL is a build setting, so an embedding page cannot change it. Like `VITE_MEMORY_URL`, it applies in embed mode too.

## Sign-on through the Portal

When the Memory server answers with an authentication error, the load screen offers **Sign in with Companion**, provided the build sets all three `VITE_OIDC_*` variables. The email and password form stays as the fallback.

1. The button records the Memory URL in `sessionStorage` and sends the browser to `<issuer>/oauth2/authorize`. The request carries a PKCE S256 challenge and a `state` value. The verifier and the state stay in `sessionStorage` until the return.
2. The Portal sends the browser back to the viewer with `code` and `state`. If it refuses the request, it sends `error` and `state` instead.
3. On that page load, `finishPortalSignIn` checks `state`, exchanges `code` at `<issuer>/oauth2/token`, and removes `code`, `state` and `iss` from the address bar. The verifier is single-use.
4. The access token is filed under the Memory URL that started the sign-in (`viewer-react/src/memory/auth.ts`). The Memory request then carries it.

A refusal is shown in the Portal's own words, for example `Portal login: authorization failed — invalid_client — …`. The token never goes into the URL. The tab keeps it only in `sessionStorage`.

Code: `viewer-react/src/auth/portalReturn.ts` (the flow), `viewer-react/src/auth/portal.ts` (the PKCE protocol), `viewer-react/src/ui/StoryLoadError.tsx` (the button), `viewer-react/src/story/useStory.ts` (discovery and the return).

## Not done yet

- The Companion Hub does not publish `/.well-known/companion-resources`. Until it does, discovery finds nothing.
- CI-Portal must list `companion-atlas` in `PUBLIC_CLIENTS`. That is a change in the Portal repository.
- Whether a Memory server accepts a Portal token is not verified.
- The Portal token is not sent to the Atlas API. The upload client takes a `token` only from its caller, and the app passes none.
- The LLM resource is recorded and never called.
- A store build has no redirect the app can receive, so keep `VITE_OIDC_*` unset there (see `viewer-react/mobile/README.md`).

## Tests

- `viewer-react/test/companion-discovery.test.ts`: the URL rules, the document parser, and the fetch behaviour (credentials, failures, timeout).
- `viewer-react/test/portal-return.test.ts`: when the sign-in is offered, a return this tab did not start, the token exchange, the StrictMode double call, and the Portal's refusal.
- `viewer-react/test/portal-auth.test.ts`: the PKCE failure paths.
