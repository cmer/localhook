# Changelog

## 1.1.0 (2026-03-06)

- Add `--tailscale` (`-t`) flag to automatically start Tailscale Funnel for a public HTTPS URL
- Dashboard and API routes are restricted to localhost clients by default unless `--allow-dashboard-from-remote` is specified

## 1.0.0 (2026-03-06)

Initial release.

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
