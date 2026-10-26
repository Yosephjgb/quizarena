import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, makeAdmin } from './helpers.js';

let ctx, admin;
before(async () => {
  ctx = await startTestApp();
  admin = makeAdmin(ctx.db);
});
after(() => ctx.close());

test('register validates input and rejects duplicates', async () => {
  const c = ctx.client();
  let r = await c.req('POST', '/api/auth/register', { email: 'bad', username: 'ab', password: 'short' });
  assert.equal(r.status, 400);

  r = await c.req('POST', '/api/auth/register', { email: 'a@test.dev', username: 'alice', password: 'password123' });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, 'player');

  r = await ctx.client().req('POST', '/api/auth/register', { email: 'A@test.dev', username: 'other', password: 'password123' });
  assert.equal(r.status, 409, 'email is case-insensitive unique');
  r = await ctx.client().req('POST', '/api/auth/register', { email: 'x@test.dev', username: 'ALICE', password: 'password123' });
  assert.equal(r.status, 409, 'username is case-insensitive unique');
});

test('password is stored hashed, never in plain text', () => {
  const row = ctx.db.prepare("SELECT password_hash FROM users WHERE username = 'alice'").get();
  assert.notEqual(row.password_hash, 'password123');
  assert.match(row.password_hash, /^\$2[aby]\$/);
});

test('login, /me and logout', async () => {
  const c = ctx.client();
  let r = await c.req('POST', '/api/auth/login', { email: 'a@test.dev', password: 'wrong-password' });
  assert.equal(r.status, 401);
  r = await c.req('POST', '/api/auth/login', { email: 'a@test.dev', password: 'password123' });
  assert.equal(r.status, 200);
  r = await c.req('GET', '/api/auth/me');
  assert.equal(r.body.user.username, 'alice');
  assert.equal((await ctx.client().req('GET', '/api/auth/me')).status, 401);
});

test('players cannot reach admin routes; admins can', async () => {
  const player = ctx.client();
  await player.req('POST', '/api/auth/login', { email: 'a@test.dev', password: 'password123' });
  assert.equal((await player.req('GET', '/api/admin/questions')).status, 403);
  assert.equal((await ctx.client().req('GET', '/api/admin/questions')).status, 401);

  const boss = ctx.client();
  assert.equal((await boss.req('POST', '/api/auth/login', admin)).status, 200);
  assert.equal((await boss.req('GET', '/api/admin/questions')).status, 200);
});

test('admin question CRUD with validation', async () => {
  const boss = ctx.client();
  await boss.req('POST', '/api/auth/login', admin);

  let r = await boss.req('POST', '/api/admin/questions', { text: 'Bad?', options: ['only one'], correctIndex: 0 });
  assert.equal(r.status, 400);
  r = await boss.req('POST', '/api/admin/questions', { text: 'Bad?', options: ['a', 'b'], correctIndex: 5 });
  assert.equal(r.status, 400, 'correctIndex must be within options');

  r = await boss.req('POST', '/api/admin/questions', { text: 'What is 2+2?', options: ['3', '4'], correctIndex: 1, category: 'Math' });
  assert.equal(r.status, 201);
  const id = r.body.question.id;

  r = await boss.req('PUT', `/api/admin/questions/${id}`, { text: 'What is 3+3?', options: ['6', '7', '8'], correctIndex: 0, category: 'Math', timeLimit: 10 });
  assert.equal(r.body.question.text, 'What is 3+3?');

  r = await ctx.client().req('GET', '/api/categories');
  assert.ok(r.body.categories.some((c) => c.category === 'Math'));

  assert.equal((await boss.req('DELETE', `/api/admin/questions/${id}`)).status, 200);
  assert.equal((await boss.req('DELETE', `/api/admin/questions/${id}`)).status, 404);
});

test('banning a user blocks login and kills existing sessions', async () => {
  const victim = ctx.client();
  await victim.req('POST', '/api/auth/register', { email: 'v@test.dev', username: 'victim', password: 'password123' });
  const victimId = (await victim.req('GET', '/api/auth/me')).body.user.id;

  const boss = ctx.client();
  await boss.req('POST', '/api/auth/login', admin);
  const r = await boss.req('PATCH', `/api/admin/users/${victimId}`, { banned: true });
  assert.equal(r.body.user.banned, true);

  assert.equal((await victim.req('GET', '/api/auth/me')).status, 401, 'existing cookie stops working');
  assert.equal((await ctx.client().req('POST', '/api/auth/login', { email: 'v@test.dev', password: 'password123' })).status, 403);

  const self = (await boss.req('GET', '/api/auth/me')).body.user.id;
  assert.equal((await boss.req('PATCH', `/api/admin/users/${self}`, { role: 'player' })).status, 400, "can't demote yourself");
});

test('SQL injection attempts are treated as plain text', async () => {
  const boss = ctx.client();
  await boss.req('POST', '/api/auth/login', admin);
  const r = await boss.req('GET', "/api/admin/users?q=' OR 1=1 --");
  assert.equal(r.status, 200);
  assert.equal(r.body.users.length, 0);
});
