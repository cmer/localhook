const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createServer } = require('../lib/server');

function connectSSE(server) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/_/events',
      headers: { 'Accept': 'text/event-stream' },
    }, (res) => {
      resolve(res);
    });
    req.on('error', reject);
    req.end();
  });
}

function collectSSEEvents(res, duration) {
  return new Promise((resolve) => {
    const events = [];
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const event = {};
        for (const line of trimmed.split('\n')) {
          if (line.startsWith('event:')) event.event = line.slice(6).trim();
          else if (line.startsWith('data:')) event.data = line.slice(5).trim();
        }
        if (event.event || event.data !== undefined) events.push(event);
      }
    };
    res.on('data', onData);
    setTimeout(() => {
      res.removeListener('data', onData);
      res.destroy();
      resolve(events);
    }, duration);
  });
}

describe('SSE heartbeat', () => {
  let server;

  before((_, done) => {
    server = createServer(0, { heartbeatInterval: 100 });
    server.on('listening', done);
  });

  after((_, done) => { server.close(done); });

  it('sends heartbeat events within the configured interval', async () => {
    const res = await connectSSE(server);
    const events = await collectSSEEvents(res, 350);
    const heartbeats = events.filter(e => e.event === 'heartbeat');
    assert.ok(heartbeats.length >= 2, `Expected at least 2 heartbeats, got ${heartbeats.length}`);
  });

  it('heartbeat format is valid SSE named event', async () => {
    const res = await connectSSE(server);
    const events = await collectSSEEvents(res, 200);
    const heartbeats = events.filter(e => e.event === 'heartbeat');
    assert.ok(heartbeats.length >= 1, 'Expected at least 1 heartbeat');
    for (const hb of heartbeats) {
      assert.strictEqual(hb.event, 'heartbeat');
      assert.strictEqual(hb.data, '');
    }
  });

  it('webhook broadcasts still work alongside heartbeats', async () => {
    const res = await connectSSE(server);
    const addr = server.address();

    // Send a webhook after a short delay
    setTimeout(() => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: addr.port,
        method: 'POST',
        path: '/test-heartbeat',
        headers: { 'Content-Type': 'application/json' },
      });
      req.write('{"test":true}');
      req.end();
    }, 50);

    const events = await collectSSEEvents(res, 350);
    const heartbeats = events.filter(e => e.event === 'heartbeat');
    const webhooks = events.filter(e => {
      if (!e.data) return false;
      try { return JSON.parse(e.data).type === 'webhook'; } catch { return false; }
    });
    assert.ok(heartbeats.length >= 1, 'Expected heartbeat events');
    assert.ok(webhooks.length >= 1, 'Expected webhook event');
  });
});
