/* Yönetici paneli — /host ve /h/CODE */
(() => {
  'use strict';

  const root = document.getElementById('root');
  const modalEl = document.getElementById('modal');
  const toastEl = document.getElementById('toast');

  const TYPE_LABELS = {
    mc: 'Oylama (çoktan seçmeli)',
    quiz: 'Quiz (puanlı)',
    truefalse: 'Doğru / Yanlış',
    open: 'Açık uçlu',
    wordcloud: 'Kelime bulutu',
    rating: 'Puanlama (1-5)',
  };

  const S = {
    route: 'home',
    code: null,
    key: null,
    meta: null,
    state: null,
    socket: null,
    connected: false,
    renderSig: '',
    offset: 0,
    editor: null,
    previewIndex: null,
    lastStatsHtml: '',
    lastParticipantsHtml: '',
    participantsSig: '',
    user: null,
    authConfig: null,
    authMode: 'login',
    events: [],
  };

  // ---------------------------------------------------------------------------
  // Yardımcılar
  // ---------------------------------------------------------------------------

  const esc = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const normalizeCode = (value) =>
    String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);

  const initials = (name) => {
    const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0] || '').join('').toUpperCase() || '?';
  };

  const clamp = (value, min, max, fallback = 0) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  function readStorage(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* yok say */
    }
  }

  function removeStorage(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* yok say */
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'İstek tamamlanamadı.');
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function hostHeaders(extra = {}) {
    return S.key ? { 'x-host-key': S.key, ...extra } : { ...extra };
  }

  function toast(message, kind = '') {
    toastEl.textContent = message;
    toastEl.className = `toast show ${kind}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toastEl.className = 'toast';
    }, 3400);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Kopyalandı.', 'good');
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
        toast('Kopyalandı.', 'good');
      } catch {
        toast('Kopyalanamadı. Bağlantıyı elle seçebilirsin.', 'bad');
      }
      area.remove();
    }
  }

  function savedEvents() {
    const list = readStorage('co:events', []);
    return Array.isArray(list) ? list : [];
  }

  function saveEventLocal(code, title, key, createdAt) {
    const list = savedEvents().filter((e) => e.code !== code);
    list.unshift({ code, title, key, createdAt: createdAt || Date.now() });
    writeStorage('co:events', list.slice(0, 40));
    if (key) writeStorage(`co:host:${code}`, { key });
  }

  function removeEventLocal(code) {
    writeStorage(
      'co:events',
      savedEvents().filter((e) => e.code !== code),
    );
    removeStorage(`co:host:${code}`);
  }

  function joinUrl() {
    const base = String(S.state?.publicUrl || S.meta?.publicUrl || location.origin).replace(/\/+$/, '');
    return `${base}/j/${S.code}`;
  }

  function fmtDate(ts) {
    try {
      return new Date(ts).toLocaleString('tr-TR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  function elapsedLabel(ts) {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'az önce';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} dk önce`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} sa önce`;
    return fmtDate(ts);
  }

  // ---------------------------------------------------------------------------
  // Modal altyapısı
  // ---------------------------------------------------------------------------

  function openModal({ title, body, footer = '', wide = false, narrow = false, onMount = null }) {
    modalEl.innerHTML = `
      <div class="modal-card ${wide ? 'wide' : ''} ${narrow ? 'narrow' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head">
          <h3>${esc(title)}</h3>
          <span class="spacer"></span>
          <button class="icon-btn" type="button" data-close aria-label="Kapat">✕</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>`;
    modalEl.hidden = false;
    modalEl.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => closeModal()));
    modalEl.onclick = (event) => {
      if (event.target === modalEl) closeModal();
    };
    if (onMount) onMount(modalEl);
    if (window.innerWidth > 700) {
      const first = modalEl.querySelector('.modal-body input, .modal-body textarea, .modal-foot .btn-primary');
      if (first) setTimeout(() => first.focus(), 60);
    }
  }

  function closeModal(force = false) {
    if (!force && S.editor?.dirty) {
      if (!window.confirm('Kaydedilmemiş değişiklikler var. Kapatılsın mı?')) return;
    }
    S.editor = null;
    S.previewIndex = null;
    closePreview();
    modalEl.hidden = true;
    modalEl.innerHTML = '';
    modalEl.onclick = null;
  }

  function confirmDialog({ title, message, confirmText = 'Onayla', danger = false }) {
    return new Promise((resolve) => {
      openModal({
        title,
        narrow: true,
        body: `<p class="muted" style="font-size:14.5px;line-height:1.55">${esc(message)}</p>`,
        footer: `<span class="spacer"></span>
          <button class="btn btn-ghost" type="button" data-cancel>Vazgeç</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-ok>${esc(confirmText)}</button>`,
      });
      modalEl.querySelector('[data-cancel]').addEventListener('click', () => {
        closeModal(true);
        resolve(false);
      });
      modalEl.querySelector('[data-ok]').addEventListener('click', () => {
        closeModal(true);
        resolve(true);
      });
      modalEl.onclick = (event) => {
        if (event.target === modalEl) {
          closeModal(true);
          resolve(false);
        }
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Yönetici oturumu
  // ---------------------------------------------------------------------------

  async function loadEventMeta() {
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(S.code)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Etkinlik bulunamadı.');
      S.meta = await response.json();
      if (S.meta.title) document.title = `${S.meta.title} — Yönetici`;
      return true;
    } catch {
      S.meta = null;
      return false;
    }
  }

  function renderLoading() {
    root.innerHTML = `
      <div class="empty" style="padding-top: 22vh">
        <div class="spinner" aria-hidden="true"></div>
        <p style="margin-top: 12px">Panele bağlanılıyor…</p>
      </div>`;
  }

  function renderMissing() {
    root.innerHTML = `
      <div class="empty" style="padding-top: 18vh;max-width:440px;margin:0 auto">
        <div class="big">🔍</div>
        <h2 style="font-size:20px;color:var(--text);margin-bottom:6px">Etkinlik bulunamadı</h2>
        <p>Bu kodla bir etkinlik yok veya silinmiş olabilir.</p>
        <a class="btn btn-primary" href="/host" style="margin-top:16px">Etkinlik paneline dön</a>
      </div>`;
  }

  function renderKeyGate(message = '') {
    const title = S.meta?.title ? esc(S.meta.title) : 'Yönetici girişi';
    root.innerHTML = `
      <header class="topbar">
        <a class="brand" href="/host"><span class="brand-mark">⚡</span><span class="brand-name">Canlı Oturum</span></a>
        <span class="sep"></span>
        <span class="pill">${esc(S.code || '')}</span>
        <span class="spacer"></span>
        <a class="btn btn-ghost btn-sm" href="/host">Etkinlikler</a>
      </header>
      <main class="home-wrap" style="max-width:520px;padding-top:clamp(30px,8vh,90px)">
        <div class="card stack">
          <div class="center stack" style="align-items:center;gap:10px">
            <div class="logo-mark" style="animation:none;width:52px;height:52px;border-radius:16px;font-size:24px">🔐</div>
            <div>
              <h1 style="font-size:22px;font-weight:800;letter-spacing:-.02em">${title}</h1>
              <p class="muted small" style="margin-top:4px">Bu etkinliği yönetmek için yönetici anahtarını gir.</p>
            </div>
          </div>
          <form id="key-form" class="stack">
            <div>
              <label class="label" for="key-input">Yönetici anahtarı</label>
              <input id="key-input" class="input" type="password" autocomplete="off" placeholder="Anahtarı yapıştır" />
            </div>
            <p class="err" id="key-err">${esc(message)}</p>
            <button class="btn btn-primary btn-lg" type="submit">Panele gir</button>
            ${
              S.user
                ? `<p class="hint center">Şu anda <b>${esc(S.user.username)}</b> hesabıyla giriş yapılmış. Bu etkinlik bu hesaba bağlı değilse yönetici anahtarını kullan.</p>`
                : `<a class="btn btn-ghost" href="/host">Hesabımla giriş yap</a>`
            }
          </form>
          <p class="hint center">${S.user ? 'Hesabına bağlı etkinlikler panelde listelenir.' : 'Anahtar, etkinliği oluşturan tarayıcıda otomatik olarak saklanır.'}</p>
        </div>
      </main>`;
    document.getElementById('key-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = document.getElementById('key-input').value.trim();
      if (!value) return;
      S.key = value;
      writeStorage(`co:host:${S.code}`, { key: value });
      renderLoading();
      connectHost();
    });
  }

  function connectHost() {
    if (S.socket) {
      S.socket.removeAllListeners();
      S.socket.disconnect();
      S.socket = null;
    }
    const socket = io();
    S.socket = socket;

    socket.on('connect', () => {
      S.connected = true;
      socket.timeout(9000).emit('host:join', { code: S.code, key: S.key }, (err, res) => {
        if (err) {
          toast('Sunucuya ulaşılamadı, yeniden deneniyor…', 'bad');
          return;
        }
        if (!res?.ok) {
          S.key = null;
          removeStorage(`co:host:${S.code}`);
          renderKeyGate(res?.error || 'Bu etkinlik için yetkiniz yok.');
          return;
        }
        setState(res.state);
      });
    });

    socket.on('disconnect', () => {
      S.connected = false;
      updateConn();
    });

    socket.on('state', (next) => {
      if (next?.role === 'host') setState(next);
    });

    socket.on('codeChanged', ({ oldCode, code }) => {
      if (!code || oldCode !== S.code) return;
      S.code = code;
      if (S.meta) S.meta.code = code;
      const saved = readStorage(`co:host:${oldCode}`, null);
      if (saved) {
        writeStorage(`co:host:${code}`, saved);
        removeStorage(`co:host:${oldCode}`);
      }
      history.replaceState(null, '', `/h/${code}`);
      S.renderSig = '';
      if (S.state) {
        S.state.code = code;
        renderDash();
      }
      toast(`Etkinlik kodu değişti: ${code}`, 'good');
    });

    socket.on('deleted', () => {
      toast('Etkinlik silindi.', 'bad');
      setTimeout(() => {
        location.href = '/host';
      }, 1000);
    });
  }

  function setState(next) {
    if (!next) return;
    S.state = next;
    S.offset = (next.serverNow || Date.now()) - Date.now();
    if (next.title) document.title = `${next.title} — Yönetici`;

    const questionsSig = (next.questions || [])
      .map((q) => `${q.id}:${q.prompt}:${q.type}:${q.multi ? 1 : 0}:${q.options.map((o) => o.id).join(',')}:${q.correctId || ''}`)
      .join('~');
    const settingsSig = `${next.settings?.acceptingResponses !== false}:${next.settings?.joinClosed}:${next.settings?.liveResults}:${next.settings?.showLeaderboard}`;
    const sig = [next.phase, next.current, next.total, next.title, questionsSig, settingsSig].join('|');

    if (sig !== S.renderSig) {
      S.renderSig = sig;
      S.lastStatsHtml = '';
      S.lastParticipantsHtml = '';
      renderDash();
    } else {
      updateLive();
    }
    updateConn();
  }

  function updateConn() {
    const dot = document.getElementById('conn-dot');
    if (dot) {
      dot.classList.toggle('off', !S.connected);
      dot.title = S.connected ? 'Bağlı' : 'Bağlantı yok';
    }
    const label = document.getElementById('conn-label');
    if (label) label.textContent = S.connected ? 'Canlı' : 'Bağlantı yok';
  }

  async function hostAction(type, extra = {}) {
    if (!S.socket?.connected) {
      toast('Sunucu bağlantısı yok. Birkaç saniye sonra tekrar dene.', 'bad');
      return;
    }
    S.socket.timeout(9000).emit('host:action', { code: S.code, type, ...extra }, (err, res) => {
      if (err) return toast('İşlem zaman aşımına uğradı.', 'bad');
      if (!res?.ok) return toast(res?.error || 'İşlem başarısız.', 'bad');
      if (res.state) setState(res.state);
    });
  }

  async function updateSettings(patch) {
    if (!S.socket?.connected) return toast('Bağlantı yok.', 'bad');
    S.socket.timeout(9000).emit('host:update', { code: S.code, settings: patch }, (err, res) => {
      if (err) return toast('Ayar kaydedilemedi.', 'bad');
      if (!res?.ok) return toast(res?.error || 'Ayar kaydedilemedi.', 'bad');
      if (res.state) setState(res.state);
    });
  }

  function updateTitle(title) {
    return new Promise((resolve) => {
      const value = String(title || '').trim();
      if (!value) {
        toast('Başlık boş olamaz.', 'bad');
        return resolve(false);
      }
      if (!S.socket?.connected) {
        toast('Bağlantı yok.', 'bad');
        return resolve(false);
      }
      S.socket.timeout(9000).emit('host:update', { code: S.code, title: value }, (err, res) => {
        if (err || !res?.ok) {
          toast(res?.error || 'Başlık kaydedilemedi.', 'bad');
          return resolve(false);
        }
        if (res.state) {
          S.renderSig = '';
          setState(res.state);
        }
        toast('Başlık güncellendi.', 'good');
        resolve(true);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Ana sayfa
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Hesap / giriş
  // ---------------------------------------------------------------------------

  async function refreshSession() {
    try {
      const configResponse = await fetch('/api/auth/config', { headers: { Accept: 'application/json' } });
      S.authConfig = await configResponse.json().catch(() => ({}));
    } catch {
      S.authConfig = {};
    }
    try {
      const response = await fetch('/api/auth/me', { headers: { Accept: 'application/json' } });
      if (response.ok) {
        const data = await response.json();
        S.user = data.user || null;
      } else {
        S.user = null;
      }
    } catch {
      S.user = null;
    }
    return S.user;
  }

  async function loadAccountEvents() {
    if (!S.user) {
      S.events = [];
      return;
    }
    try {
      const data = await api('/api/account/events');
      S.events = Array.isArray(data.events) ? data.events : [];
    } catch (err) {
      if (err.status === 401) S.user = null;
      S.events = [];
    }
  }

  function renderAuth(message = '') {
    const mode = S.authMode === 'register' ? 'register' : 'login';
    const config = S.authConfig || {};
    const title = mode === 'register' ? 'Yönetici hesabı oluştur' : 'Yönetici girişi';
    root.innerHTML = `
      <header class="topbar">
        <a class="brand" href="/host"><span class="brand-mark">⚡</span><span class="brand-name">Canlı Oturum</span></a>
        <span class="pill">Yönetici</span>
        <span class="spacer"></span>
        <a class="btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener">Katılımcı ekranı ↗</a>
      </header>

      <main class="home-wrap" style="max-width:540px;padding-top:clamp(28px,7vh,76px)">
        <div class="card stack" style="gap:16px">
          <div class="center stack" style="align-items:center;gap:10px;text-align:center">
            <div class="logo-mark" style="animation:none;width:54px;height:54px;border-radius:17px;font-size:26px">🔐</div>
            <div>
              <h1 style="font-size:23px;font-weight:820;letter-spacing:-.025em">${esc(title)}</h1>
              <p class="muted small" style="margin-top:5px">
                Etkinliklerin hesabında saklanır; daha sonra açıp yeniden kullanabilirsin.
              </p>
            </div>
          </div>

          <div class="auth-tabs" role="tablist" aria-label="Giriş veya kayıt">
            <button type="button" class="btn btn-sm ${mode === 'login' ? 'btn-primary' : 'btn-ghost'}" data-auth-mode="login" role="tab" aria-selected="${mode === 'login'}">Giriş yap</button>
            <button type="button" class="btn btn-sm ${mode === 'register' ? 'btn-primary' : 'btn-ghost'}" data-auth-mode="register" role="tab" aria-selected="${mode === 'register'}">Kayıt ol</button>
          </div>

          <form id="auth-form" class="stack" novalidate>
            <div>
              <label class="label" for="auth-username">Kullanıcı adı</label>
              <input id="auth-username" class="input" name="username" maxlength="32" autocomplete="username"
                placeholder="Örn. ogretmen.ayse" value="${esc(S.user?.username || '')}" />
            </div>
            <div>
              <label class="label" for="auth-password">Şifre</label>
              <input id="auth-password" class="input" name="password" type="password" minlength="8"
                autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" placeholder="En az 8 karakter" />
            </div>
            ${
              mode === 'register' && config.registerKeyRequired
                ? `<div>
                    <label class="label" for="auth-admin-key">Kayıt anahtarı</label>
                    <input id="auth-admin-key" class="input" type="password" autocomplete="off" placeholder="Sunucu yöneticisinin anahtarı" />
                    <p class="hint" style="margin-top:6px">Bu sunucuda yeni hesap açmak için anahtar gerekiyor.</p>
                  </div>`
                : ''
            }
            <p class="err" id="auth-err">${esc(message)}</p>
            <button class="btn btn-primary btn-lg" type="submit" id="auth-submit">
              ${mode === 'register' ? 'Hesap oluştur' : 'Giriş yap'}
            </button>
          </form>

          <p class="hint center">${
            mode === 'register'
              ? config.registerKeyRequired
                ? 'Kayıt anahtarını sunucuyu kuran kişiden alabilirsin.'
                : 'İlk kayıt olan yönetici, hesap sistemi öncesinde oluşturulmuş etkinlikleri devralır.'
              : 'Katılımcılar hesap açmadan yalnızca etkinlik koduyla katılır.'
          }</p>
        </div>
      </main>`;

    root.querySelectorAll('[data-auth-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        S.authMode = button.dataset.authMode;
        renderAuth();
      });
    });

    const form = document.getElementById('auth-form');
    const errEl = document.getElementById('auth-err');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errEl.textContent = '';
      const username = document.getElementById('auth-username').value.trim();
      const password = document.getElementById('auth-password').value;
      const adminKey = document.getElementById('auth-admin-key')?.value.trim() || '';
      if (username.length < 3) {
        errEl.textContent = 'Kullanıcı adı en az 3 karakter olmalı.';
        return;
      }
      if (password.length < 8) {
        errEl.textContent = 'Şifre en az 8 karakter olmalı.';
        return;
      }

      const button = document.getElementById('auth-submit');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Lütfen bekle…';
      try {
        const data = await api(`/api/auth/${mode}`, {
          method: 'POST',
          body: JSON.stringify({ username, password, adminKey }),
        });
        S.user = data.user || null;
        S.authMode = 'login';
        toast(mode === 'register' ? 'Hesabın oluşturuldu.' : 'Giriş yapıldı.', 'good');
        await boot();
      } catch (error) {
        errEl.textContent = error.message || 'İşlem tamamlanamadı.';
        button.disabled = false;
        button.textContent = mode === 'register' ? 'Hesap oluştur' : 'Giriş yap';
      }
    });
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* oturum zaten kapanmış olabilir */
    }
    S.user = null;
    S.events = [];
    S.authMode = 'login';
    if (S.socket) {
      S.socket.removeAllListeners();
      S.socket.disconnect();
      S.socket = null;
    }
    toast('Çıkış yapıldı.', 'good');
    if (S.route === 'dash') {
      location.href = '/host';
      return;
    }
    renderAuth();
  }

  // ---------------------------------------------------------------------------
  // Ana sayfa / etkinlik paneli
  // ---------------------------------------------------------------------------

  function eventStatusHtml(ev) {
    if (ev.acceptingResponses === false) return '<span class="pill">⏸ Cevaplar kapalı</span>';
    return '<span class="pill live"><span class="dot"></span> Cevaplara açık</span>';
  }

  function eventRowHtml(ev) {
    const title = ev.title || 'Canlı Oturum';
    const phase = phaseLabel(ev.phase);
    return `<div class="event-row">
      <div class="event-row-head">
        <div style="min-width:0">
          <div class="row wrap" style="gap:8px;align-items:center">
            <b class="event-row-title" title="${esc(title)}">${esc(title)}</b>
            <span class="event-code">${esc(ev.code)}</span>
            ${eventStatusHtml(ev)}
          </div>
          <div class="tiny muted" style="margin-top:5px">
            ${esc(phase)} · ${ev.total || 0} soru · ${ev.participants || 0} katılımcı · ${esc(elapsedLabel(ev.updatedAt || ev.createdAt))}
          </div>
        </div>
      </div>
      <div class="actions" style="margin-top:10px;gap:6px">
        <a class="btn btn-primary btn-sm" href="/h/${esc(ev.code)}">Aç</a>
        <button class="btn btn-ghost btn-sm" type="button" data-action="event-toggle" data-code="${esc(ev.code)}"
          data-next="${ev.acceptingResponses === false ? 'true' : 'false'}">
          ${ev.acceptingResponses === false ? 'Cevaplara aç' : 'Cevapları kapat'}
        </button>
        <button class="btn btn-ghost btn-sm" type="button" data-action="event-code" data-code="${esc(ev.code)}" data-title="${esc(title)}">Kodu değiştir</button>
        <button class="btn btn-ghost btn-sm" type="button" data-action="copy" data-copy="${esc(ev.joinUrl)}">Bağlantıyı kopyala</button>
        <button class="btn btn-quiet btn-sm" type="button" data-action="event-delete" data-code="${esc(ev.code)}" data-title="${esc(title)}">Sil</button>
      </div>
    </div>`;
  }

  // Etkinlik listesini en fazla iki satırda tutar, kalanlar kart içinde kaydırılır.
  // Sol kartla aynı yüksekliğe gerilen panelde kalan boşluk listeye verilir.
  function fitEventList() {
    const list = document.getElementById('event-list');
    if (!list) return;
    const panel = list.closest('.panel');
    const body = list.parentElement;
    const rows = Array.from(list.children);
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    const rowH = rows[0]?.offsetHeight || 0;
    const twoRows = rowH ? rowH + (rows[1] ? rows[1].offsetHeight + gap : 0) : 0;

    list.classList.remove('is-scroll');
    list.removeAttribute('tabindex');
    list.style.maxHeight = twoRows ? `${Math.round(twoRows)}px` : '';

    if (!panel || !body) return;
    const bodyStyle = getComputedStyle(body);
    const padding =
      (parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0);
    const available = Math.floor(body.clientHeight - padding);
    const target = Math.max(twoRows, available);
    if (target) list.style.maxHeight = `${target}px`;

    if (list.scrollHeight > list.clientHeight + 2) {
      list.classList.add('is-scroll');
      list.setAttribute('tabindex', '0');
    }
  }

  function renderHome() {
    const events = S.events || [];
    document.title = 'Canlı Oturum — Yönetici';
    root.innerHTML = `
      <header class="topbar">
        <a class="brand" href="/host"><span class="brand-mark">⚡</span><span class="brand-name">Canlı Oturum</span></a>
        <span class="pill">Yönetici paneli</span>
        <span class="spacer"></span>
        <span class="pill user-pill" title="Giriş yapılan hesap">👤 ${esc(S.user?.username || '')}</span>
        <button class="btn btn-ghost btn-sm" type="button" data-action="logout">Çıkış</button>
        <a class="btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener">Katılımcı ekranı ↗</a>
      </header>

      <main class="home-wrap">
        <div class="stack" style="gap:22px">
          <div class="home-grid">
            <form class="card stack" id="create-form">
              <div>
                <label class="label" for="title-input">Yeni etkinlik başlığı</label>
                <input id="title-input" class="input" name="title" maxlength="100"
                  placeholder="Örn. 8-A Fen Bilimleri Tekrar" autocomplete="off" />
              </div>

              <label class="switch" style="border:0;padding:0">
                <span class="lbl">
                  <b>Örnek sorularla başla</b>
                  <span>Hemen denemek için 5 hazır soru eklenir.</span>
                </span>
                <input type="checkbox" id="demo-toggle" checked />
              </label>

              <p class="err" id="create-err"></p>

              <button class="btn btn-primary btn-lg" type="submit" id="create-btn">
                Etkinlik oluştur
              </button>
              <p class="hint center">Etkinlik hesabına kaydedilir; daha sonra tekrar açabilirsin.</p>
            </form>

            <div class="stack">
              <div class="panel events-panel">
                <div class="panel-head">
                  <span>Etkinliklerim</span>
                  <span class="spacer"></span>
                  <span class="tiny muted">${events.length}</span>
                </div>
                <div class="panel-body tight">
                  ${
                    events.length
                      ? `<div class="stack event-list" id="event-list" style="gap:6px">${events.map(eventRowHtml).join('')}</div>`
                      : `<div class="empty" style="padding:24px 12px">
                          <div class="big">🗂️</div>
                          Henüz etkinlik yok.<br /><span class="tiny">Oluşturduğun etkinlikler burada listelenir.</span>
                        </div>`
                  }
                </div>
              </div>
            </div>
          </div>

          <div class="feature-grid">
            <div class="feature"><div class="ico">🛡️</div><div><b>Kendi sunucunda</b><span>Veriler sende kalır; dışarıya hiçbir şey gönderilmez.</span></div></div>
            <div class="feature"><div class="ico">📱</div><div><b>Telefonla katılım</b><span>QR okut veya kodu gir. Uygulama gerekmez.</span></div></div>
            <div class="feature"><div class="ico">📊</div><div><b>Canlı sonuçlar</b><span>Her cevap anında grafiklere düşer.</span></div></div>
            <div class="feature"><div class="ico">🏆</div><div><b>Quiz & puan tablosu</b><span>Süreli sorular, doğru cevap ve sıralama.</span></div></div>
            <div class="feature"><div class="ico">📥</div><div><b>CSV dışa aktarma</b><span>Tüm cevapları tek dosyada indir.</span></div></div>
          </div>
        </div>
      </main>`;

    const form = document.getElementById('create-form');
    const errEl = document.getElementById('create-err');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errEl.textContent = '';
      const button = document.getElementById('create-btn');
      const title = document.getElementById('title-input').value.trim();
      const demo = document.getElementById('demo-toggle').checked;

      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Oluşturuluyor…';
      try {
        const data = await api('/api/events', {
          method: 'POST',
          body: JSON.stringify({ title, template: demo ? 'demo' : null }),
        });
        location.href = `/h/${data.code}`;
      } catch (error) {
        if (error.status === 401) {
          S.user = null;
          renderAuth('Oturumun sona ermiş. Lütfen yeniden giriş yap.');
          return;
        }
        errEl.textContent = error.message || 'Bir hata oldu.';
        button.disabled = false;
        button.textContent = 'Etkinlik oluştur';
      }
    });

    fitEventList();
  }

  function openChangeCode(code, title) {
    openModal({
      title: 'Etkinlik kodunu değiştir',
      narrow: true,
      body: `
        <div class="stack" style="gap:12px">
          <p class="muted small" style="margin:0"><b>${esc(title || code)}</b> için yeni kod belirle. Eski bağlantılar çalışmayı durdurur.</p>
          <div>
            <label class="label" for="new-code-input">Yeni kod</label>
            <input id="new-code-input" class="input" maxlength="12" autocomplete="off"
              style="text-transform:uppercase;letter-spacing:.14em;font-weight:750" placeholder="Yeni kod (4-12)" />
            <p class="hint" style="margin-top:6px">Boş bırakırsan rastgele yeni bir kod üretilir.</p>
          </div>
          <p class="err" id="new-code-err"></p>
        </div>`,
      footer: `<span class="spacer"></span>
        <button class="btn btn-ghost" type="button" data-close>Vazgeç</button>
        <button class="btn btn-primary" type="button" id="new-code-save">Kodu değiştir</button>`,
      onMount: () => {
        const save = async () => {
          const input = document.getElementById('new-code-input');
          const errEl = document.getElementById('new-code-err');
          const button = document.getElementById('new-code-save');
          const next = normalizeCode(input.value);
          errEl.textContent = '';
          button.disabled = true;
          button.innerHTML = '<span class="spinner"></span> Değiştiriliyor…';
          try {
            const data = await api(`/api/events/${encodeURIComponent(code)}/code`, {
              method: 'POST',
              body: JSON.stringify({ code: next || undefined }),
            });
            const saved = readStorage(`co:host:${code}`, null);
            if (saved) {
              writeStorage(`co:host:${data.code}`, saved);
              removeStorage(`co:host:${code}`);
            }
            closeModal(true);
            toast(`Yeni etkinlik kodu: ${data.code}`, 'good');
            await loadAccountEvents();
            renderHome();
          } catch (error) {
            errEl.textContent = error.message || 'Kod değiştirilemedi.';
            button.disabled = false;
            button.textContent = 'Kodu değiştir';
          }
        };
        document.getElementById('new-code-save').addEventListener('click', save);
        document.getElementById('new-code-input').addEventListener('keydown', (event) => {
          if (event.key === 'Enter') save();
        });
      },
    });
  }

  async function toggleEventResponses(code, next) {
    try {
      await api(`/api/events/${encodeURIComponent(code)}`, {
        method: 'PUT',
        headers: hostHeaders(),
        body: JSON.stringify({ settings: { acceptingResponses: next } }),
      });
      toast(next ? 'Etkinlik cevap almaya açıldı.' : 'Etkinlik cevaplara kapatıldı.', 'good');
      await loadAccountEvents();
      renderHome();
    } catch (error) {
      toast(error.message || 'Durum değiştirilemedi.', 'bad');
    }
  }

  async function deleteAccountEvent(code, title) {
    const ok = await confirmDialog({
      title: 'Etkinlik silinsin mi?',
      message: `"${title || code}" etkinliği ve tüm cevaplar kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
      confirmText: 'Kalıcı olarak sil',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/events/${encodeURIComponent(code)}`, {
        method: 'DELETE',
        headers: hostHeaders(),
      });
      toast('Etkinlik silindi.', 'good');
      await loadAccountEvents();
      renderHome();
    } catch (error) {
      toast(error.message || 'Etkinlik silinemedi.', 'bad');
    }
  }
  // Panel iskeleti
  // ---------------------------------------------------------------------------

  function renderDash() {
    const st = S.state;
    if (!st) return renderLoading();

    root.innerHTML = `
      <header class="topbar">
        <a class="brand" href="/host" title="Etkinlikler"><span class="brand-mark">⚡</span><span class="brand-name">Canlı Oturum</span></a>
        <span class="sep"></span>
        <span class="event-name" title="${esc(st.title)}">${esc(st.title)}</span>
        <span class="event-code">${esc(st.code)}</span>
        <span class="spacer"></span>
        <span class="pill live" title="Katılımcı sayısı"><span class="dot" id="conn-dot"></span><span data-live-participants>${st.participants.length}</span> katılımcı</span>
        <span class="pill" id="conn-pill"><span id="conn-label">${S.connected ? 'Canlı' : 'Bağlantı yok'}</span></span>
        ${S.user ? `<span class="pill user-pill" title="Giriş yapılan hesap">👤 ${esc(S.user.username)}</span>` : ''}
        <button class="icon-btn" data-action="qr" title="Katılım QR kodu">▦</button>
        <button class="icon-btn" data-action="export" title="Dışa aktar">⤓</button>
        <button class="btn btn-ghost btn-sm" data-action="settings" title="Oturum ayarları">⚙ Ayarlar</button>
        <a class="btn btn-ghost btn-sm" href="/host">Etkinlikler</a>
        ${S.user ? '<button class="btn btn-ghost btn-sm" data-action="logout">Çıkış</button>' : ''}
      </header>

      <main class="host-main">
        <section class="stage" id="stage">${stageHtml(st)}</section>
        <aside class="side">
          <div class="panel">
            <div class="panel-head">
              <span>Oturum</span>
              <span class="spacer"></span>
              <span class="pill phase">${phaseLabel(st.phase)}</span>
            </div>
            <div class="panel-body stack" style="gap:10px">
              <div class="actions" style="gap:8px">
                <button class="btn btn-ghost btn-sm" data-action="questions" title="Soruları görüntüle">
                  📋 Sorular <span class="count-chip">${st.total}</span>
                </button>
                <button class="btn btn-ghost btn-sm" data-action="participants" title="Katılımcıları görüntüle">
                  👥 Katılımcılar <span class="count-chip" data-live-participants>${st.participants.length}</span>
                </button>
              </div>
              <div class="join-link">
                <code style="font-size:12px">${esc(joinUrl())}</code>
                <button class="icon-btn" style="width:34px;height:34px" data-action="copy" data-copy="${esc(joinUrl())}" title="Bağlantıyı kopyala">⧉</button>
              </div>
              <div class="actions" style="margin-top:2px">
                ${
                  st.phase === 'ended'
                    ? `<button class="btn btn-ghost btn-sm" data-action="resetLobby">Başlangıca dön</button>
                       <button class="btn btn-ghost btn-sm" data-action="restart">Yeni oturum</button>`
                    : ''
                }
                <button class="btn btn-quiet btn-sm" data-action="delete" title="Etkinliği sil">Sil</button>
              </div>
            </div>
          </div>
        </aside>
      </main>

      <footer class="host-foot">
        Canlı Oturum · kendi sunucunda · <span data-live-participants>${st.participants.length}</span> katılımcı
      </footer>`;

    updateLive();
  }

  function phaseLabel(phase) {
    return (
      {
        lobby: 'Beklemede',
        live: 'Canlı',
        question: 'Canlı',
        results: 'Canlı',
        ended: 'Bitti',
      }[phase] || phase
    );
  }

  function switchHtml(key, label, hint, checked) {
    return `<label class="switch">
      <span class="lbl"><b>${esc(label)}</b><span>${esc(hint)}</span></span>
      <input type="checkbox" data-setting="${esc(key)}" ${checked ? 'checked' : ''} />
    </label>`;
  }

  function questionsPanel(st) {
    if (!st.questions.length) {
      return `<div class="empty" style="padding:20px 10px">
        Henüz soru yok.
        ${st.phase === 'lobby' ? '<div style="margin-top:10px"><button class="btn btn-ghost btn-sm" data-action="edit">Soru ekle</button></div>' : ''}
      </div>`;
    }
    return `<div class="q-list">
      ${st.questions
        .map(
          (q, i) => `
        <button class="q-item ${i === st.current ? 'active' : ''}" data-action="q-open" data-index="${i}" title="${esc(q.prompt)}">
          <span class="n">${i + 1}</span>
          <span class="t">${esc(q.prompt)}</span>
          <span class="c" data-qcount="${esc(q.id)}">${st.answeredByQuestion?.[q.id] || 0}</span>
        </button>`,
        )
        .join('')}
    </div>`;
  }

  function participantsSig(st) {
    return JSON.stringify(st.participants.map((p) => [p.id, p.name, p.score, p.online, p.progress, p.done]));
  }

  function participantsHtml(st) {
    if (!st.participants.length) {
      return `<div class="empty" style="padding:20px 10px">
        <div class="big">👥</div>
        Henüz kimse katılmadı.<br /><span class="tiny">QR kodu veya bağlantıyı paylaş.</span>
      </div>`;
    }
    const sorted = [...st.participants]
      .sort((a, b) => (b.score || 0) - (a.score || 0) || a.joinedAt - b.joinedAt)
      .slice(0, 200);
    return `<div class="participants">
      ${sorted
        .map(
          (p) => `<div class="p-row">
            <span class="st ${p.online ? 'on' : ''}" title="${p.online ? 'Çevrimiçi' : 'Çevrimdışı'}"></span>
            <span class="avatar" style="width:22px;height:22px;font-size:10px">${esc(initials(p.name))}</span>
            <span class="nm">${esc(p.name)}</span>
            <span class="sc" title="${p.done ? 'Tüm soruları bitirdi' : 'Şu anki soru'}">${p.done ? '✓ bitti' : `${p.progress}/${st.total}`}</span>
            ${p.score ? `<span class="sc">${p.score} p</span>` : ''}
          </div>`,
        )
        .join('')}
    </div>
    ${st.participants.length > 200 ? `<p class="hint" style="padding:8px 8px 0">+${st.participants.length - 200} kişi daha</p>` : ''}`;
  }

  // ---------------------------------------------------------------------------
  // Sahne (stage)
  // ---------------------------------------------------------------------------

  function stageHtml(st) {
    const closed =
      st.settings?.acceptingResponses === false
        ? `<div class="banner bad" style="margin-bottom:14px">
            <span style="font-size:18px">⏸</span>
            <div><b>Cevaplar kapalı</b><div class="small" style="opacity:.85">Katılımcılar şu anda cevap gönderemiyor. Üstteki “Ayarlar” düğmesinden “Cevaplara açık” anahtarını kullanabilirsin.</div></div>
          </div>`
        : '';
    const stage = st.phase === 'lobby' ? lobbyStage(st) : questionStage(st);
    return `${closed}${stage}`;
  }

  function lobbyStage(st) {
    const total = st.total || 0;
    const url = joinUrl();
    return `
      <div class="card">
        <div class="join-grid">
          <div class="qr-box">
            <img src="/api/events/${encodeURIComponent(st.code)}/qr.png?size=720" alt="Katılım QR kodu" width="232" height="232" />
          </div>
          <div class="join-info stack" style="gap:14px">
            <div>
              <div class="q-index">Katılım kodu</div>
              <div class="code-big" style="margin-top:4px">${esc(st.code)}</div>
            </div>
            <div class="join-link">
              <code>${esc(url)}</code>
              <button class="icon-btn" style="width:38px;height:38px" data-action="copy" data-copy="${esc(url)}" title="Bağlantıyı kopyala">⧉</button>
            </div>
            <div class="row wrap">
              <span class="pill live"><span class="dot"></span><span data-live-participants>${st.participants.length}</span> katılımcı</span>
              <span class="pill">${total} soru</span>
              <span class="pill"><span data-live-online>${st.online || 0}</span> çevrimiçi</span>
            </div>
            <div class="actions">
              <button class="btn btn-success" data-action="start" ${total === 0 ? 'disabled' : ''}>
                ▶ Oturumu başlat
              </button>
              <button class="btn btn-ghost" data-action="edit">Soruları düzenle</button>
            </div>
            ${
              total === 0
                ? '<p class="warn small">Başlamak için en az bir soru ekle.</p>'
                : '<p class="hint">Telefon kamerasıyla QR kodu okutun veya adresi açıp kodu girin.</p>'
            }
          </div>
        </div>
      </div>

      <div class="feature-grid">
        <div class="feature"><div class="ico">1️⃣</div><div><b>Katılımcılar bağlanır</b><span>QR veya 6 haneli kod ile, uygulama gerekmez.</span></div></div>
        <div class="feature"><div class="ico">2️⃣</div><div><b>Oturumu başlatırsın</b><span>Katılımcılar soruları kendi hızında, belirlenen süreyle yanıtlar.</span></div></div>
        <div class="feature"><div class="ico">3️⃣</div><div><b>Sonuçlar canlı akar</b><span>Grafikler, kelime bulutu ve puan tablosu.</span></div></div>
      </div>`;
  }

  function questionStage(st) {
    const q = st.questions[st.current] || null;
    if (!q) {
      return `<div class="card empty">Soru bulunamadı. <button class="btn btn-ghost btn-sm" data-action="resetLobby">Başlangıca dön</button></div>`;
    }
    const answered = st.answeredByQuestion?.[q.id] || 0;
    const totalParticipants = st.participants.length;
    const finished = st.finished || 0;

    let actions = '';
    if (st.phase === 'ended') {
      actions = `<div class="actions">
        <button class="btn btn-primary" data-action="resetLobby">↩ Başlangıca dön</button>
        <button class="btn btn-ghost" data-action="restart">Yeni oturum (katılımcıları sıfırla)</button>
      </div>`;
    } else {
      actions = `<div class="actions">
        <button class="btn btn-ghost btn-sm" data-action="q-open" data-index="${Math.max(0, st.current - 1)}" ${st.current <= 0 ? 'disabled' : ''}>← Önceki</button>
        <button class="btn btn-ghost btn-sm" data-action="q-open" data-index="${Math.min(st.total - 1, st.current + 1)}" ${st.current >= st.total - 1 ? 'disabled' : ''}>Sonraki →</button>
        <span class="spacer"></span>
        <button class="btn btn-quiet btn-sm" data-action="resetAnswers">Cevapları sıfırla</button>
        <button class="btn btn-danger btn-sm" data-action="end">Oturumu kapat</button>
      </div>`;
    }

    return `
      <div class="card">
        <div class="row wrap" style="justify-content:space-between;gap:8px">
          <div class="row wrap" style="gap:8px">
            <span class="pill phase">Soru ${st.current + 1} / ${st.total}</span>
            <span class="type-badge">${esc(TYPE_LABELS[q.type] || q.type)}</span>
            ${q.type === 'quiz' ? `<span class="type-badge">${q.points} puan</span>` : ''}
            ${q.timeLimit ? `<span class="type-badge">${q.timeLimit} sn / kişi</span>` : '<span class="type-badge">süresiz</span>'}
          </div>
          <div class="row wrap" style="gap:8px">
            <span class="pill live">
              <span class="dot" style="background:var(--green)"></span>
              <span data-live-answered>${answered}</span> / <span data-live-participants>${totalParticipants}</span> cevap
            </span>
            <span class="pill"><span data-live-finished>${finished}</span> bitirdi</span>
          </div>
        </div>

        <h1 class="q-title" style="margin-top:16px">${esc(q.prompt)}</h1>

        <div id="stats-root">${statsHtml(st)}</div>
      </div>

      ${actions}

      <div class="note">
        Katılımcılar <b>kendi hızlarında</b> ilerler; süre her katılımcının ekranında başlar.
        Cevaplar geldikçe buradaki sonuçlar canlı güncellenir. Sorulara tıklayarak tek tek inceleyebilirsin.
      </div>`;
  }

  function statsHtml(st) {
    const q = st.questions[st.current];
    const stats = st.stats;
    if (!q || !stats) {
      return `<div class="empty" style="padding:26px 0 14px"><div class="big">⏳</div>Cevaplar bekleniyor…</div>`;
    }

    if (stats.kind === 'choice') {
      const total = stats.total || 0;
      const max = Math.max(1, ...stats.options.map((o) => o.count));
      const rows = stats.options
        .map((o) => {
          const pct = total ? Math.round((o.count / total) * 100) : 0;
          const correct = !!q.correctId && q.correctId === o.id;
          return `<div class="res-row ${correct ? 'correct' : ''}">
            <div class="res-top">
              <span class="txt">${esc(o.text)} ${correct ? '<span class="pill" style="padding:1px 6px;font-size:10px;color:#bff7e8;border-color:rgba(52,211,153,.4);background:rgba(16,185,129,.15)">doğru</span>' : ''}</span>
              <span class="num">${o.count} kişi · %${pct}</span>
            </div>
            <div class="res-bar"><span class="res-fill" style="width:${total ? Math.max((o.count / max) * 100, o.count ? 3 : 0) : 0}%"></span></div>
          </div>`;
        })
        .join('');
      return `<div class="stack" style="margin-top:18px;gap:10px">
        <div class="res">${rows}</div>
        <div class="kv"><span>${total} cevap</span><span>·</span><span>${stats.total ? Math.round((stats.total / Math.max(1, st.participants.length)) * 100) : 0}% katılım</span></div>
      </div>`;
    }

    if (stats.kind === 'rating') {
      const total = stats.total || 0;
      const max = Math.max(1, ...stats.distribution.map((d) => d.count));
      return `<div class="stack" style="margin-top:14px;gap:8px">
        <div class="avg"><b>${stats.avg}</b><span>/ 5 · ${total} cevap</span></div>
        <div class="res">
          ${stats.distribution
            .map((d) => {
              const pct = total ? Math.round((d.count / total) * 100) : 0;
              return `<div class="res-row">
                <div class="res-top"><span class="txt">${'★'.repeat(d.value)}${'☆'.repeat(5 - d.value)}</span>
                <span class="num">${d.count} · %${pct}</span></div>
                <div class="res-bar"><span class="res-fill" style="width:${total ? Math.max((d.count / max) * 100, d.count ? 3 : 0) : 0}%"></span></div>
              </div>`;
            })
            .join('')}
        </div>
      </div>`;
    }

    if (stats.kind === 'wordcloud') {
      if (!stats.words.length) {
        return `<div class="empty" style="padding:26px 0 14px"><div class="big">☁️</div>Kelime bekleniyor…</div>`;
      }
      const max = Math.max(1, ...stats.words.map((w) => w.count));
      const colors = ['#c7c0ff', '#8fb4ff', '#67e8f9', '#a7f3d0', '#fde68a', '#fca5a5', '#f0abfc', '#93c5fd'];
      return `<div class="cloud" style="margin-top:10px">
        ${stats.words
          .map((w, i) => {
            const ratio = w.count / max;
            const size = 15 + Math.round(ratio * 30);
            return `<span style="font-size:${size}px;color:${colors[i % colors.length]};opacity:${0.65 + ratio * 0.35}" title="${w.count} kez">${esc(w.text)}</span>`;
          })
          .join('')}
      </div>
      <div class="kv center" style="justify-content:center"><span>${stats.total} cevap · ${stats.words.length} farklı ifade</span></div>`;
    }

    if (!stats.items.length) {
      return `<div class="empty" style="padding:26px 0 14px"><div class="big">✍️</div>Cevaplar bekleniyor…</div>`;
    }
    return `<div class="stack" style="margin-top:16px;gap:8px">
      <div class="open-list" style="max-height:38dvh">
        ${stats.items
          .map(
            (item) =>
              `<div class="open-item"><span>${esc(item.text)}</span>${item.count > 1 ? `<span class="count">×${item.count}</span>` : ''}</div>`,
          )
          .join('')}
      </div>
      <div class="kv"><span>${stats.total} cevap · ${stats.unique || stats.items.length} farklı yanıt</span></div>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Canlı güncellemeler
  // ---------------------------------------------------------------------------

  function updateLive() {
    const st = S.state;
    if (!st) return;

    document.querySelectorAll('[data-live-participants]').forEach((el) => {
      el.textContent = String(st.participants.length);
    });
    document.querySelectorAll('[data-live-online]').forEach((el) => {
      el.textContent = String(st.online || 0);
    });

    const currentQ = st.questions[st.current];
    const answeredCurrent = currentQ ? st.answeredByQuestion?.[currentQ.id] || 0 : 0;
    document.querySelectorAll('[data-live-answered]').forEach((el) => {
      el.textContent = String(answeredCurrent);
    });
    document.querySelectorAll('[data-qcount]').forEach((el) => {
      el.textContent = String(st.answeredByQuestion?.[el.dataset.qcount] || 0);
    });
    document.querySelectorAll('[data-live-finished]').forEach((el) => {
      el.textContent = String(st.finished || 0);
    });

    const statsEl = document.getElementById('stats-root');
    if (statsEl) {
      const html = statsHtml(st);
      if (html !== S.lastStatsHtml) {
        S.lastStatsHtml = html;
        statsEl.innerHTML = html;
      }
    }

    const qListEl = document.getElementById('modal-q-list');
    if (qListEl) {
      const html = questionsPanel(st);
      if (html !== S.qModalSig) {
        S.qModalSig = html;
        qListEl.innerHTML = html;
      }
    }

    const pListEl = document.getElementById('modal-p-list');
    if (pListEl) {
      const sig = participantsSig(st);
      if (sig !== S.pModalSig) {
        S.pModalSig = sig;
        pListEl.innerHTML = participantsHtml(st);
      }
    }

    document.querySelectorAll('[data-setting]').forEach((el) => {
      el.checked = !!st.settings?.[el.dataset.setting];
    });

    updateConn();
  }

  // ---------------------------------------------------------------------------
  // Modallar: QR, dışa aktarma, başlık, silme
  // ---------------------------------------------------------------------------

  function openQuestionsModal() {
    const st = S.state;
    if (!st) return;
    const list = questionsPanel(st);
    openModal({
      title: 'Sorular',
      body: `
        <div class="stack" style="gap:12px">
          <p class="hint" style="margin:0">Bir soruya tıklayarak kendi ekranında açabilirsin. Katılımcılar kendi hızında ilerlemeye devam eder.</p>
          <div id="modal-q-list">${list}</div>
        </div>`,
      footer: `<span class="spacer"></span>
        ${st.phase === 'lobby' ? '<button class="btn btn-ghost" type="button" data-action="edit">Soruları düzenle</button>' : ''}
        <button class="btn btn-primary" type="button" data-close>Kapat</button>`,
    });
    S.qModalSig = list;
  }

  function openParticipantsModal() {
    const st = S.state;
    if (!st) return;
    const list = participantsHtml(st);
    openModal({
      title: 'Katılımcılar',
      body: `
        <div class="stack" style="gap:10px">
          <div class="row wrap" style="gap:8px">
            <span class="pill live"><span class="dot"></span><span data-live-participants>${st.participants.length}</span> katılımcı</span>
            <span class="pill"><span data-live-online>${st.online || 0}</span> çevrimiçi</span>
            <span class="pill"><span data-live-finished>${st.finished || 0}</span> bitirdi</span>
          </div>
          <div id="modal-p-list">${list}</div>
        </div>`,
      footer: '<span class="spacer"></span><button class="btn btn-primary" type="button" data-close>Kapat</button>',
    });
    S.pModalSig = participantsSig(st);
  }

  function openQr() {
    const url = joinUrl();
    openModal({
      title: 'Katılım bağlantısı',
      narrow: true,
      body: `
        <div class="stack" style="align-items:center;gap:14px">
          <div class="qr-box" style="width:min(320px, 78vw)">
            <img src="/api/events/${encodeURIComponent(S.code)}/qr.png?size=720" alt="Katılım QR kodu" />
          </div>
          <div class="code-big" style="font-size:clamp(32px,7vw,46px)">${esc(S.code)}</div>
          <div class="join-link" style="width:100%">
            <code style="flex:1">${esc(url)}</code>
            <button class="btn btn-ghost btn-sm" type="button" data-action="copy" data-copy="${esc(url)}">Kopyala</button>
          </div>
          <p class="hint center">Telefon kamerasıyla QR kodu okutabilir veya adrese girip kodu yazabilirler.</p>
        </div>`,
      footer: `<span class="spacer"></span>
        <a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener">Katılımcı ekranını aç ↗</a>`,
    });
  }

  function openExport() {
    const st = S.state;
    const base = `/api/events/${encodeURIComponent(S.code)}/export.csv`;
    const totalAnswers = Object.values(st.answeredByQuestion || {}).reduce((a, b) => a + b, 0);
    openModal({
      title: 'Dışa aktar',
      narrow: true,
      body: `
        <div class="stack" style="gap:12px">
          <div class="big-stats">
            <div class="big-stat accent"><b>${st.participants.length}</b><span>katılımcı</span></div>
            <div class="big-stat"><b>${totalAnswers}</b><span>cevap</span></div>
            <div class="big-stat"><b>${st.total}</b><span>soru</span></div>
          </div>
          <div class="feature">
            <div class="ico">📋</div>
            <div><b>Katılımcı cevapları</b><span>Her katılımcı için puan ve tüm cevaplar (CSV).</span></div>
          </div>
          <a class="btn btn-primary" href="${base}?mode=participants" download>Katılımcı cevaplarını indir</a>
          <div class="feature">
            <div class="ico">📈</div>
            <div><b>Özet rapor</b><span>Soru bazında seçenek dağılımı, yüzdeler ve doğru cevaplar.</span></div>
          </div>
          <a class="btn btn-ghost" href="${base}?mode=summary" download>Özet raporu indir</a>
          <p class="hint">Dosyalar Excel / Google E-Tablolar ile açılabilir. Türkçe karakterler için UTF-8 BOM eklenmiştir.</p>
        </div>`,
    });
  }

  function openSettings() {
    const st = S.state;
    if (!st) return;
    openModal({
      title: 'Ayarlar',
      body: `
        <div class="stack" style="gap:6px">
          ${switchHtml('acceptingResponses', 'Cevaplara açık', 'Kapatırsan yeni katılım ve cevaplar durur.', st.settings.acceptingResponses !== false)}
          ${switchHtml('liveResults', 'Canlı sonuçlar', 'Katılımcılar cevap vermeden önce de sonuçları görsün.', st.settings.liveResults)}
          ${switchHtml('showLeaderboard', 'Puan tablosu', 'Sonuç ekranında ilk 5 gösterilsin.', st.settings.showLeaderboard)}
          ${switchHtml('joinClosed', 'Katılımı kapat', 'Yeni katılımcı alınmasın.', st.settings.joinClosed)}
          <div style="border-top:1px solid var(--line);margin:10px 0 4px"></div>
          <div class="actions">
            <button class="btn btn-ghost btn-sm" type="button" data-action="rename">Başlığı düzenle</button>
            <button class="btn btn-ghost btn-sm" type="button" data-action="change-code">Kodu değiştir</button>
            <button class="btn btn-ghost btn-sm" type="button" data-action="export">CSV indir</button>
          </div>
        </div>`,
      footer: '<button class="btn btn-primary" type="button" data-close>Kapat</button>',
    });
  }

  function openRename() {
    openModal({
      title: 'Etkinlik başlığı',
      narrow: true,
      body: `
        <div>
          <label class="label" for="rename-input">Başlık</label>
          <input id="rename-input" class="input" maxlength="100" value="${esc(S.state.title)}" />
        </div>`,
      footer: `<span class="spacer"></span>
        <button class="btn btn-ghost" type="button" data-close>Vazgeç</button>
        <button class="btn btn-primary" type="button" id="rename-save">Kaydet</button>`,
      onMount: () => {
        const save = async () => {
          const input = document.getElementById('rename-input');
          const value = input.value.trim();
          if (!value) return toast('Başlık boş olamaz.', 'bad');
          const button = document.getElementById('rename-save');
          button.disabled = true;
          button.innerHTML = '<span class="spinner"></span>';
          const ok = await updateTitle(value);
          if (ok) closeModal(true);
          else {
            button.disabled = false;
            button.textContent = 'Kaydet';
          }
        };
        document.getElementById('rename-save').addEventListener('click', save);
        document.getElementById('rename-input').addEventListener('keydown', (event) => {
          if (event.key === 'Enter') save();
        });
      },
    });
  }

  async function deleteCurrentEvent() {
    const ok = await confirmDialog({
      title: 'Etkinlik silinsin mi?',
      message: `"${S.state?.title || S.code}" etkinliği ve tüm cevaplar kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
      confirmText: 'Kalıcı olarak sil',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/events/${encodeURIComponent(S.code)}`, {
        method: 'DELETE',
        headers: hostHeaders(),
      });
      removeEventLocal(S.code);
      toast('Etkinlik silindi.', 'good');
      setTimeout(() => {
        location.href = '/host';
      }, 700);
    } catch (err) {
      toast(err.message || 'Silinemedi.', 'bad');
    }
  }

  // ---------------------------------------------------------------------------
  // Soru editörü
  // ---------------------------------------------------------------------------

  const SHORT_TYPES = {
    mc: 'Çoktan seçmeli',
    quiz: 'Quiz',
    truefalse: 'Doğru / Yanlış',
    open: 'Açık uçlu',
    wordcloud: 'Kelime bulutu',
    rating: 'Puanlama',
  };

  function blankQuestion(type) {
    const q = {
      id: `q_${Math.random().toString(36).slice(2, 10)}`,
      type,
      prompt: '',
      options: [],
      correctId: null,
      multi: false,
      timeLimit: 0,
      points: 1000,
      maxLength: 300,
      note: '',
    };
    if (type === 'mc' || type === 'quiz') {
      q.options = [
        { id: 'o1', text: 'Seçenek 1' },
        { id: 'o2', text: 'Seçenek 2' },
        { id: 'o3', text: 'Seçenek 3' },
      ];
      if (type === 'quiz') q.correctId = 'o1';
    }
    if (type === 'truefalse') {
      q.options = [
        { id: 'true', text: 'Doğru' },
        { id: 'false', text: 'Yanlış' },
      ];
      q.correctId = 'true';
    }
    if (type === 'wordcloud') q.maxLength = 40;
    return q;
  }

  function openEditor(focusIndex = null) {
    const st = S.state;
    if (!st || st.phase !== 'lobby') {
      return toast('Sorular yalnızca oturum başlamadan önce düzenlenebilir.', 'bad');
    }
    S.editor = { questions: structuredClone(st.questions || []), dirty: false };
    renderEditor(focusIndex);
  }

  function markDirty() {
    if (!S.editor) return;
    S.editor.dirty = true;
    const status = document.getElementById('editor-status');
    if (status) status.innerHTML = '<span class="warn">Kaydedilmemiş değişiklikler var</span>';
  }

  function renderEditor(focusIndex = null, scrollToEnd = false) {
    if (!S.editor) return;
    const list = S.editor.questions;
    const bodyEl = modalEl.querySelector('.modal-body');
    const scroll = scrollToEnd ? Infinity : bodyEl ? bodyEl.scrollTop : 0;

    openModal({
      title: `Sorular · ${list.length}`,
      wide: true,
      body: `
        <div class="stack" style="gap:14px">
          <p class="hint">Değişiklikler <b>Kaydet</b> ile yayınlanır. Oturum başladıktan sonra sorular kilitlenir.</p>
          ${
            list.length
              ? `<div class="editor-list">${list.map((q, i) => questionEditorHtml(q, i)).join('')}</div>`
              : `<div class="empty" style="border:1px dashed var(--line-strong);border-radius:16px">
                  <div class="big">📝</div>
                  Henüz soru yok. Aşağıdan bir soru türü ekle.
                </div>`
          }
          <div class="row wrap" style="gap:6px;padding-top:4px">
            ${Object.entries(SHORT_TYPES)
              .map(
                ([type, label]) =>
                  `<button class="btn btn-ghost btn-sm" type="button" data-act="add" data-type="${type}">＋ ${esc(label)}</button>`,
              )
              .join('')}
          </div>
        </div>`,
      footer: `
        <span class="hint" id="editor-status">${S.editor.dirty ? '<span class="warn">Kaydedilmemiş değişiklikler var</span>' : 'Tüm değişiklikler kayıtlı'}</span>
        <span class="spacer"></span>
        <button class="btn btn-ghost" type="button" id="editor-cancel">Vazgeç</button>
        <button class="btn btn-primary" type="button" id="editor-save">Kaydet</button>`,
      onMount: () => {
        const newBody = modalEl.querySelector('.modal-body');
        if (newBody) {
          if (scroll === Infinity) newBody.scrollTop = newBody.scrollHeight;
          else newBody.scrollTop = scroll;
        }
        if (focusIndex !== null) {
          const target = modalEl.querySelector(`.editor-card[data-qcard="${focusIndex}"] textarea`);
          if (target) {
            target.focus();
            target.scrollIntoView({ block: 'center' });
          }
        }
        document.getElementById('editor-cancel').addEventListener('click', () => closeModal());
        document.getElementById('editor-save').addEventListener('click', saveEditor);
      },
    });

    // Scroll'u yeniden uygula (openModal odaklaması sonrası)
    requestAnimationFrame(() => {
      const b = modalEl.querySelector('.modal-body');
      if (!b) return;
      if (scroll === Infinity) b.scrollTop = b.scrollHeight;
      else b.scrollTop = scroll;
    });

    updatePreview();
    setPreviewButtonState();
  }

  function questionEditorHtml(q, i) {
    const isChoice = q.type === 'mc' || q.type === 'quiz';
    const isTF = q.type === 'truefalse';
    const optionsBlock = isChoice
      ? `<div class="stack" style="gap:6px">
          ${
            q.type === 'mc'
              ? `<label class="switch" style="border:0;padding:0;margin-bottom:2px">
                  <span class="lbl"><b>Çoktan seçmeli oylama</b><span>Katılımcı birden fazla seçenek işaretleyebilsin.</span></span>
                  <input type="checkbox" data-act="multi" data-i="${i}" ${q.multi ? 'checked' : ''} />
                </label>`
              : ''
          }
          <span class="label" style="margin:0">Seçenekler ${q.type === 'quiz' ? '· doğru cevabı yeşil ile işaretle' : ''}</span>
          ${q.options
            .map(
              (o) => `<div class="opt-edit">
                ${
                  q.type === 'quiz'
                    ? `<button type="button" class="pick ${q.correctId === o.id ? 'on' : ''}" data-act="correct" data-i="${i}" data-opt="${esc(o.id)}" title="Doğru cevap" aria-label="Doğru cevap olarak işaretle">✓</button>`
                    : '<span class="handle">•</span>'
                }
                <input class="input" data-field="opt" data-i="${i}" data-optid="${esc(o.id)}" value="${esc(o.text)}"
                  maxlength="100" placeholder="Seçenek metni" aria-label="Seçenek ${i + 1}" />
                <button type="button" class="icon-btn" style="width:34px;height:34px;font-size:13px"
                  data-act="opt-del" data-i="${i}" data-opt="${esc(o.id)}" title="Seçeneği sil"
                  ${q.options.length <= 2 ? 'disabled' : ''}>✕</button>
              </div>`,
            )
            .join('')}
          <button type="button" class="btn btn-ghost btn-sm" data-act="opt-add" data-i="${i}"
            ${q.options.length >= 10 ? 'disabled' : ''} style="align-self:flex-start">＋ Seçenek ekle</button>
        </div>`
      : isTF
        ? `<div class="row wrap">
            <span class="label" style="margin:0">Doğru cevap:</span>
            <button type="button" class="btn btn-sm ${q.correctId === 'true' ? 'btn-success' : 'btn-ghost'}"
              data-act="correct" data-i="${i}" data-opt="true">Doğru</button>
            <button type="button" class="btn btn-sm ${q.correctId === 'false' ? 'btn-success' : 'btn-ghost'}"
              data-act="correct" data-i="${i}" data-opt="false">Yanlış</button>
          </div>`
        : '';

    return `
      <div class="editor-card" data-qcard="${i}">
        <div class="editor-card-head">
          <span class="idx">${i + 1}</span>
          <select class="input" data-act="type" data-i="${i}" aria-label="Soru türü">
            ${Object.entries(TYPE_LABELS)
              .map(
                ([value, label]) =>
                  `<option value="${value}" ${q.type === value ? 'selected' : ''}>${esc(label)}</option>`,
              )
              .join('')}
          </select>
          <span class="spacer"></span>
          <button type="button" class="icon-btn" data-act="up" data-i="${i}" title="Yukarı taşı" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="icon-btn" data-act="down" data-i="${i}" title="Aşağı taşı" ${i === S.editor.questions.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="icon-btn" data-act="copy" data-i="${i}" title="Kopyala">⧉</button>
          <button type="button" class="icon-btn ${S.previewIndex === i ? 'active' : ''}" data-act="preview" data-i="${i}"
            title="Katılımcı önizlemesi" aria-label="Katılımcı önizlemesini göster" aria-pressed="${S.previewIndex === i}">👁</button>
          <button type="button" class="icon-btn" data-act="del" data-i="${i}" title="Soruyu sil">🗑</button>
        </div>

        <textarea class="input" rows="2" maxlength="240" data-field="prompt" data-i="${i}"
          placeholder="Soru metnini yaz…" aria-label="Soru metni">${esc(q.prompt)}</textarea>

        ${optionsBlock}

        <div class="editor-fields">
          <div>
            <label class="label">Süre (saniye, 0 = süresiz)</label>
            <input class="input" type="number" min="0" max="900" step="5" data-field="timeLimit" data-i="${i}"
              value="${q.timeLimit || 0}" inputmode="numeric" />
          </div>
          ${
            q.type === 'quiz'
              ? `<div>
                  <label class="label">Doğru cevap puanı</label>
                  <input class="input" type="number" min="100" max="10000" step="100" data-field="points" data-i="${i}"
                    value="${q.points || 1000}" inputmode="numeric" />
                </div>`
              : q.type === 'open' || q.type === 'wordcloud'
                ? `<div>
                    <label class="label">Maksimum karakter</label>
                    <input class="input" type="number" min="${q.type === 'open' ? 40 : 10}" max="${q.type === 'open' ? 1000 : 80}"
                      data-field="maxLength" data-i="${i}" value="${q.maxLength || (q.type === 'open' ? 300 : 40)}" inputmode="numeric" />
                  </div>`
                : ''
          }
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Katılımcı önizlemesi
  // ---------------------------------------------------------------------------

  const PREVIEW_TYPE_LABELS = {
    mc: 'Oylama',
    quiz: 'Quiz',
    truefalse: 'Doğru / Yanlış',
    open: 'Açık uçlu',
    wordcloud: 'Kelime bulutu',
    rating: 'Puanlama',
  };
  const PREVIEW_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

  function closePreview() {
    const panel = document.getElementById('q-preview');
    if (panel) panel.remove();
    modalEl.classList.remove('preview-open');
  }

  function setPreviewButtonState() {
    modalEl.querySelectorAll('[data-act="preview"]').forEach((btn) => {
      const on = Number(btn.dataset.i) === S.previewIndex;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }

  function openPreview(index) {
    if (!S.editor) return;
    S.previewIndex = index;
    let panel = document.getElementById('q-preview');
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'q-preview';
      panel.className = 'preview-panel';
      panel.setAttribute('aria-label', 'Katılımcı önizlemesi');
      panel.innerHTML = `
        <div class="preview-head">
          <span class="preview-live"><i></i> Canlı önizleme</span>
          <span class="spacer"></span>
          <button class="icon-btn" type="button" data-preview-close aria-label="Önizlemeyi kapat" title="Önizlemeyi kapat">✕</button>
        </div>
        <div class="preview-note">Katılımcının telefonunda böyle görünecek · kaydedilmemiş değişiklikler dahil</div>
        <div class="preview-body"><div class="player" id="preview-player"></div></div>`;
      document.body.appendChild(panel);
      panel.querySelector('[data-preview-close]').addEventListener('click', () => {
        S.previewIndex = null;
        closePreview();
        setPreviewButtonState();
      });
    }
    modalEl.classList.add('preview-open');
    updatePreview();
    setPreviewButtonState();
    const body = panel.querySelector('.preview-body');
    if (body) body.scrollTop = 0;
  }

  function participantPreviewHtml(q, index) {
    const total = S.editor?.questions.length || 1;
    const title = S.state?.title || 'Canlı Oturum';
    const multi = q.type === 'mc' && !!q.multi;
    const options = Array.isArray(q.options) ? q.options : [];
    let body = '';

    if (q.type === 'mc' || q.type === 'quiz' || q.type === 'truefalse') {
      body = `<div class="options" role="${multi ? 'group' : 'radiogroup'}" aria-label="Seçenekler">
        ${options
          .map(
            (o, i) => `<button type="button" class="opt" tabindex="-1">
              <span class="key">${PREVIEW_LETTERS[i] || i + 1}</span>
              <span class="txt">${esc(o.text || `Seçenek ${i + 1}`)}</span>
            </button>`,
          )
          .join('')}
        ${options.length ? '' : '<p class="hint">Henüz seçenek eklenmedi.</p>'}
      </div>
      <div class="submit-bar">
        <button class="btn btn-primary btn-lg" type="button" tabindex="-1" disabled>${multi ? 'Cevapları gönder' : 'Cevabı gönder'}</button>
        <p class="hint center">${multi ? 'Birden fazla seçenek işaretleyebilirsin.' : 'Bir seçenek seçtikten sonra gönder.'}</p>
      </div>`;
    } else if (q.type === 'open') {
      const max = q.maxLength || 300;
      body = `<div class="stack">
        <textarea class="input" rows="4" maxlength="${max}" tabindex="-1" placeholder="Cevabını buraya yaz…"></textarea>
        <div class="row"><span class="hint">0 / ${max}</span></div>
        <button class="btn btn-primary btn-lg" type="button" tabindex="-1" disabled>Cevabı gönder</button>
      </div>`;
    } else if (q.type === 'wordcloud') {
      const max = q.maxLength || 40;
      body = `<div class="stack">
        <input class="input" maxlength="${max}" tabindex="-1" placeholder="Bir kelime veya kısa ifade…" autocomplete="off" />
        <p class="hint">Kısa tut: kelime bulutunda daha okunaklı görünür.</p>
        <button class="btn btn-primary btn-lg" type="button" tabindex="-1" disabled>Gönder</button>
      </div>`;
    } else if (q.type === 'rating') {
      body = `<div class="stack">
        <div class="stars" role="radiogroup" aria-label="1 ile 5 arasında puan">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) => `<button type="button" class="star" tabindex="-1" aria-label="${n} yıldız">
                ★<small>${n}</small></button>`,
            )
            .join('')}
        </div>
        <button class="btn btn-primary btn-lg" type="button" tabindex="-1" disabled>Puanı gönder</button>
      </div>`;
    }

    return `
      <section class="screen">
        <div class="event-head">
          <div class="event-title" title="${esc(title)}">${esc(title)}</div>
          <div class="row" style="gap:8px">
            <span class="event-code">${esc(S.code || '')}</span>
            <span class="who"><span class="avatar">K</span>Katılımcı</span>
          </div>
        </div>
        <div class="card">
          <div class="q-head">
            <div style="min-width:0">
              <div class="q-index">Soru ${index + 1} / ${total} · ${esc(PREVIEW_TYPE_LABELS[q.type] || 'Soru')}</div>
              <h2 class="q-prompt">${q.prompt ? esc(q.prompt) : '<span class="muted">Soru metnini yaz…</span>'}</h2>
            </div>
          </div>
          ${
            q.timeLimit > 0
              ? `<div class="row" style="align-items:flex-end;gap:14px;margin-top:14px">
                  <div style="flex:1"><div class="timer"><i></i></div></div>
                  <div class="timer-num">${q.timeLimit}</div>
                </div>`
              : ''
          }
          <div style="margin-top:18px">${body}</div>
        </div>
      </section>`;
  }

  function updatePreview() {
    const player = document.getElementById('preview-player');
    if (!player) return;
    if (S.previewIndex === null || !S.editor) {
      closePreview();
      return;
    }
    const q = S.editor.questions[S.previewIndex];
    if (!q) {
      S.previewIndex = null;
      closePreview();
      setPreviewButtonState();
      return;
    }
    player.innerHTML = participantPreviewHtml(q, S.previewIndex);
  }

  function syncPreview(i) {
    if (S.previewIndex === i) updatePreview();
  }

  function onEditorInput(event) {
    if (!S.editor) return;
    const target = event.target;
    const i = Number(target.dataset.i);
    const q = S.editor.questions[i];
    if (!q) return;

    if (target.dataset.field === 'prompt') {
      q.prompt = target.value;
      markDirty();
      syncPreview(i);
      return;
    }
    if (target.dataset.field === 'opt') {
      const option = q.options.find((o) => o.id === target.dataset.optid);
      if (option) option.text = target.value;
      markDirty();
      syncPreview(i);
      return;
    }
    if (target.dataset.field === 'timeLimit') {
      q.timeLimit = clamp(target.value, 0, 900, 0);
      markDirty();
      syncPreview(i);
      return;
    }
    if (target.dataset.field === 'points') {
      q.points = clamp(target.value, 100, 10000, 1000);
      markDirty();
      syncPreview(i);
      return;
    }
    if (target.dataset.field === 'maxLength') {
      q.maxLength = clamp(target.value, 10, 1000, 300);
      markDirty();
      syncPreview(i);
    }
  }

  function onEditorClick(event) {
    const btn = event.target.closest('[data-act]');
    if (!btn || !S.editor) return;
    const action = btn.dataset.act;
    const i = Number(btn.dataset.i);
    const list = S.editor.questions;
    const q = list[i];

    if (action === 'add') {
      const question = blankQuestion(btn.dataset.type || 'mc');
      list.push(question);
      markDirty();
      renderEditor(list.length - 1, true);
      return;
    }
    if (!q) return;

    if (action === 'preview') {
      if (S.previewIndex === i) {
        S.previewIndex = null;
        closePreview();
        setPreviewButtonState();
      } else {
        openPreview(i);
      }
      return;
    }
    if (action === 'up' && i > 0) {
      [list[i - 1], list[i]] = [list[i], list[i - 1]];
      if (S.previewIndex === i) S.previewIndex = i - 1;
      else if (S.previewIndex === i - 1) S.previewIndex = i;
      markDirty();
      renderEditor(i - 1);
      return;
    }
    if (action === 'down' && i < list.length - 1) {
      [list[i + 1], list[i]] = [list[i], list[i + 1]];
      if (S.previewIndex === i) S.previewIndex = i + 1;
      else if (S.previewIndex === i + 1) S.previewIndex = i;
      markDirty();
      renderEditor(i + 1);
      return;
    }
    if (action === 'copy') {
      list.splice(i + 1, 0, {
        ...structuredClone(q),
        id: `q_${Math.random().toString(36).slice(2, 10)}`,
      });
      if (S.previewIndex !== null && S.previewIndex > i) S.previewIndex += 1;
      markDirty();
      renderEditor(i + 1);
      return;
    }
    if (action === 'del') {
      list.splice(i, 1);
      if (S.previewIndex === i) {
        S.previewIndex = null;
        closePreview();
      } else if (S.previewIndex !== null && S.previewIndex > i) {
        S.previewIndex -= 1;
      }
      markDirty();
      renderEditor(Math.max(0, Math.min(i, list.length - 1)));
      return;
    }
    if (action === 'opt-add' && q.options.length < 10) {
      const used = new Set(q.options.map((o) => o.id));
      let n = q.options.length + 1;
      let id = `o${n}`;
      while (used.has(id)) {
        n += 1;
        id = `o${n}`;
      }
      q.options.push({ id, text: `Seçenek ${n}` });
      markDirty();
      renderEditor(i);
      return;
    }
    if (action === 'opt-del' && q.options.length > 2) {
      q.options = q.options.filter((o) => o.id !== btn.dataset.opt);
      if (q.correctId && !q.options.some((o) => o.id === q.correctId)) {
        q.correctId = q.options[0].id;
      }
      markDirty();
      renderEditor(i);
      return;
    }
    if (action === 'correct') {
      q.correctId = btn.dataset.opt;
      markDirty();
      renderEditor(i);
    }
  }

  function onEditorChange(event) {
    if (!S.editor) return;
    const target = event.target;
    if (target.dataset.act === 'multi') {
      const i = Number(target.dataset.i);
      const q = S.editor.questions[i];
      if (!q) return;
      q.multi = !!target.checked;
      markDirty();
      syncPreview(i);
      return;
    }
    if (target.dataset.act !== 'type') return;
    const i = Number(target.dataset.i);
    const q = S.editor.questions[i];
    if (!q) return;
    const type = target.value;
    const previous = q.type;
    q.type = type;

    if (type === 'truefalse') {
      q.options = [
        { id: 'true', text: 'Doğru' },
        { id: 'false', text: 'Yanlış' },
      ];
      q.correctId = 'true';
    } else if (type === 'mc' || type === 'quiz') {
      if (!q.options.length || previous === 'truefalse') {
        q.options = [
          { id: 'o1', text: 'Seçenek 1' },
          { id: 'o2', text: 'Seçenek 2' },
          { id: 'o3', text: 'Seçenek 3' },
        ];
      }
      q.correctId = type === 'quiz' ? q.options[0].id : null;
    } else {
      q.options = [];
      q.correctId = null;
      if (type === 'open') q.maxLength = q.maxLength && q.maxLength >= 40 ? q.maxLength : 300;
      if (type === 'wordcloud') q.maxLength = q.maxLength && q.maxLength <= 80 ? q.maxLength : 40;
    }
    markDirty();
    renderEditor(i);
  }

  async function saveEditor() {
    if (!S.editor) return;
    const list = S.editor.questions;
    if (!list.length) return toast('En az bir soru eklemelisin.', 'bad');
    const empty = list.findIndex((q) => !q.prompt.trim());
    if (empty !== -1) {
      toast(`Soru ${empty + 1} için metin yazmalısın.`, 'bad');
      const textarea = modalEl.querySelector(`.editor-card[data-qcard="${empty}"] textarea`);
      if (textarea) {
        textarea.focus();
        textarea.scrollIntoView({ block: 'center' });
      }
      return;
    }

    const button = document.getElementById('editor-save');
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Kaydediliyor…';
    }

    try {
      const response = await fetch(`/api/events/${encodeURIComponent(S.code)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...hostHeaders() },
        body: JSON.stringify({
          questions: list.map((q) => ({
            id: q.id,
            type: q.type,
            prompt: q.prompt.trim(),
            options: q.options,
            correctId: q.correctId,
            multi: q.type === 'mc' ? !!q.multi : false,
            timeLimit: q.timeLimit,
            points: q.points,
            maxLength: q.maxLength,
            note: q.note,
          })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Sorular kaydedilemedi.');
      S.editor = null;
      closeModal(true);
      S.renderSig = '';
      setState(data.state);
      toast('Sorular kaydedildi.', 'good');
    } catch (err) {
      toast(err.message || 'Sorular kaydedilemedi.', 'bad');
      if (button) {
        button.disabled = false;
        button.textContent = 'Kaydet';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Eylem yönlendirici
  // ---------------------------------------------------------------------------

  async function handleAction(action, el) {
    const st = S.state;

    switch (action) {
      case 'copy':
        return copyText(el.dataset.copy || '');

      case 'logout':
        return logout();

      case 'event-toggle':
        return toggleEventResponses(el.dataset.code, el.dataset.next === 'true');

      case 'event-code':
        return openChangeCode(el.dataset.code, el.dataset.title || '');

      case 'event-delete':
        return deleteAccountEvent(el.dataset.code, el.dataset.title || '');

      case 'change-code':
        return openChangeCode(S.code, st?.title || S.meta?.title || '');

      case 'start':
        if (!st?.total) return toast('Başlamak için önce soru eklemelisin.', 'bad');
        if (st?.settings?.acceptingResponses === false) return toast('Önce etkinliği cevaplara aç.', 'bad');
        return hostAction('start');

      case 'lock':
        return hostAction('lock');

      case 'next':
        if (st?.settings?.acceptingResponses === false) return toast('Önce etkinliği cevaplara aç.', 'bad');
        return hostAction('next');

      case 'resetAnswers': {
        if (st?.settings?.acceptingResponses === false) return toast('Önce etkinliği cevaplara aç.', 'bad');
        const ok = await confirmDialog({
          title: 'Cevaplar sıfırlansın mı?',
          message: 'Bu soruya verilen tüm cevaplar silinecek ve soru yeniden açılacak. Bu işlem geri alınamaz.',
          confirmText: 'Sıfırla',
          danger: true,
        });
        if (ok) hostAction('resetAnswers');
        return;
      }

      case 'edit':
        return openEditor();

      case 'q-open': {
        if (!st) return;
        const index = Number(el.dataset.index);
        const question = st.questions[index];
        if (!question) return;
        if (st.phase === 'lobby') return openEditor(index);
        return hostAction('goto', { index });
      }

      case 'goto': {
        const index = Number(el.dataset.index);
        const question = st?.questions?.[index];
        if (!question) return;
        return hostAction('goto', { index });
      }

      case 'end': {
        const ok = await confirmDialog({
          title: 'Oturum kapatılsın mı?',
          message: 'Katılımcılar sonuç ve puan tablosunu görecek. Daha sonra "Başlangıca dön" ile devam edebilirsin.',
          confirmText: 'Oturumu kapat',
        });
        if (ok) hostAction('end');
        return;
      }

      case 'restart': {
        const ok = await confirmDialog({
          title: 'Yeni oturum başlatılsın mı?',
          message: 'Tüm katılımcılar ve cevaplar silinecek. Etkinlik aynı kodla, boş bir oturum olarak başlar.',
          confirmText: 'Her şeyi sıfırla',
          danger: true,
        });
        if (ok) hostAction('restart');
        return;
      }

      case 'resetLobby': {
        const ok = await confirmDialog({
          title: 'Başlangıca dönülsün mü?',
          message: 'Oturum bekleme ekranına döner. Cevaplar ve katılımcılar korunur; soruları yeniden düzenleyebilirsin.',
          confirmText: 'Başlangıca dön',
        });
        if (ok) hostAction('resetLobby');
        return;
      }

      case 'delete':
        return deleteCurrentEvent();

      case 'qr':
        return openQr();

      case 'export':
        return openExport();

      case 'settings':
        return openSettings();

      case 'questions':
        return openQuestionsModal();

      case 'participants':
        return openParticipantsModal();

      case 'rename':
        return openRename();

      case 'remove-local': {
        const code = el.dataset.code;
        if (!code) return;
        removeEventLocal(code);
        renderHome();
        toast('Etkinlik listeden kaldırıldı.', 'good');
        return;
      }

      default:
        return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Olay dinleyicileri
  // ---------------------------------------------------------------------------

  root.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    event.preventDefault();
    handleAction(actionEl.dataset.action, actionEl);
  });

  root.addEventListener('change', (event) => {
    const settingEl = event.target.closest('[data-setting]');
    if (!settingEl) return;
    updateSettings({ [settingEl.dataset.setting]: settingEl.checked });
  });

  modalEl.addEventListener('click', (event) => {
    if (S.editor) {
      onEditorClick(event);
      return;
    }
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (action === 'copy') {
      copyText(actionEl.dataset.copy || '');
      return;
    }
    if (action === 'settings') return;
    if (action === 'q-open') {
      event.preventDefault();
      closeModal(true);
      handleAction('q-open', actionEl);
      return;
    }
    if (['rename', 'change-code', 'export', 'edit'].includes(action)) {
      event.preventDefault();
      handleAction(action, actionEl);
    }
  });

  modalEl.addEventListener('input', (event) => {
    if (S.editor) onEditorInput(event);
  });

  modalEl.addEventListener('change', (event) => {
    const settingEl = event.target.closest('[data-setting]');
    if (settingEl) {
      updateSettings({ [settingEl.dataset.setting]: settingEl.checked });
      return;
    }
    if (S.editor) onEditorChange(event);
  });

  document.addEventListener('keydown', (event) => {
    if (!modalEl.hidden) {
      if (event.key === 'Escape') closeModal();
      return;
    }
    if (event.target.closest('input, textarea, select')) return;
    if (!S.state || S.route !== 'dash') return;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      hostAction('next');
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      hostAction('back');
    } else if (event.key === 's' || event.key === 'S') {
      openSettings();
    } else if (event.key === 'e' || event.key === 'E') {
      if (S.state.phase === 'lobby') openEditor();
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (S.editor?.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  let eventListResizeTimer = 0;
  window.addEventListener('resize', () => {
    if (!document.getElementById('event-list')) return;
    clearTimeout(eventListResizeTimer);
    eventListResizeTimer = setTimeout(fitEventList, 120);
  });

  // ---------------------------------------------------------------------------
  // Başlangıç
  // ---------------------------------------------------------------------------

  async function boot() {
    const match = location.pathname.match(/^\/(?:h|host)\/([A-Za-z0-9]+)/i);
    renderLoading();
    await refreshSession();

    if (!match) {
      S.route = 'home';
      if (!S.user) {
        renderAuth();
        return;
      }
      await loadAccountEvents();
      renderHome();
      return;
    }

    S.route = 'dash';
    S.code = normalizeCode(match[1]);

    const params = new URLSearchParams(location.search);
    const queryKey = params.get('k');
    if (queryKey) {
      S.key = queryKey.trim();
      writeStorage(`co:host:${S.code}`, { key: S.key });
    } else {
      const saved = readStorage(`co:host:${S.code}`, null);
      S.key = saved?.key || null;
    }
    if (queryKey) history.replaceState(null, '', `/h/${S.code}`);

    const found = await loadEventMeta();
    if (!found) {
      S.route = 'missing';
      renderMissing();
      return;
    }
    if (!S.key && !S.user) {
      renderAuth('Bu etkinliği yönetmek için giriş yapmalısınız. Yönetici anahtarın varsa /h/KOD?k=ANAHTAR adresini kullanabilirsin.');
      return;
    }
    connectHost();
  }

  boot();
})();
