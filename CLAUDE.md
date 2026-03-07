# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is LocalHook

A local webhook testing tool (like webhook.site but self-hosted). Single Express server with an embedded vanilla HTML/CSS/JS dashboard. No build step, no database, no React.

## Running

```bash
node cli.js                            # Start on port 3000
node cli.js --port 8080                # Custom port
node cli.js --tailscale                # Start with Tailscale Funnel
node cli.js --tailscale --allow-remote-access  # Allow public dashboard access
./demo.sh                              # Send sample webhooks for testing
```

There are no tests, no linter, and no build step.

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

**Dashboard security:** A middleware guards `GET /` and `/_/*` routes by default. Requests are blocked if they have proxy headers (`X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Real-IP`) or a non-localhost `Host` header. This prevents dashboard access via reverse proxies (ngrok, Cloudflare Tunnel, Tailscale Funnel, etc.). Bypassed with `--allow-remote-access`.

**Real-time updates:** Server-Sent Events (SSE). The server broadcasts `webhook`, `delete`, and `clear` events. The frontend `EventSource` at `/_/events` receives them and re-renders.

**UI design:** Dark theme inspired by Linear. CSS custom properties in `:root` control the palette. Method badges are color-coded by HTTP method class (`.method-GET`, `.method-POST`, etc.).

## Design Decisions

- No framework (React, etc.) — the UI is simple enough for vanilla JS with innerHTML rendering
- No build tooling — the HTML file is served directly by Express
- SSE over WebSockets — simpler, no extra dependencies, sufficient for one-way server-to-client updates
- Data persisted to `~/.localhook/data.json` — no database required, survives restarts
- `/_/` prefix for internal routes avoids collisions with captured webhook paths
