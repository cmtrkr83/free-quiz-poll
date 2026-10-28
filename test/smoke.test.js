import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient } from 'socket.io-client';
import { createServer } from '../server.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'canli-oturum-test-'));
}

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function call(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(6000).emit(event, payload, (err, response) => {
      if (err) reject(err);
      else resolve(response);
    });
  });
}

async function connect(url) {
  const socket = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  await once(socket, 'connect');
  return socket;
}

function sessionCookie(response) {
  const raw = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

async function makeAccount(base, { username = 'testadmin', password = 'parola1234', adminKey = '' } = {}) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, adminKey }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const data = await response.json();
  return { user: data.user, cookie: sessionCookie(response) };
}

function createEvent(base, cookie, body) {
  return fetch(`${base}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

test('uçtan uca canlı oturum akışı', async (t) => {
  const dataDir = tmpDir();
  const server = createServer({ dataDir, adminKey: '', publicUrl: '' });
  const address = await server.start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;

  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // 1. Sağlık kontrolü
  const health = await (await fetch(`${base}/healthz`)).json();
  assert.equal(health.ok, true);

  // 2. Etkinlik oluştur (örnek sorularla)
  const account = await makeAccount(base);
  const createRes = await createEvent(base, account.cookie, { title: 'Test Oturumu', template: 'demo' });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.match(created.code, /^[A-Z2-9]{6}$/);
  assert.ok(created.hostKey.length > 10);
  assert.equal(created.joinUrl, `${base}/j/${created.code}`);

  const accountEvents = await (
    await fetch(`${base}/api/account/events`, { headers: { Cookie: account.cookie } })
  ).json();
  assert.equal(accountEvents.events.length, 1);
  assert.equal(accountEvents.events[0].code, created.code);

  // 3. Sayfa ve QR
  const page = await fetch(`${base}/j/${created.code}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Canlı Oturum/);

  const qr = await fetch(`${base}/api/events/${created.code}/qr.png?size=320`);
  assert.equal(qr.status, 200);
  assert.equal(qr.headers.get('content-type'), 'image/png');
  assert.ok((await qr.arrayBuffer()).byteLength > 500);

  // 4. Yanlış yönetici anahtarı reddedilir
  const host = await connect(base);
  sockets.push(host);
  const badHost = await call(host, 'host:join', { code: created.code, key: 'yanlis' });
  assert.equal(badHost.ok, false);

  const hostJoin = await call(host, 'host:join', { code: created.code, key: created.hostKey });
  assert.equal(hostJoin.ok, true);
  assert.equal(hostJoin.state.phase, 'lobby');
  assert.equal(hostJoin.state.total, 5);

  // 5. Katılımcılar katılır
  const p1 = await connect(base);
  const p2 = await connect(base);
  sockets.push(p1, p2);

  const missing = await call(p1, 'player:join', { code: 'ZZZZZZ', name: 'Ali' });
  assert.equal(missing.ok, false);

  const join1 = await call(p1, 'player:join', { code: created.code, name: 'Ayşe' });
  assert.equal(join1.ok, true);
  assert.equal(join1.state.you.name, 'Ayşe');
  assert.equal(join1.state.you.answers && Object.keys(join1.state.you.answers).length, 0);

  const join2 = await call(p2, 'player:join', { code: created.code, name: 'Mehmet' });
  assert.equal(join2.ok, true);

  // Aynı token ile yeniden bağlanma aynı katılımcıyı döndürür
  const p1b = await connect(base);
  sockets.push(p1b);
  const rejoin = await call(p1b, 'player:join', {
    code: created.code,
    name: 'Ayşe',
    token: join1.token,
  });
  assert.equal(rejoin.ok, true);
  assert.equal(rejoin.pid, join1.pid);

  await new Promise((r) => setTimeout(r, 120));
  const hostState = await (await fetch(`${base}/api/events/${created.code}/state?key=${encodeURIComponent(created.hostKey)}`)).json();
  assert.equal(hostState.participants.length, 2);
  assert.equal(hostState.online, 3);

  // 6. Oturumu başlat
  const p1StatePromise = once(p1, 'state');
  const started = await call(host, 'host:action', { code: created.code, type: 'start' });
  assert.equal(started.ok, true);
  assert.equal(started.state.phase, 'live');
  assert.equal(started.state.current, 0);

  const q1 = started.state.questions[0];
  assert.equal(q1.type, 'mc');
  const q2 = started.state.questions[1];

  // Public snapshot doğru cevabı sızdırmamalı
  const publicState = await p1StatePromise;
  assert.equal(publicState.phase, 'question');
  assert.equal(publicState.question.correctId, null);

  const advance = async (socket, name) => {
    const res = await call(socket, 'player:next', {});
    assert.equal(res.ok, true, `${name} sonraki soruya geçemedi: ${res.error || ''}`);
    return res;
  };

  // 7. Cevaplar
  const a1 = await call(p1, 'player:answer', { qid: q1.id, value: 'phone' });
  assert.equal(a1.ok, true);
  assert.equal(a1.state.phase, 'results');
  const a2 = await call(p2, 'player:answer', { qid: q1.id, value: 'computer' });
  assert.equal(a2.ok, true);

  const duplicate = await call(p1, 'player:answer', { qid: q1.id, value: 'tablet' });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'already');

  const invalid = await call(p2, 'player:answer', { qid: q1.id, value: 'yok-boyle-secenek' });
  assert.equal(invalid.ok, false);

  // 8. Cevaplar anında sonuç olarak görünür; sunucu yönlendirmesi gerekmez.
  const answeredHost = await call(host, 'host:action', { code: created.code, type: 'lock' });
  assert.equal(answeredHost.ok, true);
  assert.equal(answeredHost.state.stats.kind, 'choice');
  assert.equal(answeredHost.state.stats.total, 2);
  assert.equal(answeredHost.state.stats.options.find((o) => o.id === 'phone').count, 1);

  // Her katılımcı kendi hızında ilerler.
  const p1Next = await advance(p1, 'Ayşe');
  assert.equal(p1Next.state.phase, 'question');
  assert.equal(p1Next.state.question.id, q2.id);
  await advance(p2, 'Mehmet');

  // 9. Quiz sorusu ve puanlama
  const next = await call(host, 'host:action', { code: created.code, type: 'next' });
  assert.equal(next.state.phase, 'live');
  assert.equal(next.state.current, 1);
  assert.equal(next.state.questions[1].type, 'quiz');

  const quiz1 = await call(p1, 'player:answer', { qid: q2.id, value: 'istanbul' });
  assert.equal(quiz1.ok, true);
  const quiz2 = await call(p2, 'player:answer', { qid: q2.id, value: 'ankara' });
  assert.equal(quiz2.ok, true);

  const quizStats = await call(host, 'host:action', { code: created.code, type: 'lock' });
  assert.equal(quizStats.state.stats.total, 2);

  const leader = quizStats.state.leaderboard;
  assert.equal(leader[0].name, 'Mehmet');
  assert.ok(leader[0].score > 0);

  // Katılımcı perspektifinde doğru cevap cevap verince görünür.
  assert.equal(quiz2.state.question.correctId, 'ankara');
  assert.equal(quiz2.state.you.answers[q2.id], 'ankara');
  assert.ok(quiz2.state.you.rank >= 1);

  const rejoin2 = await call(p1, 'player:join', { code: created.code, name: 'Ayşe', token: join1.token });
  assert.equal(rejoin2.state.question.correctId, 'ankara');
  assert.equal(rejoin2.state.you.answers[q2.id], 'istanbul');

  // 10. Kelime bulutu, puanlama ve açık uçlu sorular
  await advance(p1, 'Ayşe');
  await advance(p2, 'Mehmet');
  const q3res = await call(host, 'host:action', { code: created.code, type: 'next' });
  const q3 = q3res.state.questions[2];
  assert.equal(q3.type, 'wordcloud');
  await call(p1, 'player:answer', { qid: q3.id, value: 'elma' });
  await call(p2, 'player:answer', { qid: q3.id, value: 'Elma' });
  const cloud = await call(host, 'host:action', { code: created.code, type: 'lock' });
  assert.equal(cloud.state.stats.kind, 'wordcloud');
  assert.equal(cloud.state.stats.words[0].count, 2);

  await advance(p1, 'Ayşe');
  await advance(p2, 'Mehmet');
  const q4res = await call(host, 'host:action', { code: created.code, type: 'next' });
  const q4 = q4res.state.questions[3];
  assert.equal(q4.type, 'rating');
  const badRating = await call(p1, 'player:answer', { qid: q4.id, value: 9 });
  assert.equal(badRating.ok, false);
  await call(p1, 'player:answer', { qid: q4.id, value: 4 });
  await call(p2, 'player:answer', { qid: q4.id, value: 5 });
  const rated = await call(host, 'host:action', { code: created.code, type: 'lock' });
  assert.equal(rated.state.stats.kind, 'rating');
  assert.equal(rated.state.stats.avg, 4.5);

  await advance(p1, 'Ayşe');
  await advance(p2, 'Mehmet');
  const q5res = await call(host, 'host:action', { code: created.code, type: 'next' });
  const q5 = q5res.state.questions[4];
  assert.equal(q5.type, 'open');
  await call(p1, 'player:answer', { qid: q5.id, value: 'Daha fazla soru tipi' });
  await call(host, 'host:action', { code: created.code, type: 'lock' });

  // Son sorudan sonra "Bitir" katılımcıyı tamamlanmış duruma geçirir.
  const p1Done = await advance(p1, 'Ayşe');
  assert.equal(p1Done.done, true);
  assert.equal(p1Done.state.phase, 'done');

  const ended = await call(host, 'host:action', { code: created.code, type: 'end' });
  assert.equal(ended.state.phase, 'ended');
  const p1Ended = await call(p1, 'player:sync', {});
  assert.equal(p1Ended.state.phase, 'ended');

  // 11. CSV dışa aktarma
  const csv = await fetch(`${base}/api/events/${created.code}/export.csv?key=${encodeURIComponent(created.hostKey)}`);
  assert.equal(csv.status, 200);
  const csvText = await csv.text();
  assert.match(csvText, /Ayşe/);
  assert.match(csvText, /Mehmet/);
  assert.match(csvText, /Ankara/);

  const summary = await fetch(
    `${base}/api/events/${created.code}/export.csv?mode=summary&key=${encodeURIComponent(created.hostKey)}`,
  );
  assert.equal(summary.status, 200);
  assert.match(await summary.text(), /Doğru cevap/);

  // Yetkisiz CSV
  const forbidden = await fetch(`${base}/api/events/${created.code}/export.csv?key=yanlis`);
  assert.equal(forbidden.status, 403);

  // 12. Yeniden başlatma katılımcıları temizler
  const restarted = await call(host, 'host:action', { code: created.code, type: 'restart' });
  assert.equal(restarted.state.phase, 'lobby');
  assert.equal(restarted.state.participants.length, 0);
  assert.equal(restarted.state.leaderboard.length, 0);
});

test('veriler yeniden başlatmada korunur', async () => {
  const dataDir = tmpDir();
  const first = createServer({ dataDir });
  const a = await first.start(0, '127.0.0.1');
  const baseA = `http://127.0.0.1:${a.port}`;
  const account = await makeAccount(baseA);
  const created = await (
    await createEvent(baseA, account.cookie, { title: 'Kalıcı Etkinlik', template: 'demo' })
  ).json();
  await first.close();

  const second = createServer({ dataDir });
  const b = await second.start(0, '127.0.0.1');
  try {
    const meta = await (await fetch(`http://127.0.0.1:${b.port}/api/events/${created.code}`)).json();
    assert.equal(meta.title, 'Kalıcı Etkinlik');
    assert.equal(meta.total, 5);
  } finally {
    await second.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('yönetici anahtarı ve doğrulama', async (t) => {
  const dataDir = tmpDir();
  const server = createServer({ dataDir, adminKey: 'gizli-anahtar' });
  const address = await server.start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const denied = await fetch(`${base}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Olmamalı' }),
  });
  assert.equal(denied.status, 401);

  // Kayıt anahtarı olmadan hesap açılamaz.
  const noKey = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'baskas', password: 'parola1234' }),
  });
  assert.equal(noKey.status, 401);

  const account = await makeAccount(base, { username: 'korunan', adminKey: 'gizli-anahtar' });
  const allowed = await createEvent(base, account.cookie, { title: 'Korumalı', template: 'demo' });
  assert.equal(allowed.status, 201);
  const ev = await allowed.json();

  // Giriş yapmadan etkinlik oluşturulamaz.
  const anonymous = await fetch(`${base}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Anonim' }),
  });
  assert.equal(anonymous.status, 401);

  // Geçersiz kod → 404
  const missing = await fetch(`${base}/api/events/ZZZZZZ`);
  assert.equal(missing.status, 404);

  // Sorular oturum sürerken düzenlenemez
  const host = await connect(base);
  t.after(() => host.disconnect());
  await call(host, 'host:join', { code: ev.code, key: ev.hostKey });
  await call(host, 'host:action', { code: ev.code, type: 'start' });

  const blocked = await fetch(`${base}/api/events/${ev.code}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-host-key': ev.hostKey },
    body: JSON.stringify({ questions: [] }),
  });
  assert.equal(blocked.status, 409);

  // Güvenlik başlıkları
  const page = await fetch(`${base}/`);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
});

test('hesap, çoktan seçmeli oylama, cevap kapatma ve kod değiştirme', async (t) => {
  const dataDir = tmpDir();
  const server = createServer({ dataDir });
  const address = await server.start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const account = await makeAccount(base, { username: 'ogretmen', password: 'parola1234' });
  const created = await (
    await createEvent(base, account.cookie, {
      title: 'Çoktan Seçmeli Test',
      questions: [
        {
          id: 'q_multi',
          type: 'mc',
          prompt: 'Hangi meyveleri seversin?',
          multi: true,
          options: [
            { id: 'elma', text: 'Elma' },
            { id: 'muz', text: 'Muz' },
            { id: 'kiraz', text: 'Kiraz' },
          ],
        },
      ],
    })
  ).json();

  const host = await connect(base);
  const player = await connect(base);
  t.after(() => {
    host.disconnect();
    player.disconnect();
  });

  const hostJoin = await call(host, 'host:join', { code: created.code, key: created.hostKey });
  assert.equal(hostJoin.ok, true);
  assert.equal(hostJoin.state.questions[0].multi, true);

  const playerJoin = await call(player, 'player:join', { code: created.code, name: 'Deniz' });
  assert.equal(playerJoin.ok, true);
  assert.equal(playerJoin.state.settings.acceptingResponses, true);
  assert.equal(playerJoin.state.question, null);

  const started = await call(host, 'host:action', { code: created.code, type: 'start' });
  assert.equal(started.ok, true);

  const answered = await call(player, 'player:answer', {
    qid: 'q_multi',
    value: ['elma', 'kiraz'],
  });
  assert.equal(answered.ok, true);
  assert.deepEqual(answered.value.sort(), ['elma', 'kiraz']);

  // Yeni katılımcı geldiğinde mevcut katılımcıya gönderilen durum kendi
  // kimliğini ve cevaplarını korumalı. Ortak (you: null) yayın gönderilirse
  // istemci kendini tanımaz ve seçili cevap ekranda kaybolur.
  const stateForDeniz = once(player, 'state');
  const secondPlayer = await connect(base);
  t.after(() => secondPlayer.disconnect());
  const secondJoin = await call(secondPlayer, 'player:join', { code: created.code, name: 'Efe' });
  assert.equal(secondJoin.ok, true);

  const broadcast = await stateForDeniz;
  assert.equal(broadcast.participants, 2);
  assert.ok(broadcast.you, 'Mevcut katılımcıya kendi durumu gönderilmeli.');
  assert.equal(broadcast.you.name, 'Deniz');
  assert.deepEqual([...broadcast.you.answers.q_multi].sort(), ['elma', 'kiraz']);

  const locked = await call(host, 'host:action', { code: created.code, type: 'lock' });
  assert.equal(locked.ok, true);
  assert.equal(locked.state.stats.total, 1);
  assert.equal(locked.state.stats.selections, 2);
  assert.equal(locked.state.stats.options.find((option) => option.id === 'elma').count, 1);

  // Cevapları kapat: yeni katılım ve cevap engellenir.
  const closed = await fetch(`${base}/api/events/${created.code}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: account.cookie },
    body: JSON.stringify({ settings: { acceptingResponses: false } }),
  });
  assert.equal(closed.status, 200);

  const latePlayer = await connect(base);
  t.after(() => latePlayer.disconnect());
  const lateJoin = await call(latePlayer, 'player:join', { code: created.code, name: 'Geç Kalan' });
  assert.equal(lateJoin.ok, false);
  assert.match(lateJoin.error, /cevap almıyor/i);

  const reopen = await fetch(`${base}/api/events/${created.code}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: account.cookie },
    body: JSON.stringify({ settings: { acceptingResponses: true } }),
  });
  assert.equal(reopen.status, 200);

  // Kodu değiştir; eski kod 404, yeni kod çalışır.
  const changed = await fetch(`${base}/api/events/${created.code}/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: account.cookie },
    body: JSON.stringify({ code: 'YENI42' }),
  });
  assert.equal(changed.status, 200);
  const changedData = await changed.json();
  assert.equal(changedData.code, 'YENI42');
  assert.equal((await fetch(`${base}/api/events/${created.code}`)).status, 404);
  assert.equal((await fetch(`${base}/api/events/YENI42`)).status, 200);

  // Eski yönetici anahtarı yeni kodda da çalışır.
  const newHost = await connect(base);
  t.after(() => newHost.disconnect());
  const moved = await call(newHost, 'host:join', { code: 'YENI42', key: created.hostKey });
  assert.equal(moved.ok, true);

  // Kullanıcı adı tekrar alınamaz.
  const duplicate = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ogretmen', password: 'parola1234' }),
  });
  assert.equal(duplicate.status, 409);
});

test('süreler katılımcıya özeldir ve süre dolunca sonuç açılır', async (t) => {
  const dataDir = tmpDir();
  const server = createServer({ dataDir });
  const address = await server.start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const account = await makeAccount(base, { username: 'zamanlayici' });
  const created = await (
    await createEvent(base, account.cookie, {
      title: 'Süre Testi',
      settings: { liveResults: true },
      questions: [
        {
          id: 'q_timer',
          type: 'quiz',
          prompt: 'Süreli soru',
          timeLimit: 2,
          points: 100,
          correctId: 'a',
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
      ],
    })
  ).json();

  const host = await connect(base);
  const p1 = await connect(base);
  const p2 = await connect(base);
  t.after(() => {
    host.disconnect();
    p1.disconnect();
    p2.disconnect();
  });

  await call(host, 'host:join', { code: created.code, key: created.hostKey });
  const firstJoin = await call(p1, 'player:join', { code: created.code, name: 'Erken' });
  assert.equal(firstJoin.ok, true);
  await call(host, 'host:action', { code: created.code, type: 'start' });

  const first = await call(p1, 'player:sync', {});
  assert.equal(first.ok, true);
  assert.equal(first.state.phase, 'question');
  assert.ok(first.state.question.deadline > 0);
  // Canlı sonuçlar açık olsa bile doğru cevap cevap verilmeden sızmamalı.
  assert.equal(first.state.question.correctId, null);
  assert.equal(first.state.question.stats.kind, 'choice');

  await new Promise((r) => setTimeout(r, 450));
  const secondJoin = await call(p2, 'player:join', { code: created.code, name: 'Geç' });
  assert.equal(secondJoin.ok, true);
  assert.equal(secondJoin.state.phase, 'question');
  const firstDeadline = first.state.question.deadline;
  const secondDeadline = secondJoin.state.question.deadline;
  assert.ok(secondDeadline > firstDeadline + 250, 'Her katılımcının süresi kendi başlangıcına göre olmalı.');

  // İlk katılımcının süresi dolar; ikincinin süresi henüz dolmamıştır.
  await new Promise((r) => setTimeout(r, Math.max(0, firstDeadline - Date.now()) + 120));
  const firstAfter = await call(p1, 'player:sync', {});
  assert.equal(firstAfter.state.phase, 'results');
  assert.equal(firstAfter.state.question.expired, true);
  assert.equal(firstAfter.state.question.correctId, 'a');

  const lateAnswer = await call(p1, 'player:answer', { qid: 'q_timer', value: 'a' });
  assert.equal(lateAnswer.ok, false);
  assert.equal(lateAnswer.code, 'expired');

  const secondBefore = await call(p2, 'player:sync', {});
  assert.equal(secondBefore.state.phase, 'question');
  assert.equal(secondBefore.state.question.expired, false);

  await new Promise((r) => setTimeout(r, Math.max(0, secondDeadline - Date.now()) + 120));
  const secondAfter = await call(p2, 'player:sync', {});
  assert.equal(secondAfter.state.phase, 'results');
  assert.equal(secondAfter.state.question.expired, true);
});
