import { randomCode, newId, isSafeId, safeEqual } from './util.js';

export const CAPTCHA_BG = '#f0f2f5';

const TEXT_PALETTE = ['#1f2937', '#7c2d12', '#1e3a8a', '#14532d', '#4c1d95'];
const NOISE_COLORS = ['#c8ccd6', '#d6c8c8', '#c8d6cc'];
const REAL_X = [14, 40, 66, 92, 118];
const GHOST_X = [27, 105];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function jitter() {
  return Math.floor(Math.random() * 9) - 4;
}

function textEl(x, y, fill, ch) {
  const deg = Math.floor(Math.random() * 25) - 12;
  return `<text x="${x}" y="${y}" fill="${fill}" transform="rotate(${deg} ${x} ${y})" font-family="monospace" font-size="26" font-weight="700">${ch}</text>`;
}

function render(id, code) {
  const lines = [];
  for (let i = 0; i < 3; i += 1) {
    const x1 = Math.floor(Math.random() * 150);
    const x2 = Math.floor(Math.random() * 150);
    const y1 = Math.floor(Math.random() * 50);
    const y2 = Math.floor(Math.random() * 50);
    lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${pick(NOISE_COLORS)}" stroke-width="1"/>`);
  }

  const chars = [];
  [...code].forEach((ch, i) => {
    const x = REAL_X[i] + jitter();
    const y = 34 + (Math.floor(Math.random() * 11) - 5);
    chars.push(textEl(x, y, pick(TEXT_PALETTE), ch));
  });
  // Hayalet karakterler: arka plan rengiyle — DOM'dan kod çeken botları yanıltır.
  GHOST_X.forEach((baseX) => {
    const x = baseX + jitter();
    const y = 34 + (Math.floor(Math.random() * 11) - 5);
    chars.push(textEl(x, y, CAPTCHA_BG, randomCode(1)));
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50" viewBox="0 0 150 50">` +
    `<!--captcha-id:${id}-->` +
    `<rect width="150" height="50" fill="${CAPTCHA_BG}"/>` +
    lines.join('') +
    chars.join('') +
    '</svg>'
  );
}

/**
 * Bellek içi captcha deposu. TTL ve clock enjekte edilebilir (testler için).
 * Kod yalnız başarılı doğrulamada silinir; yanlış kod aynı görselle tekrar denenebilir.
 */
export function createCaptchaStore({ ttlMs = 300_000, maxEntries = 1000, now = Date.now } = {}) {
  const entries = new Map();

  function prune() {
    const cutoff = now();
    // Ekleniş sırası = son kullanma sırası (sabit TTL); yalnız başına sırayı sil.
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= cutoff) entries.delete(key);
      else break;
    }
    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
    }
  }

  function create() {
    prune();
    const id = newId('cap');
    const code = randomCode(5);
    entries.set(id, { code, expiresAt: now() + ttlMs });
    return { id, svg: render(id, code) };
  }

  function verify(id, code) {
    if (!isSafeId(id, 64)) return false;
    const entry = entries.get(id);
    if (!entry) return false;
    if (entry.expiresAt <= now()) {
      entries.delete(id);
      return false;
    }
    const ok = safeEqual(String(code ?? '').trim().toUpperCase(), entry.code);
    if (ok) entries.delete(id);
    return ok;
  }

  return {
    create,
    verify,
    get size() {
      return entries.size;
    },
  };
}
