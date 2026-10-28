import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Server as SocketServer } from 'socket.io';
import QRCode from 'qrcode';
import { Store } from './src/store.js';
import * as M from './src/model.js';
import { demoQuestions } from './src/demo.js';
import { cleanText, safeEqual, normalizeCode, randomCode, createLimiter, newId, randomToken } from './src/util.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashToken,
  hashPassword,
  verifyPassword,
  normalizeUsername,
  usernameKey,
  validatePassword,
} from './src/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const VERSION = '1.0.0';
// Her sunucu başlangıcında değişen sürüm; tarayıcı önbelleğini kırar.
const ASSET_VERSION = Date.now().toString(36);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; font-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
};

export function createServer(options = {}) {
  const DATA_DIR = options.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data');
  const ADMIN_KEY = options.adminKey ?? process.env.ADMIN_KEY ?? '';
  const PUBLIC_URL = String(options.publicUrl ?? process.env.PUBLIC_URL ?? '').replace(/\/+$/, '');
  const EVENT_TTL_DAYS = Number(options.eventTtlDays ?? process.env.EVENT_TTL_DAYS ?? 14);
  const MAX_EVENTS = Number(options.maxEvents ?? process.env.MAX_EVENTS ?? 500);
  const TRUST_PROXY = options.trustProxy ?? process.env.TRUST_PROXY !== '0';

  const store = new Store(DATA_DIR).load();
  const online = new Map(); // code -> Map(pid -> baglı soket sayısı)
  const createLimiterFn = createLimiter({ windowMs: 60 * 60 * 1000, max: 60 });
  const joinLimiter = createLimiter({ windowMs: 60 * 1000, max: 300 });
  const loginLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
  const registerLimiter = createLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

  // Eski kayıtlara yeni alanları ekle.
  for (const ev of store.all()) {
    ev.settings = M.sanitizeSettings(ev.settings);
    if (!Object.prototype.hasOwnProperty.call(ev, 'ownerId')) ev.ownerId = null;
    M.normalizeEvent(ev);
  }
  store.pruneSessions();

  const app = express();
  const server = http.createServer(app);
  const io = new SocketServer(server, {
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    serveClient: true,
  });

  if (TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    }
    next();
  });

  app.use((req, res, next) => {
    const auth = sessionFromRequest(req);
    req.user = auth?.user || null;
    req.sessionHash = auth?.hash || null;
    next();
  });

  // ---------------------------------------------------------------------------
  // Yardımcılar
  // ---------------------------------------------------------------------------

  function baseUrlFromHeaders(headers = {}) {
    if (PUBLIC_URL) return PUBLIC_URL;
    const proto =
      String(headers['x-forwarded-proto'] || '').split(',')[0].trim() ||
      (server.listening ? 'http' : 'http');
    const host = String(headers['x-forwarded-host'] || headers.host || `localhost:${server.address()?.port || 3000}`)
      .split(',')[0]
      .trim();
    return `${proto}://${host}`;
  }

  function baseUrlFromReq(req) {
    if (PUBLIC_URL) return PUBLIC_URL;
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (req.secure ? 'https' : 'http');
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
    return `${proto}://${host}`;
  }

  // ---------------------------------------------------------------------------
  // Hesaplar ve oturumlar
  // ---------------------------------------------------------------------------

  function parseCookies(header = '') {
    const out = {};
    for (const part of String(header || '').split(';')) {
      const index = part.indexOf('=');
      if (index < 1) continue;
      const key = part.slice(0, index).trim();
      let value = part.slice(index + 1).trim();
      try {
        value = decodeURIComponent(value);
      } catch {
        /* ham değeri kullan */
      }
      if (key) out[key] = value;
    }
    return out;
  }

  function sessionFromCookieHeader(header = '') {
    const token = parseCookies(header)[SESSION_COOKIE];
    if (!token) return null;
    const hash = hashToken(token);
    const session = store.getSession(hash);
    if (!session) return null;
    if (!session.expiresAt || session.expiresAt <= Date.now()) {
      store.removeSession(hash);
      return null;
    }
    const user = store.getUser(session.userId);
    if (!user) {
      store.removeSession(hash);
      return null;
    }
    return { user, hash, session };
  }

  function sessionFromRequest(req) {
    return sessionFromCookieHeader(req.headers.cookie || '');
  }

  function isSecureRequest(req) {
    return (
      req.secure ||
      String(req.headers['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim() === 'https'
    );
  }

  function createSession(req, res, user) {
    const token = randomToken(32);
    const hash = hashToken(token);
    store.putSession(hash, {
      userId: user.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecureRequest(req),
      path: '/',
      maxAge: SESSION_TTL_MS,
    });
    return token;
  }

  function clearSession(req, res) {
    if (req.sessionHash) store.removeSession(req.sessionHash);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  function publicUser(user) {
    return { id: user.id, username: user.username, createdAt: user.createdAt };
  }

  function requireUser(req, res) {
    if (req.user) return true;
    res.status(401).json({ error: 'Bu işlem için giriş yapmalısınız.' });
    return false;
  }

  function eventSummary(req, ev) {
    const base = baseUrlFromReq(req);
    return {
      code: ev.code,
      title: ev.title,
      phase: ev.phase,
      current: ev.current,
      total: ev.questions.length,
      participants: ev.participants.length,
      createdAt: ev.createdAt,
      updatedAt: ev.updatedAt,
      hostUrl: `${base}/h/${ev.code}`,
      joinUrl: `${base}/j/${ev.code}`,
      acceptingResponses: ev.settings.acceptingResponses !== false,
      joinClosed: !!ev.settings.joinClosed,
    };
  }

  function playerOnlineCount(code) {
    return io.sockets.adapter.rooms.get(`p:${code}`)?.size || 0;
  }

  function markOnline(code, pid, delta) {
    let map = online.get(code);
    if (!map) {
      map = new Map();
      online.set(code, map);
    }
    const next = (map.get(pid) || 0) + delta;
    if (next <= 0) map.delete(pid);
    else map.set(pid, next);
  }

  function hostSnapshotFor(ev) {
    const map = online.get(ev.code) || new Map();
    return M.hostSnapshot(ev, {
      online: playerOnlineCount(ev.code),
      onlineIds: new Set(map.keys()),
      publicUrl: PUBLIC_URL || null,
    });
  }

  function broadcastHost(code) {
    const ev = store.get(code);
    if (!ev) return;
    io.to(`h:${code}`).emit('state', hostSnapshotFor(ev));
  }

  function broadcastPlayers(code, exceptSocketId = null) {
    const ev = store.get(code);
    if (!ev) return;

    // Her katılımcıya kendi kimliği/cevaplarıyla eşleşen durumu gönder.
    // Ortak (you: null) durum gönderilirse istemci kendini tanımadığını sanıp
    // sürekli yeniden katılmaya çalışır; bu da seçili cevabın kaybolmasına yol açar.
    const room = io.sockets.adapter.rooms.get(`p:${code}`);
    if (room) {
      for (const socketId of [...room]) {
        if (socketId === exceptSocketId) continue;
        const socket = io.sockets.sockets.get(socketId);
        if (!socket) continue;
        const pid =
          socket.data?.role === 'player' && socket.data.code === code ? socket.data.pid : null;
        socket.emit('state', M.publicSnapshot(ev, pid, { publicUrl: PUBLIC_URL || null }));
      }
    }

    io.to(`p:${code}`).emit('presence', {
      participants: ev.participants.length,
      online: playerOnlineCount(code),
    });
  }

  function broadcastAll(code) {
    broadcastHost(code);
    broadcastPlayers(code);
  }

  function requireHost(req, res, ev) {
    if (req.user && ev.ownerId === req.user.id) return true;
    const key = String(req.query.key || req.headers['x-host-key'] || '').trim();
    if (key && safeEqual(key, ev.hostKey)) return true;
    res.status(403).json({
      error: req.user ? 'Bu etkinlik hesabınıza ait değil.' : 'Giriş yapın veya yönetici anahtarını girin.',
    });
    return false;
  }

  function hostSocketOk(socket, code) {
    return socket.data?.role === 'host' && socket.data?.code === code;
  }

  function leavePlayerRoom(socket) {
    const d = socket.data;
    if (!d || d.role !== 'player') return;
    if (d.markedOnline) markOnline(d.code, d.pid, -1);
    socket.leave(`p:${d.code}`);
    socket.data = { role: null };
  }

  // ---------------------------------------------------------------------------
  // HTTP: sayfalar
  // ---------------------------------------------------------------------------

  function sendPage(res, fileName) {
    try {
      const html = fs
        .readFileSync(path.join(PUBLIC_DIR, fileName), 'utf8')
        .replaceAll('__ASSET_VERSION__', ASSET_VERSION);
      res.setHeader('Cache-Control', 'no-store');
      res.type('html').send(html);
    } catch (err) {
      console.error('[sayfa] okunamadı:', err.message);
      res.status(500).type('text').send('Sayfa yüklenemedi.');
    }
  }

  app.get('/', (req, res) => sendPage(res, 'index.html'));
  app.get(['/j/:code', '/e/:code', '/events/:code'], (req, res) => sendPage(res, 'index.html'));
  app.get(['/host', '/host/'], (req, res) => sendPage(res, 'host.html'));
  app.get(['/h/:code', '/host/:code'], (req, res) => sendPage(res, 'host.html'));

  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      maxAge: '1h',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store');
        } else if (/\.(?:js|css)$/.test(filePath)) {
          // Her istekte ETag ile doğrula; güncellemeler hemen görünsün.
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  // ---------------------------------------------------------------------------
  // HTTP: API
  // ---------------------------------------------------------------------------

  app.get('/healthz', (req, res) => {
    res.json({ ok: true, version: VERSION, uptime: Math.round(process.uptime()), events: store.count() });
  });

  // ---------------------------------------------------------------------------
  // HTTP: hesaplar
  // ---------------------------------------------------------------------------

  app.get('/api/auth/config', (req, res) => {
    res.json({
      registrationOpen: true,
      registerKeyRequired: !!ADMIN_KEY,
      users: store.userCount(),
    });
  });

  app.get('/api/auth/me', (req, res) => {
    res.json({ ok: true, user: req.user ? publicUser(req.user) : null });
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const ip = req.ip || 'unknown';
      if (!registerLimiter(ip)) {
        return res.status(429).json({ error: 'Çok fazla kayıt denemesi. Lütfen biraz bekleyin.' });
      }
      if (ADMIN_KEY) {
        const provided = String(req.body?.adminKey || req.headers['x-admin-key'] || '').trim();
        if (!safeEqual(provided, ADMIN_KEY)) {
          return res.status(401).json({ error: 'Kayıt anahtarı gerekli veya geçersiz.' });
        }
      }

      const username = normalizeUsername(req.body?.username);
      if (!username) {
        return res.status(400).json({
          error: 'Kullanıcı adı 3-32 karakter olmalı; harf, rakam, nokta, alt çizgi veya tire kullanın.',
        });
      }
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const passwordError = validatePassword(password);
      if (passwordError) return res.status(400).json({ error: passwordError });

      if (store.findUserByName(username)) {
        return res.status(409).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
      }

      const passwordHash = await hashPassword(password);
      if (store.findUserByName(username)) {
        return res.status(409).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
      }

      const firstUser = store.userCount() === 0;
      const user = {
        id: newId('u'),
        username,
        usernameKey: usernameKey(username),
        passwordHash,
        createdAt: Date.now(),
      };
      store.putUser(user);
      if (firstUser) {
        // Hesap sistemi eklenmeden önce oluşturulmuş etkinlikleri ilk yöneticiye devret.
        for (const ev of store.all()) {
          if (!ev.ownerId) ev.ownerId = user.id;
        }
      }
      store.touch();
      createSession(req, res, user);
      res.status(201).json({ ok: true, user: publicUser(user) });
    } catch (err) {
      console.error('[auth] kayıt hatası:', err);
      res.status(500).json({ error: 'Kayıt oluşturulamadı.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const ip = req.ip || 'unknown';
      if (!loginLimiter(ip)) {
        return res.status(429).json({ error: 'Çok fazla giriş denemesi. Lütfen biraz bekleyin.' });
      }
      const username = normalizeUsername(req.body?.username);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const user = username ? store.findUserByName(username) : null;
      const ok = user ? await verifyPassword(password, user.passwordHash) : false;
      if (!user || !ok) {
        return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
      }
      createSession(req, res, user);
      res.json({ ok: true, user: publicUser(user) });
    } catch (err) {
      console.error('[auth] giriş hatası:', err);
      res.status(500).json({ error: 'Giriş yapılamadı.' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSession(req, res);
    res.json({ ok: true });
  });

  app.get('/api/account/events', (req, res) => {
    if (!requireUser(req, res)) return;
    const events = store
      .all()
      .filter((ev) => ev.ownerId === req.user.id)
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .map((ev) => eventSummary(req, ev));
    res.json({ events });
  });

  app.post('/api/events', (req, res) => {
    if (!requireUser(req, res)) return;
    const ip = req.ip || 'unknown';
    if (!createLimiterFn(ip)) {
      return res.status(429).json({ error: 'Çok fazla etkinlik oluşturdunuz. Lütfen biraz bekleyin.' });
    }

    store.prune(EVENT_TTL_DAYS);
    if (store.count() >= MAX_EVENTS) {
      return res.status(503).json({
        error: `Etkinlik sınırına ulaşıldı (${MAX_EVENTS}). Eski etkinlikleri silin veya sunucu ayarını değiştirin.`,
      });
    }

    let code = randomCode(6);
    let guard = 0;
    while (store.get(code) && guard < 1000) {
      code = randomCode(6);
      guard += 1;
    }
    if (store.get(code)) return res.status(500).json({ error: 'Etkinlik kodu üretilemedi.' });

    const wantsDemo = req.body?.template === 'demo';
    const ev = M.createEvent({
      title: cleanText(req.body?.title, 100) || (wantsDemo ? 'Örnek Canlı Oturum' : 'Canlı Oturum'),
      questions: wantsDemo ? demoQuestions() : req.body?.questions,
      settings: req.body?.settings,
      ownerId: req.user.id,
    });
    ev.code = code;
    store.put(ev);

    const base = baseUrlFromReq(req);
    res.status(201).json({
      code: ev.code,
      title: ev.title,
      hostKey: ev.hostKey,
      joinUrl: `${base}/j/${ev.code}`,
      hostUrl: `${base}/h/${ev.code}`,
    });
  });

  app.get('/api/events/:code', (req, res) => {
    const ev = store.get(normalizeCode(req.params.code));
    if (!ev) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });
    res.json({
      code: ev.code,
      title: ev.title,
      phase: ev.phase,
      total: ev.questions.length,
      participants: ev.participants.length,
      joinClosed: ev.settings.joinClosed,
      acceptingResponses: ev.settings.acceptingResponses !== false,
    });
  });

  app.get('/api/events/:code/state', (req, res) => {
    const ev = store.get(normalizeCode(req.params.code));
    if (!ev) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });
    if (!requireHost(req, res, ev)) return;
    res.json(hostSnapshotFor(ev));
  });

  app.put('/api/events/:code', (req, res) => {
    const ev = store.get(normalizeCode(req.params.code));
    if (!ev) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });
    if (!requireHost(req, res, ev)) return;

    const body = req.body || {};
    if (body.questions !== undefined && ev.phase !== 'lobby') {
      return res.status(409).json({ error: 'Sorular yalnızca oturum başlamadan önce düzenlenebilir. Önce "Başlangıca dön" kullanın.' });
    }
    if (body.questions !== undefined && !Array.isArray(body.questions)) {
      return res.status(400).json({ error: 'Geçersiz soru listesi.' });
    }

    M.updateEvent(ev, body);
    store.touch();
    broadcastAll(ev.code);
    res.json({ ok: true, state: hostSnapshotFor(ev) });
  });

  app.post('/api/events/:code/action', (req, res) => {
    const ev = store.get(normalizeCode(req.params.code));
    if (!ev) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });
    if (!requireHost(req, res, ev)) return;

    const type = String(req.body?.type || '');
    const result = M.applyAction(ev, type, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    store.touch();
    broadcastAll(ev.code);
    res.json({ ok: true, state: hostSnapshotFor(ev) });
  });

  app.post('/api/events/:code/code', (req, res) => {
    const ev = store.get(normalizeCode(req.params.code));
    if (!ev) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });
    if (!requireHost(req, res, ev)) return;

    let next = normalizeCode(req.body?.code);
    if (!next) next = randomCode(6);
    if (!/^[A-Z0-9]{4,12}$/.test(next)) {
      return res.status(400).json({ error: 'Kod 4-12 karakter olmalı; harf ve rakam kullanın.' });
    }
    if (next === ev.code) {
      return res.status(400).json({ error: 'Yeni kod mevcut kodla aynı.' });
    }
    if (store.get(next)) {
      return res.status(409).json({ error: 'Bu kod başka bir etkinlikte kullanılıyor.' });
    }

    const oldCode = ev.code;
    if (!store.rekey(oldCode, next)) {
      return res.status(409).json({ error: 'Kod değiştirilemedi, tekrar deneyin.' });
    }

    // Açık soketleri yeni koda taşı.
    const hostRoom = io.sockets.adapter.rooms.get(`h:${oldCode}`);
    if (hostRoom) {
      for (const id of [...hostRoom]) {
        const s = io.sockets.sockets.get(id);
        if (!s) continue;
        s.leave(`h:${oldCode}`);
        s.join(`h:${next}`);
        if (s.data?.role === 'host') s.data = { ...s.data, code: next };
      }
    }
    const playerRoom = io.sockets.adapter.rooms.get(`p:${oldCode}`);
    if (playerRoom) {
      for (const id of [...playerRoom]) {
        const s = io.sockets.sockets.get(id);
        if (!s) continue;
        s.leave(`p:${oldCode}`);
        s.join(`p:${next}`);
        if (s.data?.role === 'player') s.data = { ...s.data, code: next };
      }
    }
    const map = online.get(oldCode);
    if (map) {
      online.delete(oldCode);
      online.set(next, map);
    }

    broadcastAll(next);
    io.to(`h:${next}`).emit('codeChanged', { oldCode, code: next });
    io.to(`p:${next}`).emit('codeChanged', { oldCode, code: next });

    const base = baseUrlFromReq(req);
    res.json({
      ok: true,
      code: next,
      hostUrl: `${base}/h/${next}`,
      joinUrl: `${base}/j/${next}`,
      state: hostSnapshotFor(ev),
    });
  });

  app.delete('/api/events/:code', (req, res) => {
    const ev = store.get(normalizeCode(req.params.code));
    if (!ev) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });
    if (!requireHost(req, res, ev)) return;
    store.remove(ev.code);
    io.to(`h:${ev.code}`).emit('deleted', { code: ev.code });
    io.to(`p:${ev.code}`).emit('deleted', { code: ev.code });
    res.json({ ok: true });
  });

  app.get('/api/events/:code/qr.png', async (req, res) => {
    const ev = store.get(normalizeCode(req.params.code));
    if (!ev) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });
    const size = Math.min(1024, Math.max(160, Number(req.query.size) || 640));
    const url = `${baseUrlFromReq(req)}/j/${ev.code}`;
    try {
      const buffer = await QRCode.toBuffer(url, {
        type: 'png',
        width: size,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#0f172aff', light: '#ffffffff' },
      });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(buffer);
    } catch (err) {
      console.error('[qr] üretilemedi:', err.message);
      res.status(500).json({ error: 'QR kod üretilemedi.' });
    }
  });

  app.get('/api/events/:code/qr.svg', async (req, res) => {
    const ev = store.get(normalizeCode(req.params.code));
    if (!ev) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });
    const url = `${baseUrlFromReq(req)}/j/${ev.code}`;
    try {
      const svg = await QRCode.toString(url, { type: 'svg', margin: 2, width: 640 });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(svg);
    } catch {
      res.status(500).json({ error: 'QR kod üretilemedi.' });
    }
  });

  app.get('/api/events/:code/export.csv', (req, res) => {
    const ev = store.get(normalizeCode(req.params.code));
    if (!ev) return res.status(404).json({ error: 'Etkinlik bulunamadı.' });
    if (!requireHost(req, res, ev)) return;

    const mode = req.query.mode === 'summary' ? 'summary' : 'participants';
    const csv = mode === 'summary' ? summaryCsv(ev) : participantsCsv(ev);
    const name = `${ev.code}-${mode === 'summary' ? 'ozet' : 'katilimcilar'}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(csv);
  });

  // ---------------------------------------------------------------------------
  // Socket.IO
  // ---------------------------------------------------------------------------

  io.on('connection', (socket) => {
    const reply = (ack, data) => {
      if (typeof ack === 'function') ack(data);
    };

    socket.on('host:join', (payload, ack) => {
      const code = normalizeCode(payload?.code);
      const key = String(payload?.key || '');
      const ev = store.get(code);
      if (!ev) return reply(ack, { ok: false, error: 'Etkinlik bulunamadı.' });

      const auth = sessionFromCookieHeader(socket.handshake.headers?.cookie || '');
      const ownsEvent = !!auth?.user && ev.ownerId === auth.user.id;
      const keyOk = !!key && safeEqual(key, ev.hostKey);
      if (!ownsEvent && !keyOk) {
        return reply(ack, { ok: false, error: 'Bu etkinlik için yetkiniz yok.' });
      }

      leavePlayerRoom(socket);
      socket.join(`h:${code}`);
      socket.data = { role: 'host', code };
      reply(ack, { ok: true, state: hostSnapshotFor(ev) });
    });

    socket.on('host:action', (payload, ack) => {
      const code = normalizeCode(payload?.code);
      if (!hostSocketOk(socket, code)) return reply(ack, { ok: false, error: 'Yetkisiz.' });
      const ev = store.get(code);
      if (!ev) return reply(ack, { ok: false, error: 'Etkinlik bulunamadı.' });

      const result = M.applyAction(ev, String(payload?.type || ''), payload || {});
      if (!result.ok) return reply(ack, { ok: false, error: result.error });

      store.touch();
      broadcastAll(code);
      reply(ack, { ok: true, state: hostSnapshotFor(ev) });
    });

    socket.on('host:update', (payload, ack) => {
      const code = normalizeCode(payload?.code);
      if (!hostSocketOk(socket, code)) return reply(ack, { ok: false, error: 'Yetkisiz.' });
      const ev = store.get(code);
      if (!ev) return reply(ack, { ok: false, error: 'Etkinlik bulunamadı.' });

      if (payload?.questions !== undefined && ev.phase !== 'lobby') {
        return reply(ack, {
          ok: false,
          error: 'Sorular yalnızca oturum başlamadan önce düzenlenebilir.',
        });
      }

      M.updateEvent(ev, payload || {});
      store.touch();
      broadcastAll(code);
      reply(ack, { ok: true, state: hostSnapshotFor(ev) });
    });

    socket.on('player:join', (payload, ack) => {
      const code = normalizeCode(payload?.code);
      const ip = socket.handshake.address || 'unknown';
      if (!joinLimiter(ip)) return reply(ack, { ok: false, error: 'Çok fazla deneme. Biraz sonra tekrar deneyin.' });

      const ev = store.get(code);
      if (!ev) return reply(ack, { ok: false, error: 'Bu kodla bir oturum bulunamadı.' });

      const result = M.registerParticipant(ev, {
        name: payload?.name,
        token: String(payload?.token || ''),
        socketId: socket.id,
      });
      if (!result.ok) return reply(ack, result);

      leavePlayerRoom(socket);
      socket.join(`p:${code}`);
      socket.data = { role: 'player', code, pid: result.player.id, markedOnline: true };
      markOnline(code, result.player.id, 1);
      store.touch();

      reply(ack, {
        ok: true,
        pid: result.player.id,
        token: result.player.token,
        state: M.publicSnapshot(ev, result.player.id, { publicUrl: PUBLIC_URL || null }),
      });

      broadcastHost(code);
      broadcastPlayers(code);
    });

    socket.on('player:answer', (payload, ack) => {
      const d = socket.data;
      if (!d || d.role !== 'player') return reply(ack, { ok: false, error: 'Önce oturuma katılın.' });
      const ev = store.get(d.code);
      if (!ev) return reply(ack, { ok: false, error: 'Etkinlik bulunamadı.' });
      const player = ev.participants.find((p) => p.id === d.pid);
      if (!player) return reply(ack, { ok: false, error: 'Katılımcı bulunamadı.' });

      if (ev.phase !== 'live') return reply(ack, { ok: false, error: 'Şu anda cevap alınmıyor.' });
      if (!ev.settings.acceptingResponses) {
        return reply(ack, {
          ok: false,
          error: 'Bu etkinlik şu anda cevap almıyor.',
          code: 'closed',
          state: M.publicSnapshot(ev, player.id, { publicUrl: PUBLIC_URL || null }),
        });
      }

      // Katılımcının kendi ekranındaki soru geçerlidir; herkes farklı soruda olabilir.
      const current = M.participantQuestion(ev, player);
      if (!current || current.q.id !== payload?.qid) {
        return reply(ack, {
          ok: false,
          error: 'Soru değişti, sayfa yenilendi.',
          code: 'stale',
          state: M.publicSnapshot(ev, player.id, { publicUrl: PUBLIC_URL || null }),
        });
      }
      const q = current.q;
      if (M.isQuestionExpired(ev, player, q)) {
        return reply(ack, {
          ok: false,
          error: 'Bu sorunun süresi doldu.',
          code: 'expired',
          state: M.publicSnapshot(ev, player.id, { publicUrl: PUBLIC_URL || null }),
        });
      }
      if (M.getAnswer(player, q.id) && !ev.settings.allowChange) {
        return reply(ack, {
          ok: false,
          error: 'Bu soruya zaten cevap verdiniz.',
          code: 'already',
          state: M.publicSnapshot(ev, player.id, { publicUrl: PUBLIC_URL || null }),
        });
      }

      const value = M.validateAnswer(q, payload?.value);
      if (value === null) return reply(ack, { ok: false, error: 'Geçersiz cevap.' });

      player.answers[q.id] = { v: value, at: Date.now() };
      player.lastSeen = Date.now();
      ev.updatedAt = Date.now();
      store.touch();

      reply(ack, {
        ok: true,
        value,
        state: M.publicSnapshot(ev, player.id, { publicUrl: PUBLIC_URL || null }),
      });
      broadcastHost(ev.code);
      // Diğer katılımcıların sonuç ekranı canlı kalsın; cevap veren kendi
      // yanıtını ack üzerinden alır (çift yeniden çizim olmasın).
      broadcastPlayers(ev.code, socket.id);
    });

    socket.on('player:next', (payload, ack) => {
      const d = socket.data;
      if (!d || d.role !== 'player') return reply(ack, { ok: false, error: 'Önce oturuma katılın.' });
      const ev = store.get(d.code);
      if (!ev) return reply(ack, { ok: false, error: 'Etkinlik bulunamadı.' });
      const player = ev.participants.find((p) => p.id === d.pid);
      if (!player) return reply(ack, { ok: false, error: 'Katılımcı bulunamadı.' });

      const result = M.advanceParticipant(ev, player);
      const state = M.publicSnapshot(ev, player.id, { publicUrl: PUBLIC_URL || null });
      if (!result.ok) return reply(ack, { ok: false, error: result.error, state });

      store.touch();
      reply(ack, { ok: true, done: !!result.done, state });
      broadcastHost(ev.code);
    });

    socket.on('player:sync', (payload, ack) => {
      const d = socket.data;
      if (!d || d.role !== 'player') return reply(ack, { ok: false, error: 'Önce oturuma katılın.' });
      const ev = store.get(d.code);
      if (!ev) return reply(ack, { ok: false, error: 'Etkinlik bulunamadı.' });
      const player = ev.participants.find((p) => p.id === d.pid);
      if (!player) return reply(ack, { ok: false, error: 'Katılımcı bulunamadı.' });
      reply(ack, { ok: true, state: M.publicSnapshot(ev, player.id, { publicUrl: PUBLIC_URL || null }) });
    });

    socket.on('player:ping', () => {
      const d = socket.data;
      if (!d || d.role !== 'player') return;
      const ev = store.get(d.code);
      if (!ev) return;
      const player = ev.participants.find((p) => p.id === d.pid);
      if (!player) return;
      player.lastSeen = Date.now();
      if (!d.markedOnline) {
        d.markedOnline = true;
        markOnline(d.code, d.pid, 1);
      }
    });

    socket.on('disconnect', () => {
      const d = socket.data;
      if (!d || d.role !== 'player') return;
      if (d.markedOnline) markOnline(d.code, d.pid, -1);
      const ev = store.get(d.code);
      if (ev) {
        const player = ev.participants.find((p) => p.id === d.pid);
        if (player) {
          player.lastSeen = Date.now();
          store.touch();
        }
      }
      broadcastHost(d.code);
      broadcastPlayers(d.code);
    });
  });

  // ---------------------------------------------------------------------------
  // CSV
  // ---------------------------------------------------------------------------

  function csvEscape(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  function answerText(q, player) {
    const a = M.getAnswer(player, q.id);
    if (!a) return '';
    if (q.type === 'mc' || q.type === 'quiz' || q.type === 'truefalse') {
      const values = Array.isArray(a.v) ? a.v : [a.v];
      return values.map((id) => q.options.find((o) => o.id === id)?.text || String(id)).join(', ');
    }
    return String(a.v);
  }

  function participantsCsv(ev) {
    const header = [
      'Katılımcı',
      'Puan',
      'Katılım zamanı',
      ...ev.questions.map((q, i) => `S${i + 1} - ${q.prompt}`),
    ];
    const rows = [header];
    const sorted = [...ev.participants].sort((a, b) => (b.score || 0) - (a.score || 0) || a.joinedAt - b.joinedAt);
    for (const p of sorted) {
      rows.push([
        p.name,
        p.score || 0,
        new Date(p.joinedAt).toISOString(),
        ...ev.questions.map((q) => answerText(q, p)),
      ]);
    }
    return `\uFEFF${rows.map((row) => row.map(csvEscape).join(';')).join('\r\n')}`;
  }

  function summaryCsv(ev) {
    const rows = [['Soru', 'Tür', 'Seçenek / Cevap', 'Adet', 'Yüzde', 'Doğru cevap']];
    ev.questions.forEach((q, index) => {
      const stats = M.computeStats(ev, q);
      const label = `S${index + 1} - ${q.prompt}`;
      const total = stats?.total || 0;
      const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);

      if (stats?.kind === 'choice') {
        for (const o of stats.options) {
          rows.push([label, M.TYPE_LABELS[q.type], o.text, o.count, pct(o.count), q.correctId === o.id ? 'Evet' : '']);
        }
        if (!stats.options.length) rows.push([label, M.TYPE_LABELS[q.type], '(cevap yok)', 0, 0, '']);
      } else if (stats?.kind === 'rating') {
        for (const d of stats.distribution) {
          rows.push([label, M.TYPE_LABELS[q.type], `${d.value} yıldız`, d.count, pct(d.count), '']);
        }
        rows.push([label, M.TYPE_LABELS[q.type], 'Ortalama', stats.avg, '', '']);
      } else {
        const items = stats?.items || stats?.words || [];
        for (const item of items) {
          rows.push([label, M.TYPE_LABELS[q.type], item.text, item.count, pct(item.count), '']);
        }
        if (!items.length) rows.push([label, M.TYPE_LABELS[q.type], '(cevap yok)', 0, 0, '']);
      }
    });
    return `\uFEFF${rows.map((row) => row.map(csvEscape).join(';')).join('\r\n')}`;
  }

  // ---------------------------------------------------------------------------
  // 404 / hata
  // ---------------------------------------------------------------------------

  app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı.' }));
  app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));
  app.use((err, req, res, next) => {
    console.error('[http] hata:', err.message);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  });

  // ---------------------------------------------------------------------------
  // Yaşam döngüsü
  // ---------------------------------------------------------------------------

  const pruneTimer = setInterval(() => {
    const removed = store.prune(EVENT_TTL_DAYS);
    if (removed) console.log(`[temizlik] ${removed} eski etkinlik silindi.`);
    const expired = store.pruneSessions();
    if (expired) console.log(`[temizlik] ${expired} süresi dolmuş oturum silindi.`);
  }, 6 * 60 * 60 * 1000);
  if (pruneTimer.unref) pruneTimer.unref();

  async function start(port = Number(options.port ?? process.env.PORT ?? 3000), host = options.host ?? process.env.HOST ?? '0.0.0.0') {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    return server.address();
  }

  async function close() {
    clearInterval(pruneTimer);
    await new Promise((resolve) => io.close(() => resolve()));
    store.saveNowSync();
  }

  return { app, server, io, store, start, close, config: { DATA_DIR, ADMIN_KEY, PUBLIC_URL, EVENT_TTL_DAYS, MAX_EVENTS } };
}

// -----------------------------------------------------------------------------
// Doğrudan çalıştırma
// -----------------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const instance = createServer();
  const address = await instance.start();
  const port = typeof address === 'object' && address ? address.port : process.env.PORT || 3000;
  console.log('');
  console.log('  Canlı Oturum çalışıyor');
  console.log(`  Yerel:      http://localhost:${port}`);
  console.log(`  Yönetici:   http://localhost:${port}/host`);
  console.log(`  Veri:       ${instance.config.DATA_DIR}`);
  console.log(
    `  Kayıt:      açık${instance.config.ADMIN_KEY ? ' (ADMIN_KEY ile korunuyor)' : ' (kayıt anahtarı yok)'}`,
  );
  if (instance.config.PUBLIC_URL) console.log(`  Genel URL:  ${instance.config.PUBLIC_URL}`);
  console.log('');

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[${signal}] kapatılıyor...`);
    try {
      await instance.close();
    } catch (err) {
      console.error('Kapatma hatası:', err.message);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => console.error('[uncaught]', err));
  process.on('unhandledRejection', (err) => console.error('[unhandled]', err));
}
