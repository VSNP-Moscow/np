import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code = fs.readFileSync(new URL('../../frontend/assets/js/bootstrap.js', import.meta.url), 'utf8');
async function boot(hostname, apiBase, fail = false) {
  const scripts = [];
  const notices = [];
  let fetches = 0;
  const context = {
    window: { NP_API_BASE: '/api' }, location: { hostname }, URL, AbortSignal,
    fetch: async () => { fetches++; if (fail) throw new Error('offline'); return { ok: true, json: async () => ({ apiBase }) }; },
    document: {
      createElement: () => ({ style: {}, setAttribute() {} }),
      body: { appendChild: script => { scripts.push(script.src); script.onload(); }, prepend: notice => notices.push(notice) },
    },
  };
  await vm.runInNewContext(code, context);
  return { context, scripts, notices, fetches };
}
test('same-origin deployments retain /api without fetching Pages config', async () => {
  const result = await boot('localhost');
  assert.equal(result.fetches, 0);
  assert.equal(result.context.window.NP_API_BASE, '/api');
  assert.deepEqual(result.scripts, ['assets/js/api.js', 'assets/js/icons.js', 'assets/js/app.js']);
});
test('Pages resolves current HTTPS tunnel before loading API', async () => {
  const result = await boot('vsnp-moscow.github.io', 'https://example.trycloudflare.com/api');
  assert.equal(result.context.window.NP_API_BASE, 'https://example.trycloudflare.com/api');
  assert.equal(result.scripts.length, 3);
});
test('invalid endpoints never receive the stored login token', async () => {
  for (const endpoint of ['http://example.trycloudflare.com/api', 'https://trycloudflare.com.attacker.test/api', 'https://example.trycloudflare.com/other']) {
    const result = await boot('vsnp-moscow.github.io', endpoint);
    assert.equal(result.scripts.length, 0);
    assert.equal(result.notices.length, 1);
  }
});
test('localhost.run HTTPS endpoints are supported', async () => {
  const result = await boot('vsnp-moscow.github.io', 'https://example.lhr.life/api');
  assert.equal(result.scripts.length, 3);
});
test('config failure shows an error and does not switch to another database', async () => {
  const result = await boot('vsnp-moscow.github.io', '', true);
  assert.equal(result.scripts.length, 0);
  assert.equal(result.notices.length, 1);
});
