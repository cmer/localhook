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

function createTargetServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('webhook forwarding', () => {
  let server;
  let target;
  let targetPort;

  before(async () => {
    target = await createTargetServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => body += chunk);
      req.on('end', () => {
        // Echo back request details as JSON
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body,
        }));
      });
    });
    targetPort = target.address().port;

    await new Promise((resolve) => {
      server = createServer(0, {
        allowRemoteAccess: true,
        forwardTo: `http://127.0.0.1:${targetPort}`,
      });
      server.on('listening', resolve);
    });
  });

  after((_, done) => {
    server.close(() => target.close(done));
  });

  beforeEach(async () => { await clearAll(server); });

  it('forwards POST requests and mirrors response', async () => {
    const res = await request(server, {
      method: 'POST', path: '/webhook',
      headers: { 'content-type': 'application/json' },
      body: '{"event":"test"}',
    });
    assert.strictEqual(res.status, 200);
    // The response body should be the target's echo
    assert.strictEqual(res.json.method, 'POST');
    assert.strictEqual(res.json.url, '/webhook');
    assert.strictEqual(res.json.body, '{"event":"test"}');
  });

  it('forwards GET requests without body', async () => {
    const res = await request(server, { path: '/hook' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.method, 'GET');
    assert.strictEqual(res.json.body, '');
  });

  it('preserves query string in forwarded path', async () => {
    const res = await request(server, { path: '/hook?foo=bar&n=1' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.url, '/hook?foo=bar&n=1');
  });

  it('forwards custom headers and replaces host', async () => {
    const res = await request(server, {
      path: '/hook',
      headers: { 'x-stripe-signature': 'sig_abc', 'x-custom': 'test' },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.headers['x-stripe-signature'], 'sig_abc');
    assert.strictEqual(res.json.headers['x-custom'], 'test');
    assert.ok(res.json.headers['host'].includes(String(targetPort)), 'host should be target host');
  });

  it('stores forward result on captured webhook', async () => {
    const capture = await request(server, { method: 'POST', path: '/test', body: 'data' });
    // Fetch the webhook from the API to inspect forward info
    const list = await request(server, { path: '/_/api/webhooks' });
    const webhook = list.json[0];
    assert.ok(webhook.forward, 'webhook should have forward data');
    assert.strictEqual(webhook.forward.status, 200);
    assert.ok(webhook.forward.duration >= 0, 'should have duration');
    assert.ok(webhook.forward.url.includes('/test'), 'should have target url');
    assert.ok(webhook.forward.responseBody, 'should have response body');
  });

  it('connection error returns 502 and stores error', async () => {
    // Create a server with forwarding to a port that's not listening
    const badServer = await new Promise((resolve) => {
      const s = createServer(0, {
        allowRemoteAccess: true,
        forwardTo: 'http://127.0.0.1:19999',
      });
      s.on('listening', () => resolve(s));
    });

    try {
      const res = await request(badServer, { method: 'POST', path: '/fail', body: 'test' });
      assert.strictEqual(res.status, 502);
      assert.strictEqual(res.json.ok, false);
      assert.ok(res.json.error, 'should have error message');

      const list = await request(badServer, { path: '/_/api/webhooks' });
      const webhook = list.json[0];
      assert.ok(webhook.forward.error, 'should store error');
      assert.ok(!webhook.forward.status, 'should not have status on error');
    } finally {
      await new Promise(r => badServer.close(r));
    }
  });

  it('target 4xx/5xx status is mirrored to caller', async () => {
    const errorTarget = await createTargetServer((req, res) => {
      res.writeHead(422, { 'Content-Type': 'text/plain' });
      res.end('Unprocessable Entity');
    });

    const errorServer = await new Promise((resolve) => {
      const s = createServer(0, {
        allowRemoteAccess: true,
        forwardTo: `http://127.0.0.1:${errorTarget.address().port}`,
      });
      s.on('listening', () => resolve(s));
    });

    try {
      const res = await request(errorServer, { method: 'POST', path: '/test', body: '{}' });
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body, 'Unprocessable Entity');

      const list = await request(errorServer, { path: '/_/api/webhooks' });
      const webhook = list.json[0];
      assert.strictEqual(webhook.forward.status, 422);
    } finally {
      await new Promise(r => errorServer.close(() => errorTarget.close(r)));
    }
  });

  it('target 500 status is mirrored to caller', async () => {
    const errorTarget = await createTargetServer((req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    });

    const errorServer = await new Promise((resolve) => {
      const s = createServer(0, {
        allowRemoteAccess: true,
        forwardTo: `http://127.0.0.1:${errorTarget.address().port}`,
      });
      s.on('listening', () => resolve(s));
    });

    try {
      const res = await request(errorServer, { method: 'POST', path: '/test', body: '{}' });
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.body, 'Internal Server Error');
    } finally {
      await new Promise(r => errorServer.close(() => errorTarget.close(r)));
    }
  });
});

describe('no forwarding when forwardTo not set', () => {
  let server;

  before((_, done) => {
    server = createServer(0, { allowRemoteAccess: true });
    server.on('listening', done);
  });

  after((_, done) => { server.close(done); });

  it('responds with 200 and {ok:true} without forwarding', async () => {
    const res = await request(server, { method: 'POST', path: '/hook', body: 'data' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.ok, true);

    const list = await request(server, { path: '/_/api/webhooks' });
    assert.ok(!list.json[0].forward, 'should not have forward data');
  });
});

describe('forwarding with base path prefix', () => {
  let server;
  let target;

  before(async () => {
    target = await createTargetServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: req.url }));
    });

    await new Promise((resolve) => {
      server = createServer(0, {
        allowRemoteAccess: true,
        forwardTo: `http://127.0.0.1:${target.address().port}/prefix`,
      });
      server.on('listening', resolve);
    });
  });

  after((_, done) => {
    server.close(() => target.close(done));
  });

  it('prepends base path to webhook path', async () => {
    const res = await request(server, { path: '/xyz' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.url, '/prefix/xyz');
  });
});

describe('public_url API includes forwardTo', () => {
  let server;

  before((_, done) => {
    server = createServer(0, {
      allowRemoteAccess: true,
      forwardTo: 'http://127.0.0.1:4444',
    });
    server.on('listening', done);
  });

  after((_, done) => { server.close(done); });

  it('returns forwardTo in public_url response', async () => {
    const res = await request(server, { path: '/_/api/public_url' });
    assert.strictEqual(res.json.forwardTo, 'http://127.0.0.1:4444');
  });
});
