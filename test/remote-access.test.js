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
    req.end();
  });
}

describe('remote access guard (no password, no --allow-remote-access)', () => {
  let server;

  before((_, done) => {
    server = createServer(0, {});
    server.on('listening', done);
  });

  after((_, done) => { server.close(done); });

  it('blocks dashboard with x-forwarded-for header', async () => {
    const res = await request(server, { path: '/', headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual(res.status, 403);
  });

  it('blocks API with x-forwarded-for header', async () => {
    const res = await request(server, { path: '/_/api/webhooks', headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual(res.status, 403);
  });

  it('blocks SSE with x-forwarded-for header', async () => {
    const res = await request(server, { path: '/_/events', headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual(res.status, 403);
  });

  it('blocks dashboard with x-forwarded-host header', async () => {
    const res = await request(server, { path: '/', headers: { 'x-forwarded-host': 'example.com' } });
    assert.strictEqual(res.status, 403);
  });

  it('blocks dashboard with x-forwarded-proto header', async () => {
    const res = await request(server, { path: '/', headers: { 'x-forwarded-proto': 'https' } });
    assert.strictEqual(res.status, 403);
  });

  it('blocks dashboard with x-real-ip header', async () => {
    const res = await request(server, { path: '/', headers: { 'x-real-ip': '1.2.3.4' } });
    assert.strictEqual(res.status, 403);
  });

  it('includes helpful message in 403 response', async () => {
    const res = await request(server, { path: '/', headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.ok(res.body.includes('--allow-remote-access'));
  });

  it('allows webhook capture even with proxy headers', async () => {
    const res = await request(server, { method: 'POST', path: '/hook', headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual(res.status, 200);
  });

  it('allows localhost dashboard access without proxy headers', async () => {
    const res = await request(server, { path: '/' });
    assert.strictEqual(res.status, 200);
  });

  it('allows localhost API access without proxy headers', async () => {
    const res = await request(server, { path: '/_/api/webhooks' });
    assert.strictEqual(res.status, 200);
  });
});

describe('remote access guard with --allow-remote-access (no password)', () => {
  let server;

  before((_, done) => {
    server = createServer(0, { allowRemoteAccess: true });
    server.on('listening', done);
  });

  after((_, done) => { server.close(done); });

  it('allows dashboard with x-forwarded-for header', async () => {
    const res = await request(server, { path: '/', headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual(res.status, 200);
  });

  it('allows API with x-forwarded-for header', async () => {
    const res = await request(server, { path: '/_/api/webhooks', headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual(res.status, 200);
  });

  it('allows SSE with proxy headers', async () => {
    const addr = server.address();
    const status = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: addr.port, path: '/_/events',
        headers: { 'x-forwarded-for': '1.2.3.4' },
      }, (res) => {
        resolve(res.statusCode);
        res.destroy();
      });
      req.on('error', reject);
      req.end();
    });
    assert.strictEqual(status, 200);
  });

  it('allows webhook capture with proxy headers', async () => {
    const res = await request(server, { method: 'POST', path: '/hook', headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual(res.status, 200);
  });
});
