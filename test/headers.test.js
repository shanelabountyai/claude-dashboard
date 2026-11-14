'use strict';

// K7: a foreign page can frame the dashboard and lure a click on a run button; the
// framed page's API calls are same-origin, so the SEC-02 check does not stop them.
// Every response (page, static files, API, 403s) must refuse framing.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, headers: { Host: `localhost:${port}`, ...headers } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('every response refuses framing and sets nosniff and no-referrer', async (t) => {
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  t.after(() => server.kill());
  await new Promise((resolve) => server.stdout.once('data', resolve));

  const cases = [
    ['/', {}, 200],
    ['/app.js', {}, 200],
    ['/api/config', {}, 200],
    ['/api/config', { 'Sec-Fetch-Site': 'cross-site' }, 403]
  ];
  for (const [urlPath, headers, status] of cases) {
    const res = await get(port, urlPath, headers);
    assert.strictEqual(res.statusCode, status, urlPath);
    assert.strictEqual(res.headers['x-frame-options'], 'DENY', `${urlPath} X-Frame-Options`);
    assert.strictEqual(res.headers['content-security-policy'], "frame-ancestors 'none'", `${urlPath} CSP`);
    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff', `${urlPath} nosniff`);
    assert.strictEqual(res.headers['referrer-policy'], 'no-referrer', `${urlPath} Referrer-Policy`);
  }
});
