/* Katılımcı ekranı — /, /j/CODE, /events/CODE */
(() => {
  'use strict';

  const screenEl = document.getElementById('screen');
  const toastEl = document.getElementById('toast');
  const netEl = document.getElementById('net');
  const footEl = document.getElementById('foot');

  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const CLOUD_COLORS = ['#c7c0ff', '#8fb4ff', '#67e8f9', '#a7f3d0', '#fde68a', '#fca5a5', '#f0abfc', '#93c5fd'];

  const S = {
    code: null,
    event: null,
    snapshot: null,
    joined: false,
    joining: false,
    submitting: false,
    me: null,
    token: null,
    name: '',
    myAnswers: {},
    draft: null,
    view: '',
    phaseSig: '',
    statsSig: '',
    serverOffset: 0,
    error: '',
    rejoinTimer: null,
    expirySynced: null,
    deleted: false,
  };

  const socket = io({ autoConnect: true });

  // ---------------------------------------------------------------------------
  // Küçük yardımcılar
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
      /* gizli mod vb. */
    }
  }

  function removeStorage(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* yok say */
    }
  }

  const playerKey = () => `co:player:${S.code || ''}`;

  function savedPlayer() {
    if (!S.code) return null;
    return readStorage(playerKey());
  }

  function savePlayer() {
    if (!S.code || !S.token) return;
    writeStorage(playerKey(), { token: S.token, name: S.name, pid: S.me?.id || null });
  }

  function toast(message, kind = '') {
    toastEl.textContent = message;
    toastEl.className = `toast show ${kind}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toastEl.className = 'toast';
    }, 3200);
  }

  function setNet(online) {
    netEl.hidden = online;
  }

  function codeFromLocation() {
    const match = location.pathname.match(/^\/(?:j|e|events)\/([A-Za-z0-9]+)/);
    if (match) return normalizeCode(match[1]);
    const query = new URLSearchParams(location.search).get('code');
    return query ? normalizeCode(query) : null;
  }

  // ---------------------------------------------------------------------------
  // Zamanlayıcı
  // ---------------------------------------------------------------------------

  function tickTimers() {
    const snap = S.snapshot;
    if (!snap?.question) return;
    const q = snap.question;
    const numEls = document.querySelectorAll('[data-timer-num]');
    const bars = document.querySelectorAll('[data-timer-bar]');
    if (!q.deadline) {
      numEls.forEach((el) => (el.textContent = q.timeLimit ? '0' : '∞'));
      return;
    }
    const left = Math.max(0, q.deadline - (Date.now() + S.serverOffset));
    const seconds = Math.ceil(left / 1000);
    numEls.forEach((el) => {
      el.textContent = String(seconds);
      el.classList.toggle('warn', seconds <= 10 && seconds > 5);
      el.classList.toggle('bad', seconds <= 5);
    });
    const ratio = Math.max(0, Math.min(1, left / (q.timeLimit * 1000)));
    bars.forEach((el) => {
      el.classList.toggle('warn', left <= 5000);
      const fill = el.querySelector('i');
      if (fill) fill.style.width = `${(ratio * 100).toFixed(2)}%`;
    });

    // Süre dolduğunda sunucudan sonuçları iste (yalnızca bir kez).
    if (left <= 0 && snap.phase === 'question' && !q.answered && S.expirySynced !== q.id) {
      S.expirySynced = q.id;
      requestSync();
    }
  }
  setInterval(tickTimers, 200);

  // ---------------------------------------------------------------------------
  // Ortak parçalar
  // ---------------------------------------------------------------------------

  function eventHead() {
    const title = S.snapshot?.title || S.event?.title || 'Canlı Oturum';
    return `
      <div class="event-head">
        <div class="event-title" title="${esc(title)}">${esc(title)}</div>
        <div class="row" style="gap: 8px">
          <span class="event-code">${esc(S.code || '')}</span>
          ${
            S.me
              ? `<span class="who"><span class="avatar">${esc(initials(S.me.name))}</span>${esc(S.me.name)}</span>`
              : ''
          }
        </div>
      </div>`;
  }

  function timerBlock(q) {
    if (!q?.deadline) return '';
    return `
      <div class="row" style="align-items: flex-end; gap: 14px; margin-top: 14px">
        <div style="flex: 1">
          <div class="timer" data-timer-bar><i></i></div>
        </div>
        <div class="timer-num" data-timer-num>${Math.max(0, Math.ceil((q.deadline - (Date.now() + S.serverOffset)) / 1000))}</div>
      </div>`;
  }

  function waitingFooter(text = 'Sunucunun devam etmesi bekleniyor') {
    return `<div class="center muted small" style="display:flex;flex-direction:column;gap:8px;align-items:center;padding:6px 0">
      <span class="waiting-dots"><i></i><i></i><i></i></span>
      <span>${esc(text)}</span>
    </div>`;
  }

  function typeLabel(type) {
    return (
      {
        mc: 'Oylama',
        quiz: 'Quiz',
        truefalse: 'Doğru / Yanlış',
        open: 'Açık uçlu',
        wordcloud: 'Kelime bulutu',
        rating: 'Puanlama',
      }[type] || 'Soru'
    );
  }

  function optionText(q, value) {
    return q?.options?.find((o) => o.id === value)?.text ?? String(value ?? '');
  }

  function answerLabel(q, value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map((v) => optionText(q, v)).join(', ');
    if (q.type === 'mc' || q.type === 'quiz' || q.type === 'truefalse') return optionText(q, value);
    if (q.type === 'rating') return `${value} / 5 yıldız`;
    return String(value);
  }

  // ---------------------------------------------------------------------------
  // Ekranlar
  // ---------------------------------------------------------------------------

  function renderCode() {
    const error = S.error || '';
    screenEl.innerHTML = `
      <section class="screen">
        <div class="hero">
          <div class="logo-mark">⚡</div>
          <h1>Canlı Oturum'a katıl</h1>
          <p class="muted">Sunucunun paylaştığı 6 haneli kodu girerek başla.</p>
        </div>

        <form class="card stack" id="code-form" novalidate>
          <div>
            <label class="label" for="code-input">Oturum kodu</label>
            <input id="code-input" class="input code-input" name="code" inputmode="text" autocomplete="off"
              autocapitalize="characters" spellcheck="false" maxlength="6" placeholder="ABC123"
              value="${esc(S.code || '')}" aria-describedby="code-err" />
          </div>
          <p class="err" id="code-err">${esc(error)}</p>
          <button class="btn btn-primary btn-lg" type="submit">Devam et</button>
        </form>

        <div class="feature-grid">
          <div class="feature"><div class="ico">📱</div><div><b>Telefonla katıl</b><span>Uygulama indirmeye gerek yok.</span></div></div>
          <div class="feature"><div class="ico">⚡</div><div><b>Anında sonuç</b><span>Cevaplar canlı olarak ekranda.</span></div></div>
          <div class="feature"><div class="ico">🔒</div><div><b>İsimsiz değil, basit</b><span>Sadece kod ve adınız yeterli.</span></div></div>
        </div>

        <p class="muted small center">Yönetici misiniz? <a href="/host">Etkinlik paneli</a></p>
      </section>`;

    const form = document.getElementById('code-form');
    const input = document.getElementById('code-input');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = normalizeCode(input.value);
      if (code.length !== 6) {
        document.getElementById('code-err').textContent = 'Kod 6 karakter olmalı.';
        input.focus();
        return;
      }
      S.code = code;
      S.error = '';
      loadEvent(code);
    });
    input.addEventListener('input', () => {
      input.value = normalizeCode(input.value);
    });
  }

  function renderName() {
    const event = S.event || {};
    const savedName = S.name || readStorage('co:name', '') || '';
    const participants = event.participants || 0;
    screenEl.innerHTML = `
      <section class="screen">
        ${eventHead()}
        <div class="card stack">
          <div>
            <div class="q-index">Katılım</div>
            <h2 class="q-prompt" style="font-size:clamp(20px,5vw,25px);margin-top:4px">Sana nasıl hitap edelim?</h2>
            <p class="muted small" style="margin-top:8px">
              ${participants > 0 ? `${participants} kişi katıldı. ` : ''}Adını yazarak oturuma katıl.
            </p>
          </div>
          <form id="name-form" class="stack" novalidate>
            <div>
              <label class="label" for="name-input">Adın</label>
              <input id="name-input" class="input" name="name" maxlength="24" autocomplete="name"
                enterkeyhint="go" placeholder="Örn. Ayşe" value="${esc(savedName)}" aria-describedby="name-err" />
            </div>
            <p class="err" id="name-err">${esc(S.error || '')}</p>
            <button class="btn btn-primary btn-lg" type="submit">Oturuma katıl</button>
          </form>
          <p class="hint center">Adın, sunucunun katılımcı listesinde görünür.</p>
        </div>
        <div class="center">
          <button class="btn btn-quiet btn-sm" id="change-code" type="button">← Kodu değiştir</button>
        </div>
      </section>`;

    const form = document.getElementById('name-form');
    const input = document.getElementById('name-input');
    form.addEventListener('submit', (event2) => {
      event2.preventDefault();
      const name = input.value.trim().replace(/\s+/g, ' ');
      if (name.length < 2) {
        document.getElementById('name-err').textContent = 'Lütfen en az 2 karakterlik bir ad yaz.';
        input.focus();
        return;
      }
      S.name = name;
      writeStorage('co:name', name);
      S.error = '';
      S.view = 'joining';
      renderJoining();
      join();
    });
    document.getElementById('change-code').addEventListener('click', () => {
      S.code = null;
      S.event = null;
      S.error = '';
      history.replaceState(null, '', '/');
      renderCode();
    });
  }

  function renderJoining() {
    screenEl.innerHTML = `
      <section class="screen center">
        <div class="pulse"><div class="pulse-core">⚡</div></div>
        <h2 style="font-size:22px">Oturuma bağlanıyorsun…</h2>
        <p class="muted small">${esc(S.event?.title || '')}</p>
        <div class="row" style="justify-content:center"><span class="spinner"></span></div>
      </section>`;
  }

  function renderWaiting() {
    const snap = S.snapshot;
    const participants = snap?.participants ?? 0;
    const total = snap?.total ?? 0;
    screenEl.innerHTML = `
      <section class="screen">
        ${eventHead()}
        <div class="card center stack" style="align-items:center;padding:26px 20px">
          <div class="pulse"><div class="pulse-core">👋</div></div>
          <div>
            <h2 style="font-size:23px;font-weight:800;letter-spacing:-.02em">Hoş geldin, ${esc(S.me?.name || S.name)}</h2>
            <p class="muted small" style="margin-top:6px">${esc(snap?.title || S.event?.title || '')}</p>
          </div>
          <div class="stat-grid" style="width:100%">
            <div class="stat"><b data-participants>${participants}</b><span>katılımcı</span></div>
            <div class="stat"><b>${total}</b><span>soru</span></div>
            <div class="stat"><b>${esc(S.code || '')}</b><span>kod</span></div>
          </div>
          ${
            total === 0
              ? '<p class="muted small">Sunucu henüz soru eklemedi.</p>'
              : '<p class="muted small">Sunucu oturumu başlattığında sorular burada görünecek.</p>'
          }
          ${waitingFooter('Sunucunun başlatması bekleniyor')}
        </div>
      </section>`;
  }

  function liveResultsHtml(stats) {
    return `<div data-live-results-block style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
      <div class="row" style="gap:8px;margin-bottom:8px">
        <b style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">Canlı sonuçlar</b>
        <span class="spacer"></span>
        <span class="tiny muted">${stats.total || 0} cevap</span>
      </div>
      ${statsHtml(stats, undefined, null)}
    </div>`;
  }

  function renderQuestion() {
    const snap = S.snapshot;
    const q = snap.question;
    const answered = !!q.answered || Object.prototype.hasOwnProperty.call(S.myAnswers, q.id);

    if (answered) {
      renderAnswered();
      return;
    }

    const index = (q.index ?? snap.current ?? 0) + 1;
    const multi = q.type === 'mc' && !!q.multi;
    let body = '';

    if (q.type === 'mc' || q.type === 'quiz' || q.type === 'truefalse') {
      body = `<div class="options" role="${multi ? 'group' : 'radiogroup'}" aria-label="Seçenekler">
        ${q.options
          .map(
            (o, i) => `
          <button type="button" class="opt" data-opt="${esc(o.id)}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="false">
            <span class="key">${LETTERS[i] || i + 1}</span>
            <span class="txt">${esc(o.text)}</span>
          </button>`,
          )
          .join('')}
      </div>
      <div class="submit-bar">
        <button class="btn btn-primary btn-lg" id="send" disabled>${multi ? 'Cevapları gönder' : 'Cevabı gönder'}</button>
        <p class="hint center">${multi ? 'Birden fazla seçenek işaretleyebilirsin.' : 'Bir seçenek seçtikten sonra gönder.'}</p>
      </div>`;
    } else if (q.type === 'open') {
      const max = q.maxLength || 300;
      body = `<div class="stack">
        <textarea class="input" id="answer-text" maxlength="${max}" rows="4"
          placeholder="Cevabını buraya yaz…" enterkeyhint="send"></textarea>
        <div class="row"><span class="hint" id="counter">0 / ${max}</span></div>
        <button class="btn btn-primary btn-lg" id="send" disabled>Cevabı gönder</button>
      </div>`;
    } else if (q.type === 'wordcloud') {
      const max = q.maxLength || 40;
      body = `<div class="stack">
        <input class="input" id="answer-text" maxlength="${max}" placeholder="Bir kelime veya kısa ifade…"
          enterkeyhint="send" autocomplete="off" />
        <p class="hint">Kısa tut: kelime bulutunda daha okunaklı görünür.</p>
        <button class="btn btn-primary btn-lg" id="send" disabled>Gönder</button>
      </div>`;
    } else if (q.type === 'rating') {
      body = `<div class="stack">
        <div class="stars" role="radiogroup" aria-label="1 ile 5 arasında puan">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) => `<button type="button" class="star" data-rate="${n}" role="radio" aria-checked="false" aria-label="${n} yıldız">
                ★<small>${n}</small></button>`,
            )
            .join('')}
        </div>
        <button class="btn btn-primary btn-lg" id="send" disabled>Puanı gönder</button>
      </div>`;
    }

    const liveStats = snap.settings?.liveResults && q.stats ? liveResultsHtml(q.stats) : '';

    screenEl.innerHTML = `
      <section class="screen">
        ${eventHead()}
        <div class="card">
          <div class="q-head">
            <div style="min-width:0">
              <div class="q-index">Soru ${index} / ${snap.total} · ${esc(typeLabel(q.type))}</div>
              <h2 class="q-prompt">${esc(q.prompt)}</h2>
            </div>
            ${q.deadline ? '' : ''}
          </div>
          ${timerBlock(q)}
          <div style="margin-top:18px">${body}</div>
          <div id="live-results-root">${liveStats}</div>
        </div>
      </section>`;

    const liveRoot = document.getElementById('live-results-root');
    if (liveRoot) {
      liveRoot.dataset.sig = snap.settings?.liveResults && q.stats ? JSON.stringify(q.stats) : '';
    }

    const sendBtn = document.getElementById('send');
    const select = (value) => {
      if (multi) {
        const current = Array.isArray(S.draft) ? [...S.draft] : [];
        const at = current.indexOf(value);
        if (at >= 0) current.splice(at, 1);
        else current.push(value);
        S.draft = current;
        document.querySelectorAll('[data-opt]').forEach((el) => {
          const on = current.includes(el.dataset.opt);
          el.classList.toggle('sel', on);
          el.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        if (sendBtn) sendBtn.disabled = current.length === 0;
        return;
      }
      S.draft = value;
      document.querySelectorAll('[data-opt]').forEach((el) => {
        const on = el.dataset.opt === value;
        el.classList.toggle('sel', on);
        el.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      document.querySelectorAll('[data-rate]').forEach((el) => {
        const on = Number(el.dataset.rate) === value;
        el.classList.toggle('on', on);
        el.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      if (sendBtn) sendBtn.disabled = value === null || value === undefined || value === '';
    };

    document.querySelectorAll('[data-opt]').forEach((el) => {
      el.addEventListener('click', () => select(el.dataset.opt));
    });
    document.querySelectorAll('[data-rate]').forEach((el) => {
      el.addEventListener('click', () => select(Number(el.dataset.rate)));
    });

    const textEl = document.getElementById('answer-text');
    if (textEl) {
      const counter = document.getElementById('counter');
      textEl.addEventListener('input', () => {
        if (counter) counter.textContent = `${textEl.value.length} / ${textEl.maxLength}`;
        sendBtn.disabled = textEl.value.trim().length === 0;
      });
      textEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && q.type === 'wordcloud') {
          event.preventDefault();
          if (!sendBtn.disabled) sendBtn.click();
        }
      });
    }

    sendBtn.addEventListener('click', () => {
      const value = q.type === 'open' || q.type === 'wordcloud' ? textEl?.value.trim() : S.draft;
      if (value === undefined || value === null || value === '') return;
      if (Array.isArray(value) && !value.length) return;
      submitAnswer(value);
    });
  }

  function renderAnswered() {
    const snap = S.snapshot;
    const q = snap.question;
    const value = S.myAnswers[q.id];
    const text = answerLabel(q, value);
    screenEl.innerHTML = `
      <section class="screen">
        ${eventHead()}
        <div class="card">
          <div class="q-index">Soru ${(q.index ?? snap.current ?? 0) + 1} / ${snap.total}</div>
          <h2 class="q-prompt" style="font-size:clamp(19px,4.6vw,23px);margin-top:4px">${esc(q.prompt)}</h2>
          <div class="answered">
            <div class="check-ring">✓</div>
            <h3 style="font-size:20px;font-weight:800">Cevabın alındı</h3>
            ${text ? `<div class="your-answer">✓ ${esc(text)}</div>` : ''}
            <p class="muted small">Sonuçlar açıklandığında burada göreceksin.</p>
          </div>
        </div>
        ${q.deadline && snap.phase === 'question' ? `<div class="card tight center small muted"><span data-timer-num>${Math.max(0, Math.ceil((q.deadline - (Date.now() + S.serverOffset)) / 1000))}</span> saniye kaldı</div>` : ''}
        ${waitingFooter()}
      </section>`;
  }

  function statsHtml(stats, myValue, correctId) {
    if (stats?.kind === 'choice') {
      const total = stats.total || 0;
      const rows = `<div class="res">
        ${stats.options
          .map((o) => {
            const pct = total ? Math.round((o.count / total) * 100) : 0;
            const isCorrect = correctId && o.id === correctId;
            const isMine = Array.isArray(myValue) ? myValue.includes(o.id) : myValue === o.id;
            const isWrong = correctId && isMine && o.id !== correctId;
            return `<div class="res-row ${isCorrect ? 'correct' : ''} ${isMine ? 'mine' : ''} ${isWrong ? 'wrong' : ''}">
              <div class="res-top">
                <span class="txt">${esc(o.text)} ${isMine ? '<span class="pill" style="padding:2px 7px;font-size:10.5px">senin cevabın</span>' : ''}</span>
                <span class="num">${o.count} kişi · %${pct}</span>
              </div>
              <div class="res-bar"><span class="res-fill" style="width:${Math.max(pct, o.count ? 4 : 0)}%"></span></div>
            </div>`;
          })
          .join('')}
      </div>`;
      return total ? rows : '<div class="empty"><div class="big">🫥</div>Bu soruya cevap gelmedi.</div>';
    }
    if (stats?.kind === 'rating') {
      const total = stats.total || 0;
      const max = Math.max(1, ...stats.distribution.map((d) => d.count));
      return `<div class="avg"><b>${stats.avg}</b><span>/ 5 · ${total} cevap</span></div>
        <div class="res" style="margin-top:10px">
          ${stats.distribution
            .map((d) => {
              const pct = total ? Math.round((d.count / total) * 100) : 0;
              return `<div class="res-row">
                <div class="res-top"><span class="txt">${'★'.repeat(d.value)}${'☆'.repeat(5 - d.value)}</span>
                <span class="num">${d.count} kişi · %${pct}</span></div>
                <div class="res-bar"><span class="res-fill" style="width:${total ? Math.max((d.count / max) * 100, d.count ? 4 : 0) : 0}%"></span></div>
              </div>`;
            })
            .join('')}
        </div>`;
    }
    if (stats?.kind === 'wordcloud') {
      const max = Math.max(1, ...stats.words.map((w) => w.count));
      return stats.words.length
        ? `<div class="cloud">${stats.words
            .map((w, i) => {
              const ratio = w.count / max;
              const size = 14 + Math.round(ratio * 26);
              const color = CLOUD_COLORS[i % CLOUD_COLORS.length];
              return `<span style="font-size:${size}px;color:${color};opacity:${0.62 + ratio * 0.38}">${esc(w.text)}</span>`;
            })
            .join('')}</div>
          <p class="hint center">${stats.total} cevap · ${stats.words.length} farklı ifade</p>`
        : '<div class="empty"><div class="big">☁️</div>Henüz kelime gelmedi.</div>';
    }
    return stats?.items?.length
      ? `<div class="open-list">${stats.items
          .map(
            (item) =>
              `<div class="open-item"><span>${esc(item.text)}</span>${item.count > 1 ? `<span class="count">×${item.count}</span>` : ''}</div>`,
          )
          .join('')}</div>
        <p class="hint center" style="margin-top:10px">${stats.total} cevap · ${stats.unique} farklı yanıt</p>`
      : '<div class="empty"><div class="big">✍️</div>Henüz cevap gelmedi.</div>';
  }

  function renderResults() {
    const snap = S.snapshot;
    const q = snap.question;
    const stats = q.stats;
    const myValue = S.myAnswers[q.id];
    const hasAnswer = !!q.answered || Object.prototype.hasOwnProperty.call(S.myAnswers, q.id);
    const expired = !!q.expired && !hasAnswer;
    const correctId = q.correctId;
    const isQuiz = q.type === 'quiz' || (q.type === 'truefalse' && !!correctId);

    const body = statsHtml(stats, myValue, correctId);

    let banner = '';
    if (isQuiz && hasAnswer) {
      const ok = myValue === correctId;
      banner = `<div class="banner ${ok ? 'good' : 'bad'}">
        <span style="font-size:20px">${ok ? '🎉' : '💡'}</span>
        <div><b>${ok ? 'Doğru bildin!' : 'Bu sefer olmadı'}</b>
        <div class="small" style="opacity:.85">Doğru cevap: ${esc(optionText(q, correctId))}</div></div>
      </div>`;
    } else if (isQuiz && expired) {
      banner = `<div class="banner info"><span style="font-size:20px">⏱</span><div><b>Süren doldu</b><div class="small" style="opacity:.85">Doğru cevap: ${esc(optionText(q, correctId))}</div></div></div>`;
    } else if (isQuiz) {
      banner = `<div class="banner info"><span style="font-size:20px">💡</span><div>Doğru cevap: <b>${esc(optionText(q, correctId))}</b></div></div>`;
    } else if (expired) {
      banner = `<div class="banner info"><span style="font-size:18px">⏱</span><div><b>Süren doldu</b><div class="small" style="opacity:.85">Sonuçları inceleyip sonraki soruya geçebilirsin.</div></div></div>`;
    } else if (hasAnswer && myValue !== undefined) {
      banner = `<div class="banner info"><span style="font-size:18px">✓</span><div>Senin cevabın: <b>${esc(answerLabel(q, myValue))}</b></div></div>`;
    }

    const leaders = snap.leaderboard || [];
    const leaderHtml =
      leaders.length && snap.settings?.showLeaderboard !== false
        ? `<div class="card flat tight">
            <div class="row" style="margin-bottom:10px"><b style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">İlk 5</b><span class="spacer"></span><span class="tiny muted">puan</span></div>
            <div class="leader">
              ${leaders
                .map(
                  (l) => `<div class="leader-row ${l.id === S.me?.id ? 'me' : ''}">
                    <span class="rank">${l.rank}</span>
                    <span class="name">${esc(l.name)}</span>
                    <span class="score">${l.score}</span>
                  </div>`,
                )
                .join('')}
            </div>
          </div>`
        : '';

    const isLast = (q.index ?? snap.current ?? 0) >= (snap.total || 1) - 1;

    screenEl.innerHTML = `
      <section class="screen">
        ${eventHead()}
        <div class="card">
          <div class="result-head">
            <span class="pill phase">Sonuçlar</span>
            <span class="tiny muted">Soru ${(q.index ?? snap.current ?? 0) + 1} / ${snap.total}</span>
          </div>
          <h2 class="q-prompt" style="font-size:clamp(19px,4.6vw,24px);margin-top:10px">${esc(q.prompt)}</h2>
          <div class="stack" style="margin-top:16px">${banner}${body}</div>
          <div class="submit-bar" style="margin-top:18px">
            <button class="btn btn-primary btn-lg" id="next-q" type="button">
              ${isLast ? '🏁 Bitir' : 'Sonraki soru →'}
            </button>
            <p class="hint center">Kendi hızındasın: hazır olduğunda devam et.</p>
          </div>
        </div>
        ${leaderHtml}
      </section>`;

    S.statsSig = statsSignature(snap);

    const nextBtn = document.getElementById('next-q');
    if (nextBtn) nextBtn.addEventListener('click', advanceQuestion);

    requestAnimationFrame(() => {
      document.querySelectorAll('.res-fill').forEach((el) => {
        const width = el.style.width;
        el.style.width = '0%';
        requestAnimationFrame(() => {
          el.style.width = width;
        });
      });
    });
  }

  function renderDone() {
    const snap = S.snapshot;
    const leaders = snap?.leaderboard || [];
    const score = S.me?.score ?? 0;
    const myRank = leaders.find((l) => l.id === S.me?.id);

    screenEl.innerHTML = `
      <section class="screen">
        ${eventHead()}
        <div class="card center stack" style="align-items:center">
          <div class="logo-mark" style="animation:none">✅</div>
          <div>
            <h2 style="font-size:23px;font-weight:820;letter-spacing:-.025em">Tüm soruları tamamladın</h2>
            <p class="muted small" style="margin-top:6px">${esc(S.me?.name || S.name)}, tebrikler!</p>
          </div>
          ${
            snap?.total
              ? `<div class="stat-grid" style="width:100%">
                  <div class="stat"><b>${score}</b><span>puanın</span></div>
                  <div class="stat"><b>${myRank ? `#${myRank.rank}` : '—'}</b><span>sıralaman</span></div>
                  <div class="stat"><b>${snap.total}/${snap.total}</b><span>soru</span></div>
                </div>`
              : ''
          }
          ${
            leaders.length && snap.settings?.showLeaderboard !== false
              ? `<div class="leader" style="width:100%">
                  ${leaders
                    .map(
                      (l) => `<div class="leader-row ${l.id === S.me?.id ? 'me' : ''}">
                        <span class="rank">${l.rank}</span>
                        <span class="name">${esc(l.name)}</span>
                        <span class="score">${l.score}</span>
                      </div>`,
                    )
                    .join('')}
                </div>`
              : ''
          }
        </div>
        ${waitingFooter('Yönetici oturumu bitirdiğinde final sonuçları göreceksin')}
      </section>`;
  }

  function renderEnded() {
    const snap = S.snapshot;
    const leaders = snap?.leaderboard || [];
    const score = S.me?.score ?? 0;
    const myRank = leaders.find((l) => l.id === S.me?.id);
    const top3 = leaders.slice(0, 3);

    screenEl.innerHTML = `
      <section class="screen">
        ${eventHead()}
        <div class="card center stack" style="align-items:center">
          <div class="logo-mark" style="animation:none">🏁</div>
          <div>
            <h2 style="font-size:24px;font-weight:820;letter-spacing:-.025em">Oturum tamamlandı</h2>
            <p class="muted small" style="margin-top:6px">Katıldığın için teşekkürler, ${esc(S.me?.name || S.name)}!</p>
          </div>
          ${
            snap?.total
              ? `<div class="stat-grid" style="width:100%">
                  <div class="stat"><b>${score}</b><span>puanın</span></div>
                  <div class="stat"><b>${myRank ? `#${myRank.rank}` : '—'}</b><span>sıralaman</span></div>
                  <div class="stat"><b>${snap.participants ?? '—'}</b><span>katılımcı</span></div>
                </div>`
              : ''
          }
          ${
            top3.length
              ? `<div class="podium" style="width:100%">
                  ${top3
                    .map(
                      (l) => `<div class="p">
                        <div class="nm">${esc(l.name)}</div>
                        <div class="bar">${l.rank === 1 ? '🏆' : l.rank}</div>
                        <div class="sc">${l.score} puan</div>
                      </div>`,
                    )
                    .join('')}
                </div>`
              : ''
          }
        </div>
        ${waitingFooter('Sunucu yeni bir oturum başlatabilir')}
      </section>`;
  }

  function renderDeleted() {
    screenEl.innerHTML = `
      <section class="screen">
        <div class="hero">
          <div class="logo-mark" style="animation:none">🗑️</div>
          <h1>Oturum kapatıldı</h1>
          <p class="muted">Bu etkinlik artık mevcut değil. Yeni bir kod ile tekrar katılabilirsin.</p>
        </div>
        <button class="btn btn-primary btn-lg" id="go-home" type="button">Yeni kod gir</button>
      </section>`;
    document.getElementById('go-home').addEventListener('click', () => {
      S.code = null;
      S.event = null;
      S.snapshot = null;
      S.joined = false;
      S.token = null;
      S.me = null;
      S.myAnswers = {};
      S.deleted = false;
      S.error = '';
      history.replaceState(null, '', '/');
      renderCode();
    });
  }

  function renderClosed() {
    screenEl.innerHTML = `
      <section class="screen">
        ${eventHead()}
        <div class="card center stack" style="align-items:center;padding:28px 22px">
          <div class="pulse"><div class="pulse-core">⏸</div></div>
          <div>
            <h2 style="font-size:22px;font-weight:820;letter-spacing:-.02em">Cevaplar şu anda kapalı</h2>
            <p class="muted small" style="margin-top:7px">
              ${esc(S.snapshot?.title || S.event?.title || '')} için yönetici cevap alımını durdurdu.
              Cevaplar yeniden açıldığında soru burada görünecek.
            </p>
          </div>
          ${waitingFooter('Yöneticinin cevapları açması bekleniyor')}
        </div>
      </section>`;
  }

  function renderError() {
    screenEl.innerHTML = `
      <section class="screen">
        <div class="hero">
          <div class="logo-mark" style="animation:none">⚠️</div>
          <h1>Bir sorun oldu</h1>
          <p class="muted">${esc(S.error || 'Bağlantı kurulamadı.')}</p>
        </div>
        <button class="btn btn-primary btn-lg" id="retry" type="button">Tekrar dene</button>
        <button class="btn btn-quiet btn-sm" id="new-code" type="button">Farklı kod ile katıl</button>
      </section>`;
    document.getElementById('retry').addEventListener('click', () => {
      if (S.code) loadEvent(S.code);
      else renderCode();
    });
    document.getElementById('new-code').addEventListener('click', () => {
      S.code = null;
      S.error = '';
      history.replaceState(null, '', '/');
      renderCode();
    });
  }

  // ---------------------------------------------------------------------------
  // Yönlendirme / durum
  // ---------------------------------------------------------------------------

  function render() {
    if (S.deleted) return renderDeleted();
    const snap = S.snapshot;
    if (!snap) return;

    const phase = snap.phase;
    if (snap.settings?.acceptingResponses === false && phase !== 'ended' && phase !== 'results' && phase !== 'done') {
      return renderClosed();
    }
    if (phase === 'question' && snap.question) renderQuestion();
    else if (phase === 'results' && snap.question) renderResults();
    else if (phase === 'done') renderDone();
    else if (phase === 'ended') renderEnded();
    else renderWaiting();
    tickTimers();
  }

  function applyState(next) {
    if (!next) return;
    S.snapshot = next;
    if (next.serverNow) S.serverOffset = next.serverNow - Date.now();

    if (next.you) {
      S.me = { id: next.you.id, name: next.you.name, score: next.you.score };
      S.myAnswers = { ...(next.you.answers || {}) };
      S.token = S.token || savedPlayer()?.token || null;
      S.name = next.you.name || S.name;
      savePlayer();
    }

    if (next.title) S.event = { ...(S.event || {}), title: next.title, code: next.code };

    if (!S.joined) return;

    // Sunucu bizi tanımıyorsa (ör. oturum sıfırlandı) yeniden katıl.
    if (!next.you && next.phase !== 'ended') {
      scheduleRejoin();
    }

    const sig = [
      next.code,
      next.phase,
      next.question?.id || '',
      next.you?.progress ?? next.current,
      next.you?.answered ? 1 : 0,
      next.you?.done ? 1 : 0,
      next.title || '',
      next.settings?.acceptingResponses !== false,
    ].join('|');
    if (sig !== S.phaseSig) {
      S.phaseSig = sig;
      S.draft = null;
      render();
    } else {
      updateLive(next);
    }
  }

  function statsSignature(snap) {
    return JSON.stringify([snap.question?.stats || null, snap.leaderboard || []]);
  }

  function updateLive(next) {
    document.querySelectorAll('[data-participants]').forEach((el) => {
      el.textContent = String(next.participants ?? 0);
    });
    const waitingCount = document.querySelector('[data-waiting-count]');
    if (waitingCount) waitingCount.textContent = String(next.participants ?? 0);

    // Sonuç ekranındayken başka katılımcıların cevapları canlı yansısın.
    if (next.phase === 'results' && next.question) {
      const sig = statsSignature(next);
      if (sig !== S.statsSig) {
        S.statsSig = sig;
        renderResults();
      }
    }

    // "Canlı sonuçlar" açıksa soru ekranındaki dağılım da güncel kalsın.
    const liveRoot = document.getElementById('live-results-root');
    if (liveRoot && next.phase === 'question' && next.question) {
      const show = next.settings?.liveResults && next.question.stats;
      const sig = show ? JSON.stringify(next.question.stats) : '';
      if (liveRoot.dataset.sig !== sig) {
        liveRoot.dataset.sig = sig;
        liveRoot.innerHTML = show ? liveResultsHtml(next.question.stats) : '';
      }
    }
    tickTimers();
  }

  function scheduleRejoin() {
    if (S.rejoinTimer) return;
    S.rejoinTimer = setTimeout(() => {
      S.rejoinTimer = null;
      if (S.code && S.name) {
        S.phaseSig = '';
        join(true);
      }
    }, 1500);
  }

  // ---------------------------------------------------------------------------
  // Ağ işlemleri
  // ---------------------------------------------------------------------------

  async function loadEvent(code) {
    S.error = '';
    S.view = 'loading';
    renderJoining();
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(code)}`, { headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Etkinlik bulunamadı.');

      S.event = data;
      S.code = data.code || code;
      S.snapshot = null;
      S.phaseSig = '';

      const saved = savedPlayer();
      if (saved?.token && saved?.name) {
        S.token = saved.token;
        S.name = saved.name;
        S.view = 'joining';
        renderJoining();
        join();
        return;
      }
      if (data.joinClosed) {
        S.error = 'Bu oturuma yeni katılım kapalı.';
        renderCode();
        return;
      }
      if (data.acceptingResponses === false) {
        S.error = 'Bu etkinlik şu anda cevap almıyor.';
        renderCode();
        return;
      }
      S.name = readStorage('co:name', '') || '';
      renderName();
    } catch (err) {
      S.error = err.message || 'Etkinlik bulunamadı.';
      S.view = 'error';
      renderCode();
    }
  }

  function join(isRejoin = false) {
    if (!S.code || !S.name) return;
    if (S.joining) return;
    S.joining = true;
    setNet(true);
    if (!socket.connected) socket.connect();

    const payload = { code: S.code, name: S.name, token: S.token || savedPlayer()?.token || '' };
    socket.timeout(10000).emit('player:join', payload, (err, res) => {
      S.joining = false;
      if (err) {
        S.error = 'Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.';
        S.view = 'error';
        renderError();
        return;
      }
      if (!res?.ok) {
        const message = res?.error || 'Oturuma katılınamadı.';
        if (/bulunamadı|kapalı|dolu|cevap almıyor/i.test(message)) {
          S.error = message;
          S.joined = false;
          S.token = null;
          if (/bulunamadı|cevap almıyor/i.test(message)) {
            if (/bulunamadı/i.test(message)) S.event = null;
            renderCode();
          } else {
            renderName();
          }
          return;
        }
        S.error = message;
        renderName();
        return;
      }

      S.joined = true;
      S.view = '';
      S.token = res.token;
      S.me = res.state?.you ? { ...res.state.you } : S.me;
      S.myAnswers = { ...(res.state?.you?.answers || {}) };
      savePlayer();
      S.error = '';
      S.phaseSig = '';
      applyState(res.state);
    });
  }

  function submitAnswer(value) {
    if (S.submitting) return;
    const q = S.snapshot?.question;
    if (!q) return;
    S.submitting = true;

    socket.timeout(10000).emit('player:answer', { qid: q.id, value }, (err, res) => {
      S.submitting = false;
      if (err) {
        toast('Cevap gönderilemedi. Bağlantını kontrol et.', 'bad');
        return;
      }
      if (!res?.ok) {
        if (res?.state) {
          S.snapshot = res.state;
          if (res.state.you) {
            S.myAnswers = { ...(res.state.you.answers || {}) };
            S.me = { id: res.state.you.id, name: res.state.you.name, score: res.state.you.score };
          }
        }
        if (res?.code === 'already' || res?.code === 'expired' || res?.code === 'stale') {
          S.phaseSig = '';
          render();
          if (res?.code !== 'expired') toast(res?.error || '', 'bad');
          return;
        }
        if (res?.code === 'closed') {
          S.phaseSig = '';
          render();
          toast(res?.error || 'Cevaplar kapalı.', 'bad');
          return;
        }
        toast(res?.error || 'Cevap gönderilemedi.', 'bad');
        tickTimers();
        return;
      }
      S.myAnswers[q.id] = res.value;
      if (res.state) {
        S.snapshot = res.state;
        if (res.state.serverNow) S.serverOffset = res.state.serverNow - Date.now();
      }
      S.phaseSig = '';
      render();
    });
  }

  function requestSync() {
    if (!S.joined || S.view === 'joining') return;
    socket.timeout(8000).emit('player:sync', {}, (err, res) => {
      if (err || !res?.ok || !res.state) return;
      applyState(res.state);
    });
  }

  function advanceQuestion() {
    if (S.submitting || !S.joined) return;
    S.submitting = true;
    socket.timeout(10000).emit('player:next', {}, (err, res) => {
      S.submitting = false;
      if (err) {
        toast('Bağlantı kurulamadı. Tekrar dene.', 'bad');
        return;
      }
      if (!res?.ok) {
        if (res?.state) applyState(res.state);
        toast(res?.error || 'Sonraki soruya geçilemedi.', 'bad');
        return;
      }
      if (res?.state) {
        S.snapshot = res.state;
        if (res.state.serverNow) S.serverOffset = res.state.serverNow - Date.now();
        if (res.state.you) {
          S.myAnswers = { ...(res.state.you.answers || {}) };
          S.me = { id: res.state.you.id, name: res.state.you.name, score: res.state.you.score };
        }
        S.phaseSig = '';
        S.draft = null;
        render();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Socket olayları
  // ---------------------------------------------------------------------------

  socket.on('connect', () => {
    setNet(true);
    if (S.joined && S.code && S.name) {
      S.joined = false;
      S.phaseSig = '';
      join(true);
    }
  });

  socket.on('disconnect', () => setNet(false));
  socket.on('connect_error', () => setNet(false));

  socket.on('state', (next) => {
    if (!next || S.view === 'joining' || !S.joined) return;
    applyState(next);
  });

  socket.on('presence', (data) => {
    if (!S.snapshot || !data) return;
    S.snapshot.participants = data.participants;
    updateLive(S.snapshot);
  });

  socket.on('deleted', () => {
    S.deleted = true;
    S.joined = false;
    renderDeleted();
  });

  socket.on('codeChanged', ({ oldCode, code }) => {
    if (!code || oldCode !== S.code) return;
    const saved = savedPlayer();
    S.code = code;
    if (saved) {
      writeStorage(`co:player:${code}`, saved);
      removeStorage(`co:player:${oldCode}`);
    }
    if (S.event) S.event.code = code;
    if (S.snapshot) S.snapshot.code = code;
    history.replaceState(null, '', `/j/${code}`);
    S.phaseSig = '';
    render();
    toast(`Etkinlik kodu değişti: ${code}`, 'good');
  });

  // ---------------------------------------------------------------------------
  // Başlangıç
  // ---------------------------------------------------------------------------

  const initialCode = codeFromLocation();
  if (initialCode) {
    S.code = initialCode;
    loadEvent(initialCode);
  } else {
    renderCode();
  }

  window.addEventListener('pageshow', () => {
    if (!socket.connected && S.joined) socket.connect();
  });
})();
