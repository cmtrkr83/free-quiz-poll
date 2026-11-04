import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptchaStore, CAPTCHA_BG } from '../src/captcha.js';
import { parseCaptchaSvg } from './helpers.js';

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
