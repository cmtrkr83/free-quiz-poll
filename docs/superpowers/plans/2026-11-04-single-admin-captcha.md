# Tek Yetkili Yönetici + CAPTCHA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sistemin tek yetkili hesabını (`cmtrkr`) her açılışta sabitlemek (şifre hash'i kodda, düz metin yok), yeni kaydı kapatmak ve giriş/kayıt akışına yerel SVG CAPTCHA eklemek.

**Architecture:** `src/captcha.js` bağımsız, bağımlılıksız bir SVG CAPTCHA modülü üretir (bellek içi store + factory). `server.js` `start()` içinde sabit yöneticiyi tohumlar, register'ı kalıcı kapatır, login/register'da CAPTCHA doğrular. UI (`public/js/host.js`) CAPTCHA görselini data-URI olarak gösterir. Testler `node:test` ile TDD ilerler; gerçek şifre hiçbir repo dosyasında düz metin geçmez (yalnızca scrypt hash'i).

**Tech Stack:** Node ≥20.19, Express 4, Socket.IO, vanilla JS (build adımı yok), `node:test`. Yeni bağımlılık YOK.

**Spec:** `docs/superpowers/specs/2026-11-04-single-admin-captcha-design.md`

## Global Constraints

- Yeni npm bağımlılığı eklenmez; SVG elle üretilir.
- Arayüz/metinler Türkçe. Sabit metinler: `Yeni kayıt kapalıdır.` (403), `Şifre yalnızca harf ve rakam içerebilir.`, `CAPTCHA doğrulaması başarısız. Görseli yenileyip tekrar deneyin.` (400), `Çok fazla istek. Lütfen biraz bekleyin.` (429 captcha GET).
- **Gerçek sabit şifre hiçbir repo dosyasında düz metin GEÇMEZ** (kod, test, doküman, plan dahil). Elde edilişi: oturum bağlamından; shell'e `read -s PIN_PWD` ile alınır, dosyaya yazılmaz. Kodda yalnızca scrypt hash'i (`PINNED_PASSWORD_HASH`) bulunur.
- `PINNED_USERNAME = 'cmtrkr'`, `REGISTRATION_OPEN = false` (kalıcı), `CAPTCHA_BG = '#f0f2f5'`.
- CAPTCHA: kod = `randomCode(5)` (`src/util.js` `CODE_ALPHABET`, I/O/0/1 yok), id = `newId('cap')`, TTL 5 dk, maxEntries 1000, GET limiti IP başına 30/dk.
- Captcha tek kullanımlık: **yalnız başarılı doğrulamada** silinir (yanlış kod aynı görselle tekrar denenebilir).
- Test komutu: `node --test test/smoke.test.js test/auth.test.js` (`test/ui.check.mjs` DAHİL EDİLMEZ).
- Captcha bypass/enable bayrağı YOK; testler gerçek akışı kullanır.

## Review Focus

1. **SVG parse sözleşmesi** (üretici ↔ test helpers ↔ istemci id çıkarma) — format değişirse testler kör kalır. → Görev 1: parse testi (`real.length === 5`, id round-trip); Görev 2: API'den çekilen SVG parse edilip 5 karakter döndürüyor.
2. **Yanlış CAPTCHA denemesi görseli yakmalı** (insan yazım hatası) — yanlış kodda id yanarsa kullanıcı her seferinde yeniden yükler. → Görev 4: yanlış→aynı id ile doğru→200 testi.
3. **Re-pin kullanıcı id'sini değiştirmemeli** (mevcut etkinlikler sahipsiz kalır). → Görev 3: id değişmez + db'ye elle müdahale sonrası tekrar giriş testi.
4. **Login rate limiter (15 dk'da 20/IP) testleri kırmamalı** — her test kendi `createServer` örneğini açar (limiter instance başına). → Görev 4/5 notu: hiçbir test tek instance'da 20+ login yapmaz.
5. **Register kapanışının tüm register bağımlı testleri kırması + UI register sekmesi** — Görev 5 tüm kırılan yerleri tek seferde listeler; UI register sekmesi kapanış mesajı Görev 7'de manuel doğrulanır. Ayrıca gerçek şifre sızıntısı: Görev 3 ve Görev 7'de `grep -F "$PIN_PWD"` doğrulaması.

---

### Task 1: `src/captcha.js` modülü + test iskeleti

**Files:**
- Create: `src/captcha.js`
- Create: `test/helpers.js`
- Create: `test/auth.test.js`
- Modify: `package.json:33` (`test` scripti)

**Interfaces:**
- Produces: `createCaptchaStore({ ttlMs = 300000, maxEntries = 1000, now = Date.now } = {})` → `{ create(): { id: string, svg: string }, verify(id: unknown, code: unknown): boolean, size: number }`; `export const CAPTCHA_BG = '#f0f2f5'`.
- `test/helpers.js` üretir: `export const TEST_ADMIN_PASSWORD = 'parola1234';` ve `export function parseCaptchaSvg(svg: string): { id: string, code: string }` (id: `<!--captcha-id:([A-Za-z0-9_-]+)-->` yorumundan; kod: tüm `<text>` öğelerinden `fill !== CAPTCHA_BG` olanlar ayrıştırılıp `x`'e göre sıralanıp birleştirilir).

**SVG formatı (sabit — sözleşmenin parçası):**

```
<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50" viewBox="0 0 150 50"><!--captcha-id:ID--><rect .../>[3 <line> gürültü][5 gerçek + 2 hayalet <text>]</svg>
```

- Gerçek karakterler: x = `[14,40,66,92,118]` + rastgele ±4 jitter, y = `34` ±5, fill paletten (`['#1f2937','#7c2d12','#1e3a8a','#14532d','#4c1d95']` — BG hariç), `transform="rotate(<±12> <x> <y>)"`.
- Hayaletler: x = `27` ve `105` ±4, fill = `CAPTCHA_BG` (aynı `<text>` formatı, sadece fill farklı).
- `<text>` öğesi sabit öznitelik sırası: `x y fill transform font-family font-size font-weight`, içerik tek karakter.
- Paletlerde `CAPTCHA_BG` asla yok (test bunu doğrular).

- [ ] **Step 1: Modül testini yaz (fail)**

`test/auth.test.js`:

```js
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
  assert.ok(!/[01OI]/.test(svg.replace(/<!--[\s\S]*?-->/g, ''))); // id hex'i hariç karışmayan alfabe
});
```

- [ ] **Step 2: Testin fail olduğunu gör**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/captcha.js'` (veya parseCaptchaSvg yok).

- [ ] **Step 3: `src/captcha.js` ve `test/helpers.js` uygula**

`src/captcha.js`: `randomCode`, `newId`, `isSafeId`, `safeEqual` import et (`src/util.js`). `parseCaptchaSvg` helpers'ta: id regex + `<text\s+([^>]+)>([^<]*)</text>` matchAll → her öğede ayrı ayrı `/x="(-?\d+)"/` ve `/fill="([^"]+)"/` → fill !== BG → x'e göre sırala → birleştir (öznitelik sırasına bağımlı DEĞİL, yalnız format sabiti).

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test`
Expected: 4 yeni test PASS, smoke testleri PASS (dokunulmadı).

- [ ] **Step 5: `package.json` test scriptini güncelle + commit**

```json
"test": "node --test test/smoke.test.js test/auth.test.js"
```

Run: `npm test` → tümü PASS.

```bash
git add src/captcha.js test/helpers.js test/auth.test.js package.json
git commit -m "feat: yerel SVG captcha modülü ve testleri"
```

---

### Task 2: `GET /api/auth/captcha` endpoint'i

**Files:**
- Modify: `server.js` (import + `createServer` içinde store/limiter + route, `/api/auth/config` yakınına)

**Interfaces:**
- Consumes: `createCaptchaStore`, `CAPTCHA_BG` (Görev 1); `createLimiter` (mevcut).
- Produces: `GET /api/auth/captcha` → 200 `image/svg+xml; charset=utf-8`, `Cache-Control: no-store`; 30/dk/IP sonrası 429. Route yığınında `captchaStore` artık sonraki görevlerde login/register için de kullanılır (Görev 4).

- [ ] **Step 1: Fail testi yaz** (`test/auth.test.js`)

```js
test('captcha endpoint: svg döner ve rate limit uygular', async (t) => {
  const server = createServer({ dataDir: tmpDir(), adminKey: '' });
  const addr = await server.start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;
  t.after(async () => { await server.close(); fs.rmSync(...); }); // tmpDir temizliği
  const res = await fetch(`${base}/api/auth/captcha`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.ok(parseCaptchaSvg(await res.text()).code.length === 5);
  let last;
  for (let i = 0; i < 31; i += 1) last = await fetch(`${base}/api/auth/captcha`);
  assert.equal(last.status, 429);
});
```

(`tmpDir`, `fs`, `path`, `os` importları helpers'a taşınabilir; helpers `tmpDir()` de export eder — smoke ile aynı davranış.)

- [ ] **Step 2: Fail gör** → Run: `npm test` → 404/HTML beklenen FAIL.

- [ ] **Step 3: Route'u uygula**

`createServer` içinde: `const captchaStore = createCaptchaStore();` + `const captchaLimiter = createLimiter({ windowMs: 60_000, max: 30 });`. Route: limiter false → 429 `{ error: 'Çok fazla istek. Lütfen biraz bekleyin.' }`; değilse `captchaStore.create()` → header'lar → `res.send(svg)`. Ayrıca `test/helpers.js`'e `export async function getCaptcha(base)` ekle: fetch → text → `parseCaptchaSvg`, dönen `{ id, code }` (kodun 5 karakter olduğunu assert et).

- [ ] **Step 4: Pass gör** → `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server.js test/auth.test.js test/helpers.js
git commit -m "feat: captcha endpoint'i (svg + rate limit)"
```

---

### Task 3: Sabit yönetici tohumu (`ensurePinnedAdmin`) + hash

**Files:**
- Modify: `server.js` (sabitler, `ensurePinnedAdmin`, `start()`)
- Modify: `test/helpers.js` (`loginAsPinned`)

**Interfaces:**
- Produces: `export const PINNED_USERNAME = 'cmtrkr'; export const PINNED_PASSWORD_HASH = 'scrypt$…';` (gerçek şifrenin hash'i — Görev 3 Step 2'de hesaplanır). `createServer({ pinnedAdminPassword?: string })` seçeneği: verilirse seed hash'i o şifreden hesaplanır (testler içindir). Testler `server.store` üzerinden kullanıcıya erişir.

- [ ] **Step 1: Fail testleri yaz** (`test/auth.test.js`)

```js
test('tohum: cmtrkr her açılışta sabit ve kilitli (varsayılan hash)', async () => {
  const server = createServer({ dataDir: tmpDir(), adminKey: '' });
  const addr = await server.start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;
  const u = Object.values(server.store.users).find((x) => x.usernameKey === 'cmtrkr');
  assert.equal(u.locked, true);
  assert.equal(u.passwordHash, PINNED_PASSWORD_HASH);
  // Test şifresi prod hash'ine karşı çalışmamalı
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'cmtrkr', password: TEST_ADMIN_PASSWORD }),
  });
  assert.equal(res.status, 401);
  await server.close();
});

test('re-pin: db elle değiştirilse bile açılışta geri gelir, id korunur', async () => {
  const dataDir = tmpDir();
  const s1 = createServer({ dataDir, adminKey: '', pinnedAdminPassword: TEST_ADMIN_PASSWORD });
  const a1 = await s1.start(0, '127.0.0.1');
  const base1 = `http://127.0.0.1:${a1.port}`;
  const { user } = await loginAsPinned(base1);
  await s1.close();
  const dbPath = path.join(dataDir, 'db.json');
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const target = Object.values(db.users).find((x) => x.usernameKey === 'cmtrkr');
  target.passwordHash = await hashPassword('baskasifre9'); // elle sabotaj
  fs.writeFileSync(dbPath, JSON.stringify(db));
  const s2 = createServer({ dataDir, adminKey: '', pinnedAdminPassword: TEST_ADMIN_PASSWORD });
  const a2 = await s2.start(0, '127.0.0.1');
  const base2 = `http://127.0.0.1:${a2.port}`;
  const again = await loginAsPinned(base2);
  assert.equal(again.user.id, user.id); // id değişmez → etkinlik sahipliği korunur
  const u2 = Object.values(s2.store.users).find((x) => x.usernameKey === 'cmtrkr');
  assert.equal(u2.locked, true);
  await s2.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
```

(`hashPassword` import: `../src/auth.js`; `loginAsPinned` bu görevde helpers'a eklenir — Step 4.)

- [ ] **Step 2: Gerçek şifrenin hash'ini üret (dosyaya YAZMA)**

Repo kökünde: `read -s -p "PIN_PWD: " PIN_PWD` (değer shell geçmişine/dosyaya girmez), sonra:

```bash
PIN_PWD="$PIN_PWD" node -e "import('./src/auth.js').then(m=>m.hashPassword(process.env.PIN_PWD)).then(console.log)"
```

Çıktıyı (`scrypt$16384$8$1$…`) kopyala. Ardından: `unset PIN_PWD` (yeniden `read -s` ile gerekirse tekrar sor).

- [ ] **Step 3: Fail gör** → `npm test` → FAIL (PINNED sabitleri yok, seed yok).

- [ ] **Step 4: `server.js` + helpers uygula**

- Üstte: `export const PINNED_USERNAME = 'cmtrkr';` + `export const PINNED_PASSWORD_HASH = '<Step 2 çıktısı>';`
- `async function ensurePinnedAdmin(store, passwordHash)`: `store.findUserByName(PINNED_USERNAME)` ile bul; yoksa `{ id: newId('u'), username: PINNED_USERNAME, usernameKey: usernameKey(PINNED_USERNAME), passwordHash, createdAt: Date.now(), locked: true }`; varsa **id'ye dokunmadan** `passwordHash` ve `locked: true` ata; `store.putUser(user); store.touch();`
- `start()` içinde `listen` ÖNCESİ: `const pinnedHash = options.pinnedAdminPassword ? await hashPassword(options.pinnedAdminPassword) : PINNED_PASSWORD_HASH; await ensurePinnedAdmin(store, pinnedHash);`
- `test/helpers.js`:

```js
export async function loginAsPinned(base) {
  const cap = await getCaptcha(base); // Görev 2 helpers'ı: fetch + parse
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'cmtrkr', password: TEST_ADMIN_PASSWORD,
      captchaId: cap.id, captchaCode: cap.code }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return { user: await response.json(), cookie: sessionCookie(response) };
}
```

(Görev 4 öncesi sunucu captcha alanlarını yok sayar — alanları göndermek her iki dönemde de yeşildir.) `sessionCookie` smoke'dan helpers'a taşınır, smoke import eder.

- [ ] **Step 5: Pass gör** → `npm test` → tümü PASS.

- [ ] **Step 6: Gerçek şifre ile canlı doğrulama + sızıntı kontrolü + commit**

```bash
read -s -p "PIN_PWD: " PIN_PWD
npm start &   # .env: PORT=3131
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" -H 'Content-Type: application/json' \
  -d "{\"username\":\"cmtrkr\",\"password\":\"$PIN_PWD\"}" http://127.0.0.1:3131/api/auth/login
# Beklenen: 200 — bu görevde login'a captcha henüz zorunlu değil; 200 gelirse
# gerçek şifre, koddaki PINNED_PASSWORD_HASH ile eşleşiyor demektir.
# (401 gelirse hash yanlış hesaplanmıştır: Step 2'yi yeniden yap ve Step 4'teki
# PINNED_PASSWORD_HASH sabitini güncelle.)
kill %1; unset PIN_PWD
```

```bash
read -s -p "PIN_PWD: " PIN_PWD
grep -rFl --exclude-dir=node_modules --exclude-dir=.git "$PIN_PWD" . || echo "TEMIZ"
unset PIN_PWD
```

Beklenen: `TEMIZ` (düz metin hiçbir dosyada yok). Bulursan düzeltmeden commit ATMA.

```bash
git add server.js test/helpers.js test/auth.test.js
git commit -m "feat: cmtrkr sabit yöneticisi — her açılışta hash yeniden yazılır, kilitli"
```

---

### Task 4: Login'de CAPTCHA zorunluluğu

**Files:**
- Modify: `server.js` (`/api/auth/login`)

**Interfaces:**
- Consumes: `captchaStore` (Görev 2), `loginAsPinned` (Görev 3).
- Produces: Login 400 `{ error: 'CAPTCHA doğrulaması başarısız. Görseli yenileyip tekrar deneyin.' }` — eksik/bilinmeyen/yanlış `captchaId`/`captchaCode` için; kontrol `loginLimiter`'dan SONRA, kullanıcı/şifre kontrolünden ÖNCE.

- [ ] **Step 1: Fail testleri yaz** (`test/auth.test.js`)

```js
test('login: captcha eksik/yanlış 400, yanlış şifre (geçerli captcha) 401', async (t) => {
  // server: pinnedAdminPassword: TEST_ADMIN_PASSWORD
  const noCap = await fetch(login, { method:'POST', ..., body: JSON.stringify({ username:'cmtrkr', password:TEST_ADMIN_PASSWORD }) });
  assert.equal(noCap.status, 400);
  assert.match((await noCap.json()).error, /captcha/i);
  const cap = await getCaptcha(base);
  const wrongId = await post({ username:'cmtrkr', password:TEST_ADMIN_PASSWORD, captchaId:'cap_000000000000', captchaCode:cap.code });
  assert.equal(wrongId.status, 400);
  const wrongCode = await post({ ..., captchaId:cap.id, captchaCode:'ZZZZZ' });
  assert.equal(wrongCode.status, 400);
  // yanlış kod id'yi YAKMAZ → aynı görselle tekrar
  const retry = await post({ ..., captchaId:cap.id, captchaCode:cap.code });
  assert.equal(retry.status, 200);
  const badPass = await post({ username:'cmtrkr', password:'yanlisifre1', ...(yeni captcha) });
  assert.equal(badPass.status, 401);
});
```

(Bu test tek instance'da ≤6 login yapar — limiter sınırı 20; Görev 3'teki re-pin testi `loginAsPinned` zaten captcha gönderir, bu görevden sonra otomatik olarak gerçek doğrulamadan geçer.)

- [ ] **Step 2: Fail gör** → `npm test` → (400 bekleyen kısımlar) FAIL.

- [ ] **Step 3: Login handler'a doğrulamayı ekle**

`loginLimiter` kontrolünden sonra, `normalizeUsername` ÖNCESİ:

```js
const captchaOk = captchaStore.verify(req.body?.captchaId, req.body?.captchaCode);
if (!captchaOk) return res.status(400).json({ error: 'CAPTCHA doğrulaması başarısız. Görseli yenileyip tekrar deneyin.' });
```

- [ ] **Step 4: Pass gör** → `npm test` → tümü PASS.

- [ ] **Step 5: Commit**

```bash
git add server.js test/auth.test.js
git commit -m "feat: girişte captcha doğrulaması (tek kullanımlık, yanlış kodu yakmaz)"
```

---

### Task 5: Kayıt kalıcı kapalı + config + test göçü

**Files:**
- Modify: `server.js` (REGISTRATION_OPEN sabiti, register 403, config, başlangıç logu)
- Modify: `test/smoke.test.js` (aşağıda tam liste)

**Interfaces:**
- Produces: `POST /api/auth/register` → 403 `{ error: 'Yeni kayıt kapalıdır.' }` (handler'ın İLK satırı; altındaki eski kod + `ADMIN_KEY` bloğu erişilemez kalır — bilinçli, tasarım gereği). `GET /api/auth/config` → `{ registrationOpen: false, registerKeyRequired: false, captchaRequired: true, users }`. Register handler'ında 403'ten sonra, kullanıcı adı kontrolünden önce captcha doğrulaması da tanımlanır (ileride yeniden açılırsa hazır). Başlangıç logu: `Kayıt:      kapalı (tek yönetici: cmtrkr)`.

- [ ] **Step 1: Yeni testleri yaz** (`test/auth.test.js`)

```js
test('kayıt kalıcı kapalı', async (t) => {
  // server: adminKey: 'gizli-anahtar' OLMASI fark etmez
  const res = await fetch(`${base}/api/auth/register`, { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ username:'yeni', password:'parola1234' }) });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /kayıt kapalı/i);
  const cfg = await (await fetch(`${base}/api/auth/config`)).json();
  assert.deepEqual({ a: cfg.registrationOpen, b: cfg.registerKeyRequired, c: cfg.captchaRequired },
                   { a: false, b: false, c: true });
});
```

- [ ] **Step 2: Fail gör** → register hâlâ 201/409 döner → FAIL.

- [ ] **Step 3: `server.js` uygula**

Üstte `const REGISTRATION_OPEN = false;`. Register `try` bloğunun ilk satırı: `if (!REGISTRATION_OPEN) return res.status(403).json({ error: 'Yeni kayıt kapalıdır.' });` — ardından captcha `verify` kontrolü (aynı 400 mesajı), ardından eski kod aynen kalır. Config: üç alanı da sabitle (`registrationOpen: REGISTRATION_OPEN, registerKeyRequired: false, captchaRequired: true`). Başlangıç logu satırını değiştir.

- [ ] **Step 4: Eski smoke testlerinin kırıldığını gör** → `npm test` → smoke'da register'a bağlı kısımlar FAIL.

- [ ] **Step 5: `test/smoke.test.js` göçü (tam liste)**

1. Üst importlara: `import { TEST_ADMIN_PASSWORD, loginAsPinned, tmpDir } from './helpers.js';` (helpers `tmpDir`, `sessionCookie` export eder; smoke'daki tanımlar silinir).
2. `makeAccount` fonksiyonu (satır ~37-46) SİLİNİR — yerine `loginAsPinned`.
3. `createServer(...)` çağrılarına HEPSİNE `pinnedAdminPassword: TEST_ADMIN_PASSWORD` eklenir (satırlar ~58, ~287, ~296, ~310, ~371, ~496 — `dataDir` her zaman ortak).
4. `await makeAccount(base)` → `await loginAsPinned(base)` (satırlar ~74, ~290, ~379, ~504); `makeAccount(base, { username:'korunan', adminKey:'gizli-anahtar' })` (satır ~333) → `await loginAsPinned(base)`.
5. Test `yönetici anahtarı` içinde register-kısmı: `noKey` (satır ~326-331) beklenen durumu 401 → **403** olur; assertion'ı 403 + `/kayıt kapalı/i`.
6. Test `hesap, çoktan seçmeli…` sonundaki duplicate-username register bloğu (satır ~485-491) SİLİNİR (403 testi auth.test'te).
7. Test adları/akışlar geri kalanıyla uyumlu kalır.

- [ ] **Step 6: Pass gör** → `npm test` → tümü PASS (smoke + auth).

- [ ] **Step 7: Commit**

```bash
git add server.js test/smoke.test.js test/auth.test.js test/helpers.js
git commit -m "feat: kayıt kalıcı kapalı — tek yönetici garantisi"
```

---

### Task 6: Şifre kuralı (yalnız harf+rakam)

**Files:**
- Modify: `src/auth.js:67-73` (`validatePassword`)
- Modify: `test/auth.test.js`

**Interfaces:**
- Produces: `validatePassword(password: string): string | null` — boş → `Şifre gerekli.`; >200 → `Şifre çok uzun.`; `/^[\p{L}\p{N}]+$/u` dışı → `Şifre yalnızca harf ve rakam içerebilir.`; aksi → `null`. (Tek çağrı yeri register — Görev 5'ten sonra erişilemez; kural geleceğe ve UI hizasına yazılır.)

- [ ] **Step 1: Fail testleri** (unit — sunucu GEREKMEZ)

```js
test('şifre kuralı: yalnız harf ve rakam', () => {
  assert.equal(validatePassword(TEST_ADMIN_PASSWORD), null);
  assert.equal(validatePassword('Şifreabc123'), null); // Türkçe harfler serbest
  assert.match(validatePassword('abc!123'), /yalnızca harf ve rakam/);
  assert.match(validatePassword(''), /gerekli/);
  assert.match(validatePassword('a'.repeat(201)), /uzun/);
});
```

- [ ] **Step 2: Fail gör** → `npm test` (eski kural `abc!123`'ü kabul eder / boş için farklı mesaj).

- [ ] **Step 3: `validatePassword` uygula** (yukarıdaki sıralama/imzaya göre).

- [ ] **Step 4: Pass gör** → `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth.js test/auth.test.js
git commit -m "feat: şifre kuralı yalnızca harf ve rakam"
```

---

### Task 7: UI (host.js) + son doğrulama

**Files:**
- Modify: `public/js/host.js` (~526-633 `renderAuth` + state ~34)

**Interfaces:**
- Consumes: `GET /api/auth/captcha` (id SVG yorumunda), config `{ registrationOpen, captchaRequired }`, Görev 4/5 mesajları.

- [ ] **Step 1: `public/js/host.js` düzenlemeleri**

1. `S` state'e `captcha: null` alanı (`{ id, svg }`).
2. `async function refreshCaptcha()`: `fetch('/api/auth/captcha', { cache:'no-store' })` → `text()` → id regex (`/<!--captcha-id:([A-Za-z0-9_-]+)-->/`) → `S.captcha = { id, svg }`; `<img id="auth-captcha-img">` için `src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)` (CSP `img-src 'self' data:` uygun).
3. Form DOM'una, şifre alanından SONRA: captcha satırı — `<img id="auth-captcha-img">` + input `#auth-captcha` (`autocomplete="off"`, `maxlength="5"`, placeholder `Görseldeki kodu yaz`) + `Yenile` ipucu (img tıklaması → `refreshCaptcha()`).
4. `renderAuth` sonunda: `mode === 'login'` (ve form görünüyorsa) `S.captcha` yoksa `refreshCaptcha()`, varsa img src'sini önbellekten geri koy (her render'da yeni GET yok — rate limit 30/dk).
5. **Register kapalıysa form yerine mesaj:** `mode === 'register' && config.registrationOpen === false` → form + alt ipucu yerine: başlık `Yeni kayıt kapalıdır`, gövde `Bu sunucuda tek yönetici hesabı bulunur. Mevcut hesabınla giriş yapabilirsin.` (sekmeler kalır).
6. Submit: `captchaId: S.captcha?.id`, `captchaCode: input değeri` body'ye eklenir; `adminKey` alanı register formu kapalıyken render edilmez (mevcut `registerKeyRequired` dalı dokunulmadan kalır).
7. İstemci şifre kontrolü (satır ~610-613): `password.length < 8` yerine `/^[\p{L}\p{N}]+$/u.test(password)` → mesaj `Şifre yalnızca harf ve rakam içerebilir.`; input'tan `minlength="8"` kaldır, `maxlength="200"` ve placeholder `Yalnızca harf ve rakam` ekle.
8. `catch` içinde: `error.status === 400` → `await refreshCaptcha()` + captcha input temizle (kullanıcı yeni görsel görür).

- [ ] **Step 2: Otomatik testler**

Run: `npm test` → tümü PASS (UI için otomatik test yok — `test:ui` kapsam dışı, mevcut davranış).

- [ ] **Step 3: Manuel tarayıcı doğrulama**

```bash
npm start   # PORT=3131 (.env)
```

1. `http://localhost:3131/host` → giriş ekranında CAPTCHA görseli görünür, okunabilir (5 karakter).
2. Yanlış kod + giriş → hata + **yeni görsel** yüklenir.
3. Doğru kod + `cmtrkr` + gerçek şifre (oturum bağlamından, dosyaya değil) → giriş başarılı, etkinlik listesi açılır.
4. "Kayıt ol" sekmesi → `Yeni kayıt kapalıdır` mesajı; form yok.
5. Sunucuyu durdur & başlat → tekrar giriş → çalışır (re-pin).
6. `Ctrl+C` ile kapat.

- [ ] **Step 4: Sızıntı kontrolü + tam suite + commit**

```bash
read -s -p "PIN_PWD: " PIN_PWD
grep -rFl --exclude-dir=node_modules --exclude-dir=.git "$PIN_PWD" . || echo "TEMIZ"
unset PIN_PWD
npm test
```

Beklenen: `TEMIZ` + tüm testler PASS.

```bash
git add public/js/host.js
git commit -m "feat: giriş ekranı captcha, kayıt sekmesi kapalı, şifre kuralı UI"
```

---

## Self-Review Notları

- **Spec kapsaması:** seed/re-pin/lock (T3) ✓, register 403 + config (T5) ✓, captcha GET+login+register (T2/T4/T5) ✓, şifre kuralı (T6+T7.7) ✓, UI iki sekme + kapalı mesaj (T7) ✓, mevcut hesaplar dokunulmaz (hiçbir görev kullanıcı silmiyor) ✓, düz metin yok (T3/T7 grep) ✓.
- `registerKeyRequired` host.js dalı (satır ~567) register formu kapalıyken render edilmez — dokunulmadı.
- Ortak yardımcılar (`tmpDir`, `sessionCookie`) helpers'a taşınıp smoke import eder; ikinci kez tanımlanmaz.
