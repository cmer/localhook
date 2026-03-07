const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createServer } = require('../lib/server');

function request(server, { method = 'GET', path = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request({ hostname: '127.0.0.1', port: addr.port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

async function clearAll(server) {
  await request(server, { method: 'DELETE', path: '/_/api/webhooks' });
}

function connectSSE(server) {
  return new Promise((resolve) => {
    const addr = server.address();
    const events = [];
    const req = http.request({
      hostname: '127.0.0.1', port: addr.port, path: '/_/events'
    }, (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          const match = part.match(/^data: (.+)$/m);
          if (match) {
            try { events.push(JSON.parse(match[1])); } catch {}
          }
        }
      });
      setTimeout(() => resolve({ events, close: () => res.destroy() }), 50);
    });
    req.end();
  });
}

describe('localhook', () => {
  let server;

  before((_, done) => {
    server = createServer(0, { allowRemoteAccess: true });
    server.on('listening', done);
  });

  after((_, done) => { server.close(done); });

  describe('webhook capture', () => {
    beforeEach(async () => { await clearAll(server); });

    it('captures POST with JSON body', async () => {
      const body = '{"event":"test","data":123}';
      const res = await request(server, {
        method: 'POST', path: '/webhook',
        headers: { 'content-type': 'application/json' }, body
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.ok, true);
      assert.ok(res.json.id);

      const detail = await request(server, { path: `/_/api/webhooks/${res.json.id}` });
      assert.strictEqual(detail.json.method, 'POST');
      assert.strictEqual(detail.json.path, '/webhook');
      assert.strictEqual(detail.json.body, body);
      assert.strictEqual(detail.json.headers['content-type'], 'application/json');
    });

    it('captures GET requests with empty body', async () => {
      const res = await request(server, { path: '/hook' });
      const detail = await request(server, { path: `/_/api/webhooks/${res.json.id}` });
      assert.strictEqual(detail.json.method, 'GET');
      assert.strictEqual(detail.json.body, '');
      assert.strictEqual(detail.json.size, 0);
    });

    it('captures PUT requests', async () => {
      const res = await request(server, { method: 'PUT', path: '/resource', body: 'updated' });
      const detail = await request(server, { path: `/_/api/webhooks/${res.json.id}` });
      assert.strictEqual(detail.json.method, 'PUT');
      assert.strictEqual(detail.json.body, 'updated');
    });

    it('captures PATCH requests', async () => {
      const res = await request(server, { method: 'PATCH', path: '/item', body: '{"partial":1}' });
      const detail = await request(server, { path: `/_/api/webhooks/${res.json.id}` });
      assert.strictEqual(detail.json.method, 'PATCH');
      assert.strictEqual(detail.json.body, '{"partial":1}');
    });

    it('captures DELETE requests', async () => {
      const res = await request(server, { method: 'DELETE', path: '/resource/42' });
      const detail = await request(server, { path: `/_/api/webhooks/${res.json.id}` });
      assert.strictEqual(detail.json.method, 'DELETE');
      assert.strictEqual(detail.json.path, '/resource/42');
    });

    it('preserves query string in path', async () => {
      const res = await request(server, { path: '/hook?foo=bar&n=1' });
      const detail = await request(server, { path: `/_/api/webhooks/${res.json.id}` });
      assert.strictEqual(detail.json.path, '/hook?foo=bar&n=1');
      assert.deepStrictEqual(detail.json.query, { foo: 'bar', n: '1' });
    });

    it('captures custom headers', async () => {
      const res = await request(server, {
        path: '/hook',
        headers: { 'x-stripe-signature': 'sig_abc', 'x-request-id': '12345' }
      });
      const detail = await request(server, { path: `/_/api/webhooks/${res.json.id}` });
      assert.strictEqual(detail.json.headers['x-stripe-signature'], 'sig_abc');
      assert.strictEqual(detail.json.headers['x-request-id'], '12345');
    });

    it('computes correct body size', async () => {
      const body = 'hello world!';
      const res = await request(server, { method: 'POST', path: '/hook', body });
      const detail = await request(server, { path: `/_/api/webhooks/${res.json.id}` });
      assert.strictEqual(detail.json.size, Buffer.byteLength(body));
    });

    it('computes correct size for multi-byte characters', async () => {
      const body = 'caf\u00e9 \u2615';
      const res = await request(server, { method: 'POST', path: '/hook', body });
      const detail = await request(server, { path: `/_/api/webhooks/${res.json.id}` });
      assert.strictEqual(detail.json.size, Buffer.byteLength(body));
    });

    it('includes valid ISO timestamp', async () => {
      const beforeMs = Date.now();
      const res = await request(server, { path: '/hook' });
      const afterMs = Date.now();
      const detail = await request(server, { path: `/_/api/webhooks/${res.json.id}` });
      const ts = new Date(detail.json.timestamp).getTime();
      assert.ok(ts >= beforeMs && ts <= afterMs, 'timestamp should be within request window');
    });

    it('includes IP address', async () => {
      const res = await request(server, { path: '/hook' });
      const detail = await request(server, { path: `/_/api/webhooks/${res.json.id}` });
      assert.ok(detail.json.ip, 'should have an IP address');
    });

    it('generates unique IDs for each webhook', async () => {
      const r1 = await request(server, { path: '/a' });
      const r2 = await request(server, { path: '/b' });
      assert.notStrictEqual(r1.json.id, r2.json.id);
    });

    it('stores newest webhook first', async () => {
      await request(server, { method: 'POST', path: '/first' });
      await request(server, { method: 'POST', path: '/second' });
      const list = await request(server, { path: '/_/api/webhooks' });
      assert.strictEqual(list.json.length, 2);
      assert.strictEqual(list.json[0].path, '/second');
      assert.strictEqual(list.json[1].path, '/first');
    });

    it('captures deeply nested paths', async () => {
      const res = await request(server, { path: '/a/b/c/d/e' });
      const detail = await request(server, { path: `/_/api/webhooks/${res.json.id}` });
      assert.strictEqual(detail.json.path, '/a/b/c/d/e');
    });

    it('captures form-urlencoded body', async () => {
      const body = 'name=test&value=123';
      const res = await request(server, {
        method: 'POST', path: '/form',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, body
      });
      const detail = await request(server, { path: `/_/api/webhooks/${res.json.id}` });
      assert.strictEqual(detail.json.body, body);
    });

    it('captures plain text body', async () => {
      const body = 'just plain text';
      const res = await request(server, {
        method: 'POST', path: '/text',
        headers: { 'content-type': 'text/plain' }, body
      });
      const detail = await request(server, { path: `/_/api/webhooks/${res.json.id}` });
      assert.strictEqual(detail.json.body, body);
    });

    it('does not capture /_/ prefixed routes as webhooks', async () => {
      await request(server, { path: '/_/api/webhooks' });
      await request(server, { path: '/_/api/public_url' });
      const list = await request(server, { path: '/_/api/webhooks' });
      assert.strictEqual(list.json.length, 0);
    });
  });

  describe('favicon', () => {
    beforeEach(async () => { await clearAll(server); });

    it('returns 204 for /favicon.ico', async () => {
      const res = await request(server, { path: '/favicon.ico' });
      assert.strictEqual(res.status, 204);
    });

    it('does not capture /favicon.ico as a webhook', async () => {
      await request(server, { path: '/favicon.ico' });
      const list = await request(server, { path: '/_/api/webhooks' });
      assert.strictEqual(list.json.length, 0);
    });
  });

  describe('webhook API', () => {
    beforeEach(async () => { await clearAll(server); });

    it('returns empty array when no webhooks', async () => {
      const list = await request(server, { path: '/_/api/webhooks' });
      assert.strictEqual(list.status, 200);
      assert.deepStrictEqual(list.json, []);
    });

    it('lists all captured webhooks', async () => {
      await request(server, { path: '/a' });
      await request(server, { path: '/b' });
      await request(server, { path: '/c' });
      const list = await request(server, { path: '/_/api/webhooks' });
      assert.strictEqual(list.json.length, 3);
    });

    it('gets a single webhook by ID', async () => {
      const capture = await request(server, { method: 'POST', path: '/test', body: 'data' });
      const res = await request(server, { path: `/_/api/webhooks/${capture.json.id}` });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.id, capture.json.id);
      assert.strictEqual(res.json.method, 'POST');
      assert.strictEqual(res.json.body, 'data');
    });

    it('returns 404 for non-existent webhook ID', async () => {
      const res = await request(server, { path: '/_/api/webhooks/does-not-exist' });
      assert.strictEqual(res.status, 404);
      assert.deepStrictEqual(res.json, { error: 'Not found' });
    });

    it('deletes a single webhook by ID', async () => {
      const c1 = await request(server, { path: '/keep' });
      const c2 = await request(server, { path: '/delete-me' });

      const del = await request(server, { method: 'DELETE', path: `/_/api/webhooks/${c2.json.id}` });
      assert.strictEqual(del.status, 200);
      assert.deepStrictEqual(del.json, { ok: true });

      const gone = await request(server, { path: `/_/api/webhooks/${c2.json.id}` });
      assert.strictEqual(gone.status, 404);

      const still = await request(server, { path: `/_/api/webhooks/${c1.json.id}` });
      assert.strictEqual(still.status, 200);
    });

    it('returns 404 when deleting non-existent webhook', async () => {
      const res = await request(server, { method: 'DELETE', path: '/_/api/webhooks/nope' });
      assert.strictEqual(res.status, 404);
    });

    it('clears all webhooks', async () => {
      await request(server, { path: '/a' });
      await request(server, { path: '/b' });
      const del = await request(server, { method: 'DELETE', path: '/_/api/webhooks' });
      assert.strictEqual(del.status, 200);
      assert.deepStrictEqual(del.json, { ok: true });

      const list = await request(server, { path: '/_/api/webhooks' });
      assert.deepStrictEqual(list.json, []);
    });

    it('returns null public_url when no tunnel active', async () => {
      const res = await request(server, { path: '/_/api/public_url' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.url, null);
      assert.strictEqual(res.json.service, null);
    });
  });

  describe('SSE events', () => {
    beforeEach(async () => { await clearAll(server); });

    it('broadcasts webhook event when request captured', async () => {
      const sse = await connectSSE(server);
      try {
        await request(server, { method: 'POST', path: '/sse-test', body: 'hello' });
        await new Promise(r => setTimeout(r, 50));

        const evt = sse.events.find(e => e.type === 'webhook');
        assert.ok(evt, 'should receive a webhook SSE event');
        assert.strictEqual(evt.webhook.method, 'POST');
        assert.strictEqual(evt.webhook.path, '/sse-test');
        assert.strictEqual(evt.webhook.body, 'hello');
      } finally {
        sse.close();
      }
    });

    it('broadcasts delete event when webhook removed', async () => {
      const capture = await request(server, { path: '/to-delete' });
      const sse = await connectSSE(server);
      try {
        await request(server, { method: 'DELETE', path: `/_/api/webhooks/${capture.json.id}` });
        await new Promise(r => setTimeout(r, 50));

        const evt = sse.events.find(e => e.type === 'delete');
        assert.ok(evt, 'should receive a delete SSE event');
        assert.strictEqual(evt.id, capture.json.id);
      } finally {
        sse.close();
      }
    });

    it('broadcasts clear event when all webhooks removed', async () => {
      await request(server, { path: '/a' });
      await request(server, { path: '/b' });
      const sse = await connectSSE(server);
      try {
        await request(server, { method: 'DELETE', path: '/_/api/webhooks' });
        await new Promise(r => setTimeout(r, 50));

        const evt = sse.events.find(e => e.type === 'clear');
        assert.ok(evt, 'should receive a clear SSE event');
      } finally {
        sse.close();
      }
    });

    it('delivers events to multiple SSE clients', async () => {
      const sse1 = await connectSSE(server);
      const sse2 = await connectSSE(server);
      try {
        await request(server, { method: 'POST', path: '/multi' });
        await new Promise(r => setTimeout(r, 50));

        assert.ok(sse1.events.find(e => e.type === 'webhook'), 'client 1 should receive event');
        assert.ok(sse2.events.find(e => e.type === 'webhook'), 'client 2 should receive event');
      } finally {
        sse1.close();
        sse2.close();
      }
    });
  });

  describe('max webhooks limit', () => {
    beforeEach(async () => { await clearAll(server); });

    it('enforces maximum of 500 stored webhooks', async () => {
      const total = 505;
      for (let i = 0; i < total; i++) {
        await request(server, { path: `/w${i}` });
      }
      const list = await request(server, { path: '/_/api/webhooks' });
      assert.strictEqual(list.json.length, 500);
      // Newest should be first
      assert.strictEqual(list.json[0].path, `/w${total - 1}`);
    });
  });
});
