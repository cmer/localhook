# LocalHook REST API

All API routes are under the `/_/` prefix. By default, they are only accessible from localhost. To allow remote access (e.g. via Tailscale Funnel), start with `--allow-remote-access`.

## Endpoints

### Get public URL

```
GET /_/api/public_url
```

Returns the current public URL (set when using `--tailscale`), or `null` if not available.

```bash
curl http://localhost:3000/_/api/public_url
```

```json
{ "url": "https://myhost.tail1234.ts.net" }
```

### List all webhooks

```
GET /_/api/webhooks
```

Returns an array of all captured webhooks, newest first.

```bash
curl http://localhost:3000/_/api/webhooks
```

### Get a single webhook

```
GET /_/api/webhooks/:id
```

Returns a single webhook by ID, or 404 if not found.

```bash
curl http://localhost:3000/_/api/webhooks/a1b2c3d4e5f67890
```

### Delete a single webhook

```
DELETE /_/api/webhooks/:id
```

Deletes a webhook by ID. Returns 404 if not found.

```bash
curl -X DELETE http://localhost:3000/_/api/webhooks/a1b2c3d4e5f67890
```

```json
{ "ok": true }
```

### Clear all webhooks

```
DELETE /_/api/webhooks
```

Deletes all captured webhooks.

```bash
curl -X DELETE http://localhost:3000/_/api/webhooks
```

```json
{ "ok": true }
```

### SSE event stream

```
GET /_/events
```

Server-Sent Events stream for real-time updates. Events:

- `webhook` — a new webhook was captured (includes the full webhook object)
- `delete` — a webhook was deleted (includes the webhook `id`)
- `clear` — all webhooks were cleared

```bash
curl -N http://localhost:3000/_/events
```
