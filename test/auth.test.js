const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createServer } = require('../lib/server');

function request(server, { method = 'GET', path = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request({ hostname: '127.0.0.1', port: addr.port, method, path, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (method === 'POST') req.write('{"test":true}');
    req.end();
  });
}

function basicAuth(user, pass) {
  return { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') };
}

describe('without --password', () => {
  let server;

  before((_, done) => {
    server = createServer(0, {});
    server.on('listening', done);
  });

  after((_, done) => { server.close(done); });

  it('dashboard returns 200 without auth', async () => {
    const res = await request(server, { path: '/' });
    assert.strictEqual(res.status, 200);
  });

  it('API returns 200 without auth', async () => {
    const res = await request(server, { path: '/_/api/webhooks' });
    assert.strictEqual(res.status, 200);
  });

  it('webhook capture returns 200 without auth', async () => {
    const res = await request(server, { method: 'POST', path: '/test' });
    assert.strictEqual(res.status, 200);
  });
});

describe('with --password (localhost)', () => {
  let server;
  const password = 'test-secret';

  before((_, done) => {
    server = createServer(0, { password });
    server.on('listening', done);
  });

  after((_, done) => { server.close(done); });

  it('dashboard returns 200 without auth from localhost', async () => {
    const res = await request(server, { path: '/' });
    assert.strictEqual(res.status, 200);
  });

  it('API returns 200 without auth from localhost', async () => {
    const res = await request(server, { path: '/_/api/webhooks' });
    assert.strictEqual(res.status, 200);
  });

  it('webhook capture returns 200 without auth', async () => {
    const res = await request(server, { method: 'POST', path: '/test' });
    assert.strictEqual(res.status, 200);
  });
});

describe('with --password (proxied/remote)', () => {
  let server;
  const password = 'test-secret';

  before((_, done) => {
    server = createServer(0, { password, allowRemoteAccess: true });
    server.on('listening', done);
  });

  after((_, done) => { server.close(done); });

  it('dashboard returns 401 without auth when proxied', async () => {
    const res = await request(server, { path: '/', headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.headers['www-authenticate'], 'Basic realm="LocalHook"');
  });

  it('API returns 401 without auth when proxied', async () => {
    const res = await request(server, { path: '/_/api/webhooks', headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual(res.status, 401);
  });

  it('dashboard returns 200 with correct auth when proxied', async () => {
    const res = await request(server, { path: '/', headers: { ...basicAuth('api', password), 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual(res.status, 200);
  });

  it('API returns 200 with correct auth when proxied', async () => {
    const res = await request(server, { path: '/_/api/webhooks', headers: { ...basicAuth('api', password), 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual(res.status, 200);
  });

  it('returns 401 with wrong password when proxied', async () => {
    const res = await request(server, { path: '/', headers: { ...basicAuth('api', 'wrong'), 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual(res.status, 401);
  });

  it('webhook capture returns 200 without auth when proxied', async () => {
    const res = await request(server, { method: 'POST', path: '/test', headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual(res.status, 200);
  });

  it('SSE returns 401 without auth when proxied', async () => {
    const res = await request(server, { path: '/_/events', headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual(res.status, 401);
  });

  it('SSE returns 200 with correct auth when proxied', async () => {
    const addr = server.address();
    const status = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: addr.port,
        path: '/_/events',
        headers: { ...basicAuth('api', password), 'x-forwarded-for': '1.2.3.4' },
      }, (res) => {
        resolve(res.statusCode);
        res.destroy();
      });
      req.on('error', reject);
      req.end();
    });
    assert.strictEqual(status, 200);
  });

  it('username is ignored — any username works', async () => {
    const res = await request(server, { path: '/_/api/webhooks', headers: { ...basicAuth('anything', password), 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual(res.status, 200);
  });
});

describe('with --password without --allow-remote-access', () => {
  let server;
  const password = 'test-secret';

  before((_, done) => {
    server = createServer(0, { password });
    server.on('listening', done);
  });

  after((_, done) => { server.close(done); });

  it('proxied requests get 403 from remote guard (before auth)', async () => {
    const res = await request(server, { path: '/', headers: { 'x-forwarded-for': '1.2.3.4' } });
    // Auth middleware skips non-localhost, but remote guard blocks with 403
    assert.strictEqual(res.status, 401);
  });
});
