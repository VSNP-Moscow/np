import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code = fs.readFileSync(new URL('../../frontend/assets/js/api.js', import.meta.url), 'utf8');
for (const status of [0, 401, 500, 502]) {
  test(`session handling on connection status ${status}`, async () => {
    let removed = false;
    const window = { NP_API_BASE: 'https://example.lhr.life/api' };
    const context = {
      window, localStorage: { getItem: () => 'test-token', removeItem: () => { removed = true; } },
      fetch: async () => {
        if (!status) throw new Error('network offline');
        return { ok: false, status, json: async () => ({ error: 'test error' }) };
      },
    };
    vm.runInNewContext(code, context);
    assert.equal(await window.API.fetchMe(), null);
    assert.equal(removed, status === 401);
    assert.equal(window.API.isLoggedIn(), status !== 401);
  });
}
