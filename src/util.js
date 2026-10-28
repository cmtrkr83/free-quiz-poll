import crypto from 'node:crypto';

// Karıştırılabilecek harfler (I, O, 0, 1) kullanılmaz.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function randomToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function newId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanText(value, max = 200, { multiline = false } = {}) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  let text = String(value).replace(CONTROL_CHARS, '').replace(/\r\n?/g, '\n');
  if (multiline) {
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  } else {
    text = text.replace(/\s+/g, ' ');
  }
  return text.trim().slice(0, max);
}

export function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function safeEqual(a = '', b = '') {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb) && String(a).length > 0;
}

export function isSafeId(value, max = 64) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);
}

/** Basit, bellek içi hız sınırlayıcı. Çoklu instance için uygun değildir. */
export function createLimiter({ windowMs = 60_000, max = 30 } = {}) {
  const hits = new Map();
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, list] of hits) {
      const kept = list.filter((t) => t > cutoff);
      if (kept.length) hits.set(key, kept);
      else hits.delete(key);
    }
  }, Math.min(windowMs, 60_000));
  if (timer.unref) timer.unref();

  return function take(key) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const list = (hits.get(key) || []).filter((t) => t > cutoff);
    if (list.length >= max) {
      hits.set(key, list);
      return false;
    }
    list.push(now);
    hits.set(key, list);
    return true;
  };
}

export function normalizeCode(value, len = 6) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.slice(0, len);
}
