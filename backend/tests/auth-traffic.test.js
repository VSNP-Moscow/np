import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Set before importing db.js so no local or deployed users can be touched.
process.env.DATABASE_URL = "";
process.env.JWT_SECRET = "auth-traffic-isolated-test";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "np-auth-test-")), "test.sqlite");
const { initSchema, query } = await import("../src/db.js");
const { requireAuth, signToken } = await import("../src/middleware/auth.js");

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("authentication reads metadata without downloading the avatar", async () => {
  await initSchema();
  await query(`INSERT INTO users (id, full_name, email, password_hash, role, avatar_mime, avatar_bytes)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  ["test-avatar-user", "Test", "avatar@example.test", "hash", "user", "image/png", Buffer.alloc(1024 * 1024, 1)]);
  const req = { headers: { authorization: `Bearer ${signToken("test-avatar-user")}` } };
  let called = false;
  await requireAuth(req, response(), (error) => { assert.ifError(error); called = true; });
  assert.equal(called, true);
  assert.equal(req.user.hasAvatar, true);
  assert.equal(req.dbUser.avatar_bytes, 1);
  assert.ok(JSON.stringify(req.dbUser).length < 2000);
  await query("UPDATE users SET avatar_bytes=NULL WHERE id=$1", ["test-avatar-user"]);
  await requireAuth(req, response(), (error) => assert.ifError(error));
  assert.equal(req.user.hasAvatar, false);
});

test("an invalid token is rejected before looking up the user", async () => {
  const res = response();
  await requireAuth({ headers: { authorization: "Bearer invalid" } }, res, () => assert.fail("must not continue"));
  assert.equal(res.statusCode, 401);
});

test("database failures reach the error handler instead of invalidating the session", async () => {
  await query("ALTER TABLE users RENAME TO users_unavailable");
  const res = response();
  let received;
  await requireAuth({ headers: { authorization: `Bearer ${signToken("test-avatar-user")}` } }, res, (error) => { received = error; });
  assert.ok(received instanceof Error);
  assert.equal(res.body, undefined);
});
