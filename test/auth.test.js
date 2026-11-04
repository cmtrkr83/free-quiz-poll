import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer, PINNED_USERNAME, PINNED_PASSWORD_HASH } from '../server.js';
import { hashPassword } from '../src/auth.js';
import { createCaptchaStore, CAPTCHA_BG } from '../src/captcha.js';
import { parseCaptchaSvg, tmpDir, loginAsPinned, getCaptcha, TEST_ADMIN_PASSWORD } from './helpers.js';

test('captcha üretir: id, kod ve hayalet karakterler', () => {
  const store = createCaptchaStore();
  const { id, svg } = store.create();
  assert.match(id, /^cap_[0-9a-f]{12}$/);
  const parsed = parseCaptchaSvg(svg);
  assert.equal(parsed.id, id);
  assert.equal(parsed.code.length, 5);
  assert.match(parsed.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{5}$/);
  const ghosts = [...svg.matchAll(/<text [^>]*fill="([^"]+)"/g)].filter((m) => m[1] === CAPTCHA_BG);
  assert.equal(ghosts.length, 2);
});

test('verify: doğru kod başarılı, tek kullanımlık', () => {
  const store = createCaptchaStore();
  const { id, svg } = store.create();
  const { code } = parseCaptchaSvg(svg);
  assert.equal(store.verify(id, code.toLowerCase() + '  '), true); // büyük/küçük harf + trim duyarsız
  assert.equal(store.verify(id, code), false); // tüketildi
});

test('verify: yanlış kod id yakmaz; süre dolunca düşer; bilinmeyen id reddedilir', () => {
  let fake = 0;
  const store = createCaptchaStore({ ttlMs: 1000, now: () => fake });
  const { id, svg } = store.create();
  const { code } = parseCaptchaSvg(svg);
  const wrong = code === 'AAAAA' ? 'BBBBB' : 'AAAAA';
  assert.equal(store.verify(id, wrong), false);
  assert.equal(store.verify(id, code), true);
  assert.equal(store.verify('cap_unknown', 'X'), false);
  const e2 = store.create();
  fake = 5000;
  assert.equal(store.verify(e2.id, parseCaptchaSvg(e2.svg).code), false);
});

test('store cap ve alfabe temizliği', () => {
  const store = createCaptchaStore({ maxEntries: 3 });
  for (let i = 0; i < 6; i += 1) store.create();
  assert.ok(store.size <= 3);
  const { svg } = store.create();
  // Yalnızca görüntülenen karakterler (metin içerikleri) karışmayan alfabeyle sınırlı;
  // geometri/renk sayıları (width=150, fill=#7c2d12) bu alphabete tabi değildir.
  const shown = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join('');
  assert.ok(!/[01OI]/.test(shown));
  assert.ok(shown.length >= 7); // 5 gerçek + 2 hayalet
});

test('captcha endpoint: svg döner ve rate limit uygular', async (t) => {
  const dataDir = tmpDir();
  const server = createServer({ dataDir, adminKey: '' });
  const addr = await server.start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;
  t.after(async () => {
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const res = await fetch(`${base}/api/auth/captcha`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(parseCaptchaSvg(await res.text()).code.length, 5);

  let last;
  for (let i = 0; i < 31; i += 1) last = await fetch(`${base}/api/auth/captcha`);
  assert.equal(last.status, 429);
});

test('tohum: cmtrkr her açılışta sabit ve kilitli (varsayılan hash)', async (t) => {
  const dataDir = tmpDir();
  const server = createServer({ dataDir, adminKey: '' });
  t.after(async () => {
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const addr = await server.start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;
  const u = Object.values(server.store.users).find((x) => x.usernameKey === PINNED_USERNAME);
  assert.ok(u, 'cmtrkr tohumlanmış olmalı');
  assert.equal(u.locked, true);
  assert.equal(u.passwordHash, PINNED_PASSWORD_HASH);
  // Test şifresi prod hash'ine karşı çalışmamalı (captcha geçerli olsa bile 401)
  const cap = await getCaptcha(base);
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: PINNED_USERNAME,
      password: TEST_ADMIN_PASSWORD,
      captchaId: cap.id,
      captchaCode: cap.code,
    }),
  });
  assert.equal(res.status, 401);
});

test('re-pin: db elle değiştirilse bile açılışta geri gelir, id korunur', async (t) => {
  const dataDir = tmpDir();
  let s2 = null;
  t.after(async () => {
    if (s2) await s2.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const s1 = createServer({ dataDir, adminKey: '', pinnedAdminPassword: TEST_ADMIN_PASSWORD });
  const a1 = await s1.start(0, '127.0.0.1');
  const base1 = `http://127.0.0.1:${a1.port}`;
  const { user } = await loginAsPinned(base1);
  await s1.close();

  const dbPath = path.join(dataDir, 'db.json');
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const target = Object.values(db.users).find((x) => x.usernameKey === PINNED_USERNAME);
  target.passwordHash = await hashPassword('baskasifre9'); // elle sabotaj
  fs.writeFileSync(dbPath, JSON.stringify(db));

  s2 = createServer({ dataDir, adminKey: '', pinnedAdminPassword: TEST_ADMIN_PASSWORD });
  const a2 = await s2.start(0, '127.0.0.1');
  const base2 = `http://127.0.0.1:${a2.port}`;
  const again = await loginAsPinned(base2);
  assert.equal(again.user.id, user.id); // id değişmez → etkinlik sahipliği korunur
  const u2 = Object.values(s2.store.users).find((x) => x.usernameKey === PINNED_USERNAME);
  assert.equal(u2.locked, true);
  assert.notEqual(u2.passwordHash, target.passwordHash); // sabotaj aşılmış, yeniden sabitlenmiş
});

test('login: captcha eksik/yanlış 400, yanlış şifre (geçerli captcha) 401', async (t) => {
  const dataDir = tmpDir();
  const server = createServer({ dataDir, adminKey: '', pinnedAdminPassword: TEST_ADMIN_PASSWORD });
  t.after(async () => {
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const addr = await server.start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;
  const login = `${base}/api/auth/login`;
  const post = (body) =>
    fetch(login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  // Captcha yoksa 400
  const noCap = await post({ username: 'cmtrkr', password: TEST_ADMIN_PASSWORD });
  assert.equal(noCap.status, 400);
  assert.match((await noCap.json()).error, /captcha/i);

  // Bilinmeyen id 400
  const cap = await getCaptcha(base);
  const wrongId = await post({
    username: 'cmtrkr', password: TEST_ADMIN_PASSWORD,
    captchaId: 'cap_000000000000', captchaCode: cap.code,
  });
  assert.equal(wrongId.status, 400);

  // Yanlış kod 400 — ve id'yi YAKMAZ (aynı görselle tekrar denenebilir)
  const wrongCode = await post({
    username: 'cmtrkr', password: TEST_ADMIN_PASSWORD,
    captchaId: cap.id, captchaCode: 'ZZZZZ',
  });
  assert.equal(wrongCode.status, 400);
  const retry = await post({
    username: 'cmtrkr', password: TEST_ADMIN_PASSWORD,
    captchaId: cap.id, captchaCode: cap.code,
  });
  assert.equal(retry.status, 200, await retry.clone().text());

  // Geçerli captcha + yanlış şifre → 401
  const cap2 = await getCaptcha(base);
  const badPass = await post({
    username: 'cmtrkr', password: 'yanlisifre1',
    captchaId: cap2.id, captchaCode: cap2.code,
  });
  assert.equal(badPass.status, 401);
});
