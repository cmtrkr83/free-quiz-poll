import { CAPTCHA_BG } from '../src/captcha.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TEST_ADMIN_PASSWORD = 'parola1234';

export function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'canli-oturum-test-'));
}

/** Sunucudan yeni bir captcha çeker; id + 5 karakterlik kod döner. */
export async function getCaptcha(base) {
  const response = await fetch(`${base}/api/auth/captcha`);
  assert.equal(response.status, 200, await response.clone().text());
  const parsed = parseCaptchaSvg(await response.text());
  assert.equal(parsed.code.length, 5);
  return parsed;
}

/**
 * Üretilen SVG'den id'yi ve gerçek (hayalet olmayan) kodu ayrıştırır.
 * Sözleşme: fill === CAPTCHA_BG olan <text> öğeleri hayalettir; gerçek
 * karakterler x'e göre sıralanıp birleştirilir. Öznitelik sırasına bağımlı değildir.
 */
export function parseCaptchaSvg(svg) {
  const id = /<!--captcha-id:([A-Za-z0-9_-]+)-->/.exec(svg)?.[1] || '';
  const parts = [...svg.matchAll(/<text\s+([^>]+)>([^<]*)<\/text>/g)].map((match) => ({
    x: Number(/x="(-?\d+)"/.exec(match[1])[1]),
    fill: /fill="([^"]+)"/.exec(match[1])[1],
    ch: match[2],
  }));
  const code = parts
    .filter((part) => part.fill !== CAPTCHA_BG)
    .sort((a, b) => a.x - b.x)
    .map((part) => part.ch)
    .join('');
  return { id, code };
}
