import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { cleanText } from './util.js';

const scrypt = promisify(crypto.scrypt);

export const SESSION_COOKIE = 'co_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const expected = Buffer.from(hashB64, 'base64url');
    if (!expected.length) return false;
    const key = await scrypt(String(password), Buffer.from(saltB64, 'base64url'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** Kullanıcı adı: 3-32 karakter; harf, rakam, nokta, alt çizgi, tire. */
export function normalizeUsername(value) {
  const username = cleanText(value, 32);
  if (!/^[\p{L}\p{N}._-]{3,32}$/u.test(username)) return null;
  return username;
}

export function usernameKey(username) {
  return String(username || '').toLocaleLowerCase('tr');
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Şifre en az 8 karakter olmalı.';
  }
  if (password.length > 200) return 'Şifre çok uzun.';
  return null;
}
