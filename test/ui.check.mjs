/**
 * Tarayıcıda uçtan uca arayüz kontrolü.
 * Çalıştırma: npm run test:ui
 * Edge/Chrome kurulu olmalı. Ekran görüntüleri test/shots/ altına yazılır.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer } from '../server.js';

const EDGE =
  process.env.EDGE_PATH ||
  process.env.CHROME_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = path.join(process.cwd(), 'test', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

function watch(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${label} console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`${label} pageerror: ${err.message}`));
}

async function shot(page, name) {
  await page.bringToFront();
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function registerAccount(base, username) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'parola1234' }),
  });
  if (response.status !== 201) throw new Error(`Kayıt başarısız: ${await response.text()}`);
  const raw = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
  return raw.split(';')[0].split('=')[1];
}

async function setSession(page, token) {
  await page.setCookie({
    name: 'co_session',
    value: token,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
  });
}

async function createEvent(base, token, title) {
  const response = await fetch(`${base}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `co_session=${token}` },
    body: JSON.stringify({ title, template: 'demo' }),
  });
  if (!response.ok) throw new Error(`Etkinlik oluşturulamadı: ${await response.text()}`);
  return response.json();
}

async function noOverflow(page, label) {
  const bad = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (bad > 1) errors.push(`${label}: yatay taşma ${bad}px`);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canli-ui-'));
const server = createServer({ dataDir });
const address = await server.start(3200, '127.0.0.1');
const base = `http://127.0.0.1:${address.port}`;

let browser;
try {
  const token = await registerAccount(base, `uiadmin${Date.now().toString(36)}`);
  const created = await createEvent(base, token, '8-A Fen Bilimleri Tekrar');
  const created2 = await createEvent(base, token, 'Editör Testi');
  await createEvent(base, token, 'Üçüncü Etkinlik');

  browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
  });

  // --- Yönetici: lobi -------------------------------------------------------
  const host = await browser.newPage();
  watch(host, 'host');
  await host.setViewport({ width: 1440, height: 940, deviceScaleFactor: 1 });
  await setSession(host, token);
  await host.goto(`${base}/h/${created.code}`, { waitUntil: 'domcontentloaded' });
  await host.waitForSelector('.code-big', { timeout: 8000 });
  await sleep(700);
  await shot(host, '01-host-lobby');

  // --- Katılımcı: isim girişi ----------------------------------------------
  const player = await browser.newPage();
  watch(player, 'player');
  await player.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await player.goto(`${base}/j/${created.code}`, { waitUntil: 'domcontentloaded' });
  await player.waitForSelector('#name-input', { timeout: 8000 });
  await sleep(400);
  await shot(player, '02-player-join');
  await player.type('#name-input', 'Zeynep');
  await player.click('#name-form button[type="submit"]');
  await player.waitForSelector('.pulse-core', { timeout: 8000 });
  await sleep(400);
  await shot(player, '03-player-waiting');
  await noOverflow(player, 'player-waiting');

  // --- Oturumu başlat -------------------------------------------------------
  await host.bringToFront();
  const startClass = await host.$eval('[data-action="start"]', (el) => el.className);
  if (!startClass.includes('btn-success')) {
    errors.push('Oturumu başlat düğmesi yeşil (btn-success) değil.');
  }
  await host.click('[data-action="start"]');
  await host.waitForFunction(
    () => document.querySelector('[data-action="end"]')?.textContent.includes('Oturumu kapat'),
    { timeout: 8000, polling: 100 },
  );
  const endClass = await host.$eval('[data-action="end"]', (el) => el.className);
  if (!endClass.includes('btn-danger')) {
    errors.push('Oturumu kapat düğmesi kırmızı (btn-danger) değil.');
  }
  await player.bringToFront();
  await player.waitForSelector('.opt', { timeout: 8000 });
  await sleep(500);
  await shot(player, '04-player-question');
  await noOverflow(player, 'player-question');

  // --- Cevap ver: sonuçlar anında görünür ----------------------------------
  await player.click('[data-opt="phone"]');
  await player.click('#send');
  await player.waitForSelector('#next-q', { timeout: 8000 });
  await player.waitForSelector('.res-row', { timeout: 8000 });
  await sleep(600);
  await shot(player, '05-player-results');
  await noOverflow(player, 'player-results');

  await host.bringToFront();
  await host.waitForFunction(
    () => document.querySelector('[data-live-answered]')?.textContent === '1',
    { timeout: 8000, polling: 100 },
  );
  await sleep(400);
  await shot(host, '06-host-live');

  // --- Ayarlar üst çubuktaki düğmeden modal olarak açılır ------------------
  await host.click('[data-action="settings"]');
  await host.waitForSelector('.modal-card', { timeout: 5000 });
  await host.waitForSelector('input[data-setting="liveResults"]', { timeout: 5000 });
  await sleep(400);
  await shot(host, '06b-host-settings');

  // Ayar modalı gerçekten sunucuya yazıyor mu?
  await host.$eval('input[data-setting="liveResults"]', (el) => el.click());
  await sleep(600);
  const liveResultsOn = await host.$eval('input[data-setting="liveResults"]', (el) => el.checked);
  if (!liveResultsOn) errors.push('Ayarlar modalındaki canlı sonuçlar anahtarı açılmadı.');
  await host.keyboard.press('Escape');
  await host.waitForFunction(() => document.getElementById('modal')?.hidden === true, {
    timeout: 5000,
    polling: 100,
  });

  // --- Katılımcılar ve sorular artık ayrı modallarda ------------------------
  const sidePanelCount = await host.$$eval('.side .panel', (els) => els.length);
  if (sidePanelCount !== 1) errors.push('Yan panelde yalnızca Oturum kartı kalmalı.');

  await host.click('[data-action="participants"]');
  await host.waitForSelector('#modal-p-list .p-row', { timeout: 5000 });
  await sleep(300);
  await shot(host, '06c-host-participants-modal');
  await host.keyboard.press('Escape');
  await host.waitForFunction(() => document.getElementById('modal')?.hidden === true, {
    timeout: 5000,
    polling: 100,
  });

  // --- Katılımcı kendi hızında ilerler -------------------------------------
  await player.bringToFront();
  await player.click('#next-q');
  await player.waitForFunction(
    () => document.querySelector('.q-index')?.textContent?.includes('Soru 2'),
    { timeout: 8000, polling: 100 },
  );
  await player.waitForSelector('[data-live-results-block]', { timeout: 5000 });
  await sleep(300);
  await shot(player, '07b-player-question-live-results');
  await player.click('[data-opt="ankara"]');
  await player.click('#send');
  await player.waitForSelector('.banner.good', { timeout: 8000 });
  await player.waitForSelector('#next-q', { timeout: 8000 });
  await sleep(400);
  await shot(player, '08-player-quiz-correct');

  // Yönetici yalnızca kendi ekranında gezinir; katılımcıyı ilerletmez.
  await host.bringToFront();
  await host.click('[data-action="questions"]');
  await host.waitForSelector('#modal-q-list .q-item', { timeout: 5000 });
  await sleep(300);
  await shot(host, '09a-host-questions-modal');
  await host.click('#modal-q-list .q-item[data-index="1"]');
  await host.waitForFunction(
    () => document.querySelector('.q-title')?.textContent?.includes('başkenti'),
    { timeout: 8000, polling: 100 },
  );
  await host.waitForFunction(() => document.getElementById('modal')?.hidden === true, {
    timeout: 5000,
    polling: 100,
  });
  await sleep(400);
  await shot(host, '09-host-quiz-results');
  await noOverflow(host, 'host-results');

  // --- Kalan sorular ve tamamlanma ekranı -----------------------------------
  await player.bringToFront();
  await player.click('#next-q');
  await player.waitForSelector('#answer-text', { timeout: 8000 });
  await player.type('#answer-text', 'elma');
  await player.click('#send');
  await player.waitForSelector('#next-q', { timeout: 8000 });
  await player.click('#next-q');

  await player.waitForSelector('[data-rate="4"]', { timeout: 8000 });
  await player.click('[data-rate="4"]');
  await player.click('#send');
  await player.waitForSelector('#next-q', { timeout: 8000 });
  await player.click('#next-q');

  await player.waitForSelector('textarea#answer-text', { timeout: 8000 });
  await player.type('#answer-text', 'Daha fazla soru tipi');
  await player.click('#send');
  await player.waitForSelector('#next-q', { timeout: 8000 });
  const lastLabel = await player.$eval('#next-q', (el) => el.textContent.trim());
  if (!lastLabel.includes('Bitir')) errors.push('Son soruda "Bitir" düğmesi görünmüyor.');
  await player.click('#next-q');
  await player.waitForFunction(
    () => document.body.textContent.includes('Tüm soruları tamamladın'),
    { timeout: 8000, polling: 100 },
  );
  await sleep(500);
  await shot(player, '09b-player-done');
  await noOverflow(player, 'player-done');

  // --- Yönetici oturumu bitirir --------------------------------------------
  await host.bringToFront();
  await host.click('[data-action="end"]');
  await host.waitForSelector('[data-ok]', { timeout: 5000 });
  await host.click('[data-ok]');
  await player.bringToFront();
  await player.waitForFunction(
    () => document.body.textContent.includes('Oturum tamamlandı'),
    { timeout: 8000, polling: 100 },
  );
  await sleep(400);
  await shot(player, '09c-player-ended');

  console.log('• Katılımcı akışı tamamlandı, moderatör modalları açılıyor…');

  // --- QR / dışa aktarma modalları -----------------------------------------
  await host.bringToFront();
  await host.click('[data-action="qr"]');
  await host.waitForSelector('.qr-box img', { timeout: 5000 });
  await sleep(600);
  await shot(host, '10-host-qr');
  await host.keyboard.press('Escape');

  await host.click('[data-action="export"]');
  await host.waitForSelector('a[download]', { timeout: 5000 });
  await sleep(300);
  await shot(host, '11-host-export');
  await host.keyboard.press('Escape');

  // --- Soru editörü ---------------------------------------------------------
  const host2 = await browser.newPage();
  watch(host2, 'host-editor');
  await host2.setViewport({ width: 1600, height: 980, deviceScaleFactor: 1 });
  await setSession(host2, token);
  await host2.goto(`${base}/h/${created2.code}?k=${encodeURIComponent(created2.hostKey)}`, {
    waitUntil: 'domcontentloaded',
  });
  await host2.waitForSelector('[data-action="edit"]', { timeout: 8000 });
  await host2.click('[data-action="edit"]');
  await host2.waitForSelector('.editor-card', { timeout: 5000 });
  await sleep(600);
  await shot(host2, '12-host-editor');

  // Katılımcı önizlemesi: aç, canlı güncellendiğini doğrula, kapat.
  await host2.click('[data-act="preview"][data-i="0"]');
  await host2.waitForSelector('#q-preview', { timeout: 5000 });
  const previewPrompt = await host2.$eval('#preview-player .q-prompt', (el) => el.textContent.trim());
  const editorPrompt = await host2.$eval(
    '.editor-card[data-qcard="0"] textarea[data-field="prompt"]',
    (el) => el.value.trim(),
  );
  if (previewPrompt !== editorPrompt) errors.push('Önizleme soru metniyle eşleşmiyor.');
  await sleep(400);
  await shot(host2, '12b-host-preview');
  await host2.click('[data-preview-close]');

  await host2.keyboard.press('Escape');

  // --- Ana sayfa ------------------------------------------------------------
  const home = await browser.newPage();
  watch(home, 'home');
  await home.setViewport({ width: 1440, height: 940, deviceScaleFactor: 1 });
  await setSession(home, token);
  await home.goto(`${base}/host`, { waitUntil: 'domcontentloaded' });
  await home.waitForSelector('#create-form', { timeout: 8000 });
  await home.waitForSelector('[data-theme-toggle]', { timeout: 5000 });
  await sleep(500);

  // Etkinliklerim: sol kartla eşit yükseklik, iki satır görünür, kalanlar içeride kaydırılır.
  const eventList = await home.evaluate(() => {
    const list = document.getElementById('event-list');
    if (!list) return null;
    const box = list.getBoundingClientRect();
    const rows = Array.from(list.children);
    const visible = rows.filter((row) => {
      const r = row.getBoundingClientRect();
      return r.top >= box.top - 2 && r.bottom <= box.bottom + 2;
    }).length;
    return {
      count: rows.length,
      visible,
      scrolls: getComputedStyle(list).overflowY === 'auto',
      clipped: list.scrollHeight > list.clientHeight + 2,
      panelHeight: Math.round(list.closest('.panel').getBoundingClientRect().height),
      createHeight: Math.round(document.getElementById('create-form').getBoundingClientRect().height),
    };
  });
  if (!eventList) errors.push('Etkinliklerim listesi bulunamadı.');
  else {
    if (eventList.count < 3) errors.push('Kaydırma kontrolü için en az 3 etkinlik gerekli.');
    if (eventList.visible !== 2) {
      errors.push(`Etkinliklerim kartında ${eventList.visible} satır görünüyor (2 bekleniyor).`);
    }
    if (!eventList.scrolls || !eventList.clipped) {
      errors.push('Etkinliklerim kartı fazla etkinlikler için içeride kaydırılmıyor.');
    }
    if (Math.abs(eventList.panelHeight - eventList.createHeight) > 2) {
      errors.push(
        `Kart yükseklikleri eşit değil (oluştur: ${eventList.createHeight}px, etkinlikler: ${eventList.panelHeight}px).`,
      );
    }
  }

  await shot(home, '13-host-home');

  // Tema düğmesi çalışıyor mu?
  const themeBefore = await home.evaluate(() => document.documentElement.dataset.theme);
  await home.click('[data-theme-toggle]');
  await sleep(250);
  const themeAfter = await home.evaluate(() => document.documentElement.dataset.theme);
  if (themeBefore === themeAfter) errors.push('Tema düğmesi temayı değiştirmedi.');
  await shot(home, '13b-host-home-theme');

  // --- Mobil yönetici -------------------------------------------------------
  const hostMobile = await browser.newPage();
  watch(hostMobile, 'host-mobile');
  await hostMobile.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await setSession(hostMobile, token);
  await hostMobile.goto(`${base}/h/${created.code}`, { waitUntil: 'domcontentloaded' });
  await hostMobile.waitForSelector('.q-title', { timeout: 8000 });
  await sleep(600);
  await shot(hostMobile, '14-host-mobile');
  await noOverflow(hostMobile, 'host-mobile');

  console.log(`\nEtkinlik: ${base}/j/${created.code}`);
  console.log(`Ekran görüntüleri: ${SHOTS}`);
} catch (err) {
  if (browser) {
    let n = 0;
    for (const page of await browser.pages()) {
      await page.screenshot({ path: path.join(SHOTS, `error-${n++}.png`) }).catch(() => {});
    }
  }
  errors.push(`SCRIPT: ${err.stack || err.message}`);
} finally {
  if (browser) await browser.close();
  await server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

if (errors.length) {
  console.error('\nHATALAR:');
  for (const error of errors) console.error(' -', error);
  process.exitCode = 1;
} else {
  console.log('\nTarayıcı kontrolü temiz: konsol hatası yok.');
}
