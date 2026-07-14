# Meta Ads MCP Session Lifecycle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bound stateful MCP session memory, eliminate stale proxy keep-alive 502s, and add lifecycle diagnostics without changing tool behavior.

**Architecture:** Extract session ownership into a registry that tracks activity and closes idle or excess sessions. Build the Express application and HTTP server through exported factories so lifecycle, request IDs, health diagnostics, and timeout behavior can be tested without starting production listeners during imports.

**Tech Stack:** TypeScript, Express 4, MCP TypeScript SDK, Node HTTP, `node:test`, `tsx`.

---

### Task 1: Session registry

**Files:**
- Create: `src/session-registry.ts`
- Create: `tests/session-registry.test.ts`

**Step 1: Write the failing tests**

Cover activity refresh, 30-minute idle expiration, least-recently-used capacity eviction, idempotent resource closure, and close-all.

**Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/session-registry.test.ts`

Expected: FAIL because `src/session-registry.ts` does not exist.

**Step 3: Implement the minimal registry**

Create a generic `SessionRegistry` backed by `Map`, with `add`, `get`, `touch`, `close`, `sweepExpired`, `closeAll`, `size`, and stats. Close the transport and MCP server with `Promise.allSettled` after deleting the record.

**Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/session-registry.test.ts`

Expected: all session-registry tests pass.

### Task 2: Testable HTTP application and managed sessions

**Files:**
- Create: `src/app.ts`
- Modify: `src/index.ts`
- Create: `tests/session-http-lifecycle.test.ts`

**Step 1: Write failing HTTP lifecycle tests**

Verify initialization registers a session, subsequent requests touch it, DELETE removes it, expired session IDs return 404, async transport rejection reaches the error handler, and shutdown closes all resources.

**Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/session-http-lifecycle.test.ts`

Expected: FAIL because the application factory does not exist.

**Step 3: Implement the application factory**

Move routing from `index.ts` into `createApp`, inject registry/server/transport factories for tests, wrap async handlers, and start the expiration sweep with an unref'ed timer. Keep production defaults unchanged apart from managed cleanup.

**Step 4: Run lifecycle and existing HTTP tests**

Run: `node --import tsx --test tests/session-http-lifecycle.test.ts tests/http-payload-limit.test.ts tests/auth.test.ts`

Expected: all selected tests pass.

### Task 3: Keep-alive and graceful shutdown

**Files:**
- Modify: `src/index.ts`
- Modify: `src/config.ts`
- Create: `tests/http-server-lifecycle.test.ts`

**Step 1: Write failing server lifecycle tests**

Verify server keep-alive and headers timeouts use configured defaults and shutdown closes sessions before forcing remaining connections after the grace period.

**Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/http-server-lifecycle.test.ts`

Expected: FAIL because the server lifecycle factory does not exist.

**Step 3: Implement timeout and shutdown behavior**

Export a server creation function, set `keepAliveTimeout=95000` and `headersTimeout=100000`, close the registry on shutdown, and force lingering HTTP connections only after `SHUTDOWN_GRACE_MS`.

**Step 4: Run the server lifecycle tests**

Run: `node --import tsx --test tests/http-server-lifecycle.test.ts`

Expected: all server lifecycle tests pass.

### Task 4: Request correlation and health diagnostics

**Files:**
- Modify: `src/middleware/logger.ts`
- Modify: `src/middleware/error-handler.ts`
- Modify: `src/app.ts`
- Create: `tests/observability.test.ts`

**Step 1: Write failing observability tests**

Verify incoming request IDs are preserved, missing IDs are generated and returned, errors include the request ID in logs, and health includes heap/session diagnostics with a degraded state at the configured threshold.

**Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/observability.test.ts`

Expected: FAIL because correlation and diagnostics are absent.

**Step 3: Implement minimal observability**

Add typed request ID storage, safe structured log fields, session counters, heap usage, uptime, and degraded threshold evaluation. Do not log headers, bodies, tokens, or Meta parameters.

**Step 4: Run observability tests**

Run: `node --import tsx --test tests/observability.test.ts`

Expected: all observability tests pass.

### Task 5: Deployment configuration and complete verification

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `DOCUMENTATION.md`

**Step 1: Document configuration**

Add the session, timeout, and shutdown variables with defaults and explain why replicas must remain at one until affinity or stateless operation is implemented.

**Step 2: Build generated JavaScript**

Run: `npm run build`

Expected: TypeScript compilation succeeds and `dist/` reflects source changes.

**Step 3: Run the complete test suite**

Run: `node --import tsx --test tests/*.test.ts`

Expected: all tests pass with zero failures.

**Step 4: Inspect the final diff**

Run: `git diff --check && git status --short && git diff --stat`

Expected: no whitespace errors; only planned files are changed.

