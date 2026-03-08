# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is LocalHook

A local webhook testing tool (like webhook.site but self-hosted). Single Express server with an embedded vanilla HTML/CSS/JS dashboard. No build step, no database, no React.

## Running

```bash
node cli.js                            # Start on port 3000
node cli.js --port 8080                # Custom port
node cli.js --tailscale                # Start with Tailscale Funnel
node cli.js --cloudflare               # Start with Cloudflare Quick Tunnel
node cli.js --tailscale --allow-remote-access  # Allow public dashboard access
node cli.js --password secret          # Password-protect remote dashboard access
node cli.js --poll                     # Force polling instead of SSE
node cli.js --data-file /tmp/wh.json   # Custom data file path
node cli.js --forward-to http://localhost:4444  # Forward webhooks to local app
node cli.js --forward-to http://localhost:4444/api/webhooks  # Forward with base path
./demo.sh                              # Send sample webhooks for testing
./scripts/test.sh                      # Run tests
```

There is no linter and no build step. Tests use the Node.js built-in test runner (`node --test`).

## Architecture

**3 source files, single dependency (express):**

- `cli.js` — CLI entry point (parses `--port`/`-p`). The `bin` field in package.json makes `npx @cmer/localhook` work.
- `lib/server.js` — Express server. All state lives in-memory in a `webhooks` array, persisted to `~/.localhook/data.json` (debounced writes, max 500 entries).
- `public/index.html` — Entire UI in one file: embedded `<style>` + `<script>`, no external assets.

**Route conventions:**

- `GET /` — serves the dashboard HTML
- `GET /favicon.ico` — returns 204 (ignored, not captured)
- `/_/*` — reserved for internal API and SSE (never captured as webhooks)
  - `GET /_/events` — SSE stream for real-time updates
  - `GET /_/api/public_url` — get the current public URL
  - `GET /_/api/webhooks` — list all captured webhooks
  - `GET /_/api/webhooks/:id` — view a single webhook
  - `DELETE /_/api/webhooks/:id` — delete one
  - `DELETE /_/api/webhooks` — clear all
- **Everything else** — captured as a webhook (any HTTP method, any path)

**Dashboard security:** Two middleware layers guard `GET /` and `/_/*` routes:
1. **Basic Auth** (when `--password` is set): Requires HTTP Basic Auth for remote/proxied requests. Localhost requests are never challenged.
2. **Remote access guard** (unless `--allow-remote-access`): Blocks requests with proxy headers (`X-Forwarded-For`, etc.) or non-localhost `Host` header.

Typical combo for public access: `--password secret --allow-remote-access --tailscale` (or `--cloudflare`).

**Webhook forwarding:** When `--forward-to <url>` is set, incoming webhooks are forwarded synchronously to the target before responding to the caller. The caller receives the target's actual response status/body (or 502 on connection error). Method, path, headers, and body are preserved. Uses Node.js built-in `fetch` (requires Node 18+).

**Real-time updates:** Server-Sent Events (SSE). The server broadcasts `webhook`, `delete`, and `clear` events. The frontend `EventSource` at `/_/events` receives them and re-renders.

**UI design:** Dark theme inspired by Linear. CSS custom properties in `:root` control the palette. Method badges are color-coded by HTTP method class (`.method-GET`, `.method-POST`, etc.).

## Design Decisions

- No framework (React, etc.) — the UI is simple enough for vanilla JS with innerHTML rendering
- No build tooling — the HTML file is served directly by Express
- SSE over WebSockets — simpler, no extra dependencies, sufficient for one-way server-to-client updates
- Data persisted to `~/.localhook/data.json` — no database required, survives restarts
- `/_/` prefix for internal routes avoids collisions with captured webhook paths
