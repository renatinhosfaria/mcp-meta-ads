# Session ID Contract and Deploy Metadata Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore backward-compatible audience batch uploads and make the running Meta Ads MCP deployment identifiable.

**Architecture:** Define one Zod schema that accepts a positive integer or a digits-only string and transforms either input to a number before the handler runs. Exercise the registered tool handler with an injected Graph request mock so the accepted schema and outbound payload remain aligned. Centralize version/build metadata and inject it into the Express app health response, sourcing deploy values from environment variables populated by Docker build/runtime configuration.

**Tech Stack:** TypeScript, Zod, MCP SDK, Node test runner, Express, Docker.

---

### Task 1: Prove the audience session contract regression

**Files:**
- Modify: `tests/meta-domain-expansion.test.ts`

1. Add tests that accept an integer, accept and normalize a numeric string, reject a non-numeric string, expose both accepted JSON Schema types through `tools/list`, and pass a numeric `session_id` to a mocked Graph request.
2. Run the focused test file and verify the new compatibility and outbound-request tests fail for the current integer-only local change.

### Task 2: Implement the compatible contract

**Files:**
- Modify: `src/tools/audiences.ts`
- Regenerate: `dist/tools/audiences.js`

1. Add a shared Zod union/transform schema.
2. Keep the handler and payload types numeric after parsing.
3. Add a request-function seam to the exported handler and use the normalized number in the Graph payload.
4. Run the focused tests and verify all audience contract cases pass.

### Task 3: Add identifiable deployment metadata

**Files:**
- Create: `src/deployment-metadata.ts`
- Modify: `src/app.ts`
- Modify: `src/index.ts`
- Modify: `src/server.ts`
- Modify: `package.json`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `tests/observability.test.ts`

1. Write a failing health test for `version`, `git_sha`, `build_time`, and `deployment_id`.
2. Implement injectable health metadata and environment-backed defaults.
3. Bump the service version to `1.0.1` consistently.
4. Provide Docker build/runtime inputs for the deployment identifiers.
5. Run the observability tests and verify the response contract.

### Task 4: Verify generated output and regression suite

**Files:**
- Regenerate: `dist/**`

1. Run the TypeScript build.
2. Run all tests with the Node test runner and TSX loader.
3. Inspect the final diff to ensure unrelated workspace changes remain untouched.
