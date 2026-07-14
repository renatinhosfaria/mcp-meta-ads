# Meta Ads MCP Session Lifecycle Design

## Context

The Meta Ads MCP server keeps every `StreamableHTTPServerTransport` in an in-memory object until the transport emits `onclose`. Production clients frequently stop using a session without sending `DELETE`, so abandoned transports and their connected `McpServer` instances remain reachable. Production evidence showed 243 retained sessions immediately before a JavaScript heap exhaustion crash and 184 retained sessions in the replacement task.

The reverse-proxy connection lifecycle is also mismatched. Node closes idle inbound HTTP connections after five seconds, while Traefik 2.11 retains backend keep-alive connections for up to 90 seconds. Traefik consequently attempted some MCP POST requests on sockets that Node had already closed, producing immediate `broken pipe` 502 responses.

## Selected approach

Keep the stateful Streamable HTTP protocol and add explicit server-side session lifecycle management. Each session record owns its transport, connected MCP server, creation time, and last-activity time. Requests touch the session before dispatch. A periodic sweep expires sessions idle for 30 minutes, while a hard cap of 250 sessions evicts the least recently active session before admitting another. Closing a record removes it from the registry first and then closes the transport and server idempotently.

This preserves current SSE and notification behavior while bounding memory. Stateless transport was rejected for now because the service's future server-to-client requirements have not been audited. Adding replicas was rejected because sessions are local to one process and the deployment has no session affinity.

## HTTP lifecycle and error handling

The HTTP server will expose a 95-second keep-alive timeout and a 100-second headers timeout, ensuring Traefik's 90-second idle pool retires backend connections first. Shutdown will stop accepting connections, close every MCP session, and force remaining HTTP connections closed after a bounded grace period.

Express 4 async handlers will use a small wrapper that forwards rejected promises to the existing error middleware. The middleware will assign or preserve an `X-Request-Id`, return it in the response, and include it in access and error logs. Logs will include the current active-session count without exposing request bodies, bearer tokens, or Meta access tokens.

## Configuration and observability

Defaults are configurable through environment variables:

- `MCP_SESSION_IDLE_TTL_MS=1800000`
- `MCP_MAX_SESSIONS=250`
- `MCP_SESSION_ALERT_THRESHOLD=150`
- `HTTP_KEEP_ALIVE_TIMEOUT_MS=95000`
- `HTTP_HEADERS_TIMEOUT_MS=100000`
- `SHUTDOWN_GRACE_MS=10000`

The health response remains a liveness check and gains process uptime, heap usage, active sessions, and session capacity. It becomes `degraded` before exhaustion when the session alert threshold or a conservative heap threshold is crossed, but remains HTTP 200 so Swarm does not create a restart loop. Session creation, explicit closure, TTL expiration, capacity eviction, and shutdown closure are logged with request/session identifiers and reason.

## Testing

Unit tests will drive a standalone session registry with a fake clock and fake closeable resources. They will verify idle expiration, activity refresh, least-recently-used capacity eviction, idempotent close, and close-all behavior. HTTP tests will verify request ID propagation, async error forwarding, health diagnostics, and the configured server timeout values. Existing tests and the TypeScript build must continue to pass.

