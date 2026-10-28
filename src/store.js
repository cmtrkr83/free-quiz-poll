import fs from 'node:fs';
import path from 'node:path';

/**
 * Tek dosyalı JSON depolama. Tek süreç (single instance) için tasarlandı.
 * Yazma işlemleri 400 ms geciktirilip birleştirilir, dosyaya atomik olarak yazılır.
 */
export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.data = { version: 2, events: {}, users: {}, sessions: {} };
    this._saveTimer = null;
    this._saving = null;
    this._dirty = false;
    fs.mkdirSync(dir, { recursive: true });
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.events && typeof parsed.events === 'object') {
        this.data = {
          version: 2,
          events: parsed.events,
          users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {},
          sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
        };
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[store] db.json okunamadı, boş veri ile devam ediliyor:', err.message);
        try {
          fs.copyFileSync(this.file, `${this.file}.bozuk-${Date.now()}`);
        } catch {
          /* yedek alınamadıysa devam */
        }
      }
    }
    return this;
  }

  get(code) {
    return this.data.events[String(code || '').toUpperCase()] || null;
  }

  get events() {
    return this.data.events;
  }

  all() {
    return Object.values(this.data.events);
  }

  count() {
    return Object.keys(this.data.events).length;
  }

  // --- Kullanıcılar ---------------------------------------------------------

  get users() {
    return this.data.users;
  }

  userCount() {
    return Object.keys(this.data.users).length;
  }

  getUser(id) {
    return this.data.users[id] || null;
  }

  findUserByName(username) {
    const key = String(username || '').toLocaleLowerCase('tr');
    return Object.values(this.data.users).find((u) => u.usernameKey === key) || null;
  }

  putUser(user) {
    this.data.users[user.id] = user;
    this.touch();
  }

  // --- Oturumlar ------------------------------------------------------------

  getSession(tokenHash) {
    return this.data.sessions[tokenHash] || null;
  }

  putSession(tokenHash, session) {
    this.data.sessions[tokenHash] = session;
    this.touch();
  }

  removeSession(tokenHash) {
    if (!this.data.sessions[tokenHash]) return false;
    delete this.data.sessions[tokenHash];
    this.touch();
    return true;
  }

  removeUserSessions(userId) {
    let removed = 0;
    for (const [hash, session] of Object.entries(this.data.sessions)) {
      if (session.userId === userId) {
        delete this.data.sessions[hash];
        removed += 1;
      }
    }
    if (removed) this.touch();
    return removed;
  }

  pruneSessions(now = Date.now()) {
    let removed = 0;
    for (const [hash, session] of Object.entries(this.data.sessions)) {
      if (!session || session.expiresAt <= now) {
        delete this.data.sessions[hash];
        removed += 1;
      }
    }
    if (removed) this.touch();
    return removed;
  }

  put(ev) {
    this.data.events[ev.code] = ev;
    this.touch();
  }

  remove(code) {
    const key = String(code || '').toUpperCase();
    if (!this.data.events[key]) return false;
    delete this.data.events[key];
    this.touch();
    return true;
  }

  /** Etkinliği yeni koda taşı. Eski kodun kaydı silinir. */
  rekey(oldCode, newCode) {
    const from = String(oldCode || '').toUpperCase();
    const to = String(newCode || '').toUpperCase();
    const ev = this.data.events[from];
    if (!ev || !to || from === to) return false;
    if (this.data.events[to]) return false;
    delete this.data.events[from];
    ev.code = to;
    this.data.events[to] = ev;
    this.touch();
    return true;
  }

  /** Değişiklik olduğunu işaretle ve gecikmeli kayıt planla. */
  touch() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.saveNow().catch((err) => console.error('[store] kayıt hatası:', err.message));
    }, 400);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  serialized() {
    return JSON.stringify(this.data);
  }

  async saveNow() {
    if (!this._dirty && fs.existsSync(this.file)) return;
    const json = this.serialized();
    const tmp = `${this.file}.tmp`;
    await fs.promises.writeFile(tmp, json, 'utf8');
    try {
      await fs.promises.rename(tmp, this.file);
    } catch (err) {
      // Windows'ta hedef dosya kilitliyse rename başarısız olabilir.
      if (err.code === 'EPERM' || err.code === 'EEXIST') {
        await fs.promises.rm(this.file, { force: true });
        await fs.promises.rename(tmp, this.file);
      } else {
        throw err;
      }
    }
    this._dirty = false;
  }

  saveNowSync() {
    try {
      if (this._saveTimer) {
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
      }
      const json = this.serialized();
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, json, 'utf8');
      try {
        fs.renameSync(tmp, this.file);
      } catch {
        fs.rmSync(this.file, { force: true });
        fs.renameSync(tmp, this.file);
      }
      this._dirty = false;
    } catch (err) {
      console.error('[store] senkron kayıt hatası:', err.message);
    }
  }

  /** Verilen günden eski etkinlikleri siler. */
  prune(days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const ev of this.all()) {
      if ((ev.updatedAt || ev.createdAt || 0) < cutoff) {
        delete this.data.events[ev.code];
        removed += 1;
      }
    }
    if (removed > 0) this.touch();
    return removed;
  }
}
