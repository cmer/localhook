# Changelog

## 1.3.0 (2026-03-10)

- Add `X-Forwarded-By: LocalHook/<version>` header to forwarded requests for identification
- Prevent infinite forwarding loops: incoming requests with `X-Forwarded-By` starting with `LocalHook` are captured but not re-forwarded

## 1.2.0 (2026-03-07)

- Add `--forward-to <url>` flag to forward incoming webhooks to a local app while still capturing them in the dashboard
- Sidebar shows forwarding target when active
- Requires Node.js 18+ (for built-in `fetch`)

## 1.1.0 (2026-03-07)

- Add `--tailscale` and `--cloudflare` to automatically start either Tailscale Funnel Cloudflare Quick Tunnel for a public HTTPS URL
- Dashboard and API routes are restricted to localhost clients by default unless `--allow-remote-access` is specified
- Add `--password <value>` flag for HTTP Basic Auth on remote dashboard/API access (localhost is never challenged)
- Add `--data-file <path>` flag to specify a custom data file location (default: `~/.localhook/data.json`)
- Added REST API plus doc in `API.md`
- Added Light mode
- Added fallback to polling if SSE fails in dashboard
- Added SSE heartbeat for better reliability

## 1.0.0 (2026-03-06)

- Capture any HTTP method and path as a webhook
- Real-time dashboard with Server-Sent Events
- Dark theme UI inspired by Linear
- Request details: method, URL, headers, query parameters, body
- JSON formatting with syntax highlighting
- Word wrap toggle
- One-click copy for request body and example curl command
- Terminal logging of incoming requests
- Persistent storage at `~/.localhook/data.json`
- Delete individual requests or clear all
- Live connection status indicator
- Run with `npx @cmer/localhook` -- no install required
