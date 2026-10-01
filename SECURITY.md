# Session endpoint deployment

`POST /api/session` spends the server's OpenAI budget. CORS is not authentication:
non-browser clients can forge Origin. The endpoint therefore requires both an
exact allowed Origin and a separate operator bearer token outside explicit local
development. Missing or `null` origins are rejected, including CLI requests unless
they supply an allowed Origin and valid token. OPTIONS needs no token and consumes
no quota, but validates origin, requested method and headers.

## Production configuration

- Set `OPENAI_API_KEY` only in the server environment. Never bundle it in public
  assets or give it to operators. Only ephemeral session credentials are returned.
- Set `SESSION_ALLOWED_ORIGINS` to comma-separated exact HTTPS origins, including
  each approved preview origin. No wildcard, paths or trailing slash. Explicit
  loopback HTTP origins may be listed, but production still requires authentication
  and a durable limiter. No automatic trust based on Host or forwarded headers.
- Generate `SESSION_ACCESS_TOKEN` with `openssl rand -hex 32` and set it server-side.
  Distribute this separate credential privately to authorized dispatchers. They
  enter it in the password field. It stays in the page's memory, is never saved to
  browser storage, and must be entered again after reload. Clear it or close the
  tab on shared computers. Rotate it by updating the server environment. This is
  shared operator access, not individual user identity; a public customer service
  should replace it with verified user sessions or server-verified abuse challenges.
- Connect a durable limiter as below. Until then production POSTs return 503 and
  cannot mint sessions. There is no silent memory fallback.

No database/Redis/KV integration is configured in the repository. Deployment
secrets cannot be inferred from source. No durable service was provisioned by this
change.

## Durable limiter contract

Replace the null export in `lib/durable-session-limiter.js` with an object:

```js
export default {
  durable: true,
  async consume({ key, limit, windowMs }) {
    // Atomically check/increment shared storage and establish TTL on first use.
    // Return only after the durable operation succeeds; throw on backend failure.
    return { allowed: true, retryAfterSeconds: 3600 };
  },
};
```

The example describes the interface, not a working store. Implement it against
shared durable storage (for example an atomic Redis script or database transaction).
The check, increment and expiration must be atomic under concurrent requests from
multiple instances; a read followed by a write is insufficient. `retryAfterSeconds`
must be a positive safe integer describing the remaining window, also when allowed.
Set bounded backend timeouts within the serverless function's 10-second budget.
Store credentials remain server-only. `durable: true` is an adapter assertion,
not proof of durability; run integration/concurrency tests against the real store.

All deployments using the same store/key share a conservative global budget of
10 session creation attempts per hour. Use separate store namespaces for staging
and production if independent quotas are required. The endpoint passes the fixed
key `taxi-dispatcher:session:global`. This deliberately avoids trusting client IP
or `X-Forwarded-For`; rotating headers, origins or access tokens cannot reset the
budget. Failed upstream creation still consumes quota. A denied attempt returns
429 with Retry-After. Store errors or invalid results return 503 before OpenAI.
A global quota can affect all operators; add authenticated per-user quotas if
needed, while retaining an aggregate spending cap. Session creation quotas do not
limit ongoing call duration or total token spend; configure provider spending
controls separately.

## Localhost development

Run `vercel dev` with `OPENAI_API_KEY` set in `.env.local`, `NODE_ENV=development`
and `SESSION_LIMITER_MODE=memory`. You may leave `SESSION_ALLOWED_ORIGINS` and
`SESSION_ACCESS_TOKEN` empty. The browser can run on localhost, 127.0.0.1 or [::1]
with any port. The frontend uses localhost:3000 for localhost/127.0.0.1, or its
same-origin endpoint otherwise. If a token is configured locally, it is required.
Memory limits reset on restart and are explicitly unsuitable for serverless
production. Vercel preview/production environments cannot use the local bypass.

Run `npm test` (Node 20+). Tests mock OpenAI and cover rejection paths, preflight,
configuration, local development, and quota sharing between handler instances.
They do not test an unconfigured durable backend or make paid OpenAI calls.
