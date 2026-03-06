# LocalHook

Local webhook testing tool. Like [webhook.site](https://webhook.site), but on your machine.

Send webhooks to `localhost` instead of a third-party service. Inspect request details, headers, and body in a real-time dashboard.

![LocalHook Dashboard](.github/screenshot.png)

## Quick Start

```bash
npx localhook
```

Then send requests to `http://localhost:3000/any-path` and watch them appear in the dashboard.

## Usage

```bash
# Default port 3000
npx localhook

# Custom port
npx localhook --port 8080
```

Open `http://localhost:3000` in your browser to see the dashboard.

Any HTTP request to any path (except `/`) gets captured:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"event": "user.created", "user_id": "123"}'
```

Incoming requests are also logged in the terminal:

```
  3/6/2026 5:37:24 PM  POST    /webhooks/stripe  494b  application/json
  3/6/2026 5:37:25 PM  GET     /api/health?status=ok
  3/6/2026 5:37:26 PM  DELETE  /api/sessions/sess_9fKx2mNpQ
```

## Features

- **Real-time** -- requests appear instantly via Server-Sent Events, no refresh needed
- **All HTTP methods** -- GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- **Request inspection** -- method, URL, headers, query parameters, body
- **JSON formatting** -- auto-detects and pretty-prints JSON with syntax highlighting
- **Word wrap** -- toggle word wrap for long payloads
- **Copy** -- one-click copy for request body
- **Persistent** -- data survives restarts (stored at `~/.localhook/data.json`)
- **Zero config** -- no database, no build step, no accounts
- **Terminal logging** -- see requests in your terminal without opening the dashboard

## How It Works

LocalHook runs a single Express server. `GET /` serves the dashboard. Every other request is captured as a webhook and broadcast to the dashboard via SSE.

Data is stored in `~/.localhook/data.json` (max 500 entries).

## License

MIT
