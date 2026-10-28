import { randomToken, cleanText, clampInt, newId, isSafeId } from './util.js';

export const QUESTION_TYPES = ['mc', 'quiz', 'truefalse', 'open', 'wordcloud', 'rating'];
export const LIMITS = {
  questions: 60,
  options: 10,
  participants: 5000,
  prompt: 240,
  optionText: 100,
  openText: 300,
  wordText: 40,
  name: 24,
};

export const TYPE_LABELS = {
  mc: 'Oylama (çoktan seçmeli)',
  quiz: 'Quiz (puanlı)',
  truefalse: 'Doğru / Yanlış',
  open: 'Açık uçlu',
  wordcloud: 'Kelime bulutu',
  rating: 'Puanlama (1-5)',
};

const DEFAULTS = {
  showLeaderboard: true,
  liveResults: false,
  autoLock: true,
  allowChange: false,
  joinClosed: false,
  acceptingResponses: true,
};

export function sanitizeSettings(input = {}) {
  const settings = { ...DEFAULTS };
  if (input && typeof input === 'object') {
    for (const key of Object.keys(DEFAULTS)) {
      if (typeof input[key] === 'boolean') settings[key] = input[key];
    }
  }
  return settings;
}

function makeOptions(input, type) {
  if (type === 'truefalse') {
    return [
      { id: 'true', text: 'Doğru' },
      { id: 'false', text: 'Yanlış' },
    ];
  }
  if (type === 'open' || type === 'wordcloud' || type === 'rating') return [];

  const source = Array.isArray(input) ? input.slice(0, LIMITS.options) : [];
  const options = [];
  const used = new Set();
  source.forEach((raw, index) => {
    const text = cleanText(typeof raw === 'object' && raw ? raw.text : raw, LIMITS.optionText);
    if (!text) return;
    let id = typeof raw === 'object' && raw && isSafeId(raw.id) ? raw.id : `o${index + 1}`;
    while (used.has(id)) id = `o${index + 1}-${Math.random().toString(36).slice(2, 5)}`;
    used.add(id);
    options.push({ id, text });
  });

  // En az 2 seçenek olsun.
  let n = 1;
  while (options.length < 2) {
    options.push({ id: `o${n}`, text: `Seçenek ${n}` });
    n += 1;
  }
  return options;
}

export function sanitizeQuestions(input) {
  if (!Array.isArray(input)) return [];
  const seenIds = new Set();
  const questions = [];

  input.slice(0, LIMITS.questions).forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const type = QUESTION_TYPES.includes(raw.type) ? raw.type : 'mc';
    const prompt = cleanText(raw.prompt, LIMITS.prompt);
    if (!prompt) return;

    let id = isSafeId(raw.id) ? raw.id : `q_${newId('x').slice(2)}`;
    while (seenIds.has(id)) id = `q_${newId('x').slice(2)}`;
    seenIds.add(id);

    const options = makeOptions(raw.options, type);
    let correctId = null;
    if (type === 'quiz' || type === 'truefalse') {
      correctId = options.some((o) => o.id === raw.correctId) ? raw.correctId : options[0].id;
    }

    questions.push({
      id,
      type,
      prompt,
      options,
      correctId,
      multi: type === 'mc' && raw.multi === true,
      timeLimit: clampInt(raw.timeLimit, 0, 900, 0),
      points: clampInt(raw.points, 100, 10000, 1000),
      maxLength:
        type === 'open'
          ? clampInt(raw.maxLength, 40, 1000, LIMITS.openText)
          : type === 'wordcloud'
            ? clampInt(raw.maxLength, 10, 80, LIMITS.wordText)
            : 0,
      note: cleanText(raw.note, 300),
    });
  });

  return questions;
}

export function createEvent({ title, questions, settings, ownerId = null } = {}) {
  const now = Date.now();
  return {
    code: '',
    hostKey: randomToken(18),
    ownerId,
    title: cleanText(title, 100) || 'Canlı Oturum',
    createdAt: now,
    updatedAt: now,
    phase: 'lobby',
    current: -1,
    startedAt: {},
    questions: sanitizeQuestions(questions),
    participants: [],
    settings: sanitizeSettings(settings),
  };
}

export function updateEvent(ev, patch = {}) {
  if (typeof patch.title === 'string') {
    ev.title = cleanText(patch.title, 100) || ev.title;
  }
  if (patch.questions !== undefined) {
    ev.questions = sanitizeQuestions(patch.questions);
    // Silinen soruların başlangıç zamanlarını temizle.
    const ids = new Set(ev.questions.map((q) => q.id));
    for (const id of Object.keys(ev.startedAt)) if (!ids.has(id)) delete ev.startedAt[id];
    if (!ev.questions.length) {
      ev.current = -1;
      ev.phase = 'lobby';
    } else if (ev.current >= ev.questions.length) {
      ev.current = ev.questions.length - 1;
      ev.phase = 'lobby';
    }
  }
  if (patch.settings && typeof patch.settings === 'object') {
    for (const key of Object.keys(DEFAULTS)) {
      if (typeof patch.settings[key] === 'boolean') ev.settings[key] = patch.settings[key];
    }
  }
  ev.updatedAt = Date.now();
  return ev;
}

export function getAnswer(participant, qid) {
  const raw = participant?.answers?.[qid];
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'object' && 'v' in raw) return { v: raw.v, at: raw.at || 0 };
  return { v: raw, at: 0 };
}

/**
 * Katılımcının kendi hızında ilerlediği soru.
 * `progress`, katılımcının ekranındaki sorunun sıfır tabanlı indeksidir.
 */
export function participantQuestion(ev, participant) {
  if (!ev || !participant || ev.phase === 'lobby' || !ev.questions.length) return null;
  const raw = Number.isInteger(participant.progress) ? participant.progress : 0;
  const index = Math.max(0, Math.min(raw, ev.questions.length - 1));
  return { index, q: ev.questions[index] };
}

export function questionStartedAt(ev, participant, qid) {
  return participant?.qStartedAt?.[qid] || ev?.startedAt?.[qid] || 0;
}

export function isQuestionExpired(ev, participant, q) {
  if (!q || !q.timeLimit) return false;
  const start = questionStartedAt(ev, participant, q.id);
  return !!start && Date.now() >= start + q.timeLimit * 1000;
}

/** Katılımcıyı bir sonraki soruya geçirir. Cevap verilmeden/süre dolmadan geçilemez. */
export function advanceParticipant(ev, participant) {
  const current = participantQuestion(ev, participant);
  if (!current) return { ok: false, error: 'Şu anda açık bir soru yok.' };
  if (ev.phase !== 'live') return { ok: false, error: 'Oturum şu anda ilerlemiyor.' };

  const answered = !!getAnswer(participant, current.q.id);
  const expired = isQuestionExpired(ev, participant, current.q);
  if (!answered && !expired) {
    return { ok: false, error: 'Önce cevabını gönder veya sürenin dolmasını bekle.' };
  }

  const nextIndex = current.index + 1;
  if (nextIndex >= ev.questions.length) {
    participant.progress = current.index;
    participant.done = true;
    participant.finishedAt = Date.now();
    ev.updatedAt = Date.now();
    return { ok: true, done: true };
  }

  participant.progress = nextIndex;
  participant.done = false;
  participant.qStartedAt = participant.qStartedAt || {};
  const nextQ = ev.questions[nextIndex];
  if (!participant.qStartedAt[nextQ.id]) participant.qStartedAt[nextQ.id] = Date.now();
  ev.updatedAt = Date.now();
  return { ok: true };
}

/** Eski (sunucu kontrollü) kayıtları yeni kendi hızında akışa uyarlar. */
export function normalizeEvent(ev) {
  if (!ev || typeof ev !== 'object') return ev;
  if (ev.phase === 'question' || ev.phase === 'results') ev.phase = 'live';
  if (!Array.isArray(ev.questions)) ev.questions = [];
  if (!ev.startedAt || typeof ev.startedAt !== 'object') ev.startedAt = {};
  for (const participant of Array.isArray(ev.participants) ? ev.participants : []) {
    if (!participant.qStartedAt || typeof participant.qStartedAt !== 'object') {
      participant.qStartedAt = {};
    }
    if (!Number.isInteger(participant.progress)) {
      let index = 0;
      while (index < ev.questions.length && getAnswer(participant, ev.questions[index].id)) {
        index += 1;
      }
      participant.progress = Math.min(index, Math.max(0, ev.questions.length - 1));
      participant.done = ev.questions.length > 0 && index >= ev.questions.length;
    }
  }
  return ev;
}

export function validateAnswer(q, value) {
  if (!q) return null;
  switch (q.type) {
    case 'mc':
    case 'quiz':
    case 'truefalse': {
      if (q.multi) {
        if (!Array.isArray(value)) return null;
        const selected = new Set(
          value.filter((id) => typeof id === 'string' && q.options.some((o) => o.id === id)),
        );
        return selected.size ? [...selected] : null;
      }
      if (typeof value !== 'string') return null;
      return q.options.some((o) => o.id === value) ? value : null;
    }
    case 'open': {
      const text = cleanText(value, q.maxLength || LIMITS.openText);
      return text || null;
    }
    case 'wordcloud': {
      const text = cleanText(value, q.maxLength || LIMITS.wordText);
      return text || null;
    }
    case 'rating': {
      const n = Number(value);
      return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
    }
    default:
      return null;
  }
}

function collectAnswers(ev, qid) {
  const out = [];
  for (const p of ev.participants) {
    const a = getAnswer(p, qid);
    if (a) out.push({ pid: p.id, name: p.name, value: a.v, at: a.at });
  }
  return out;
}

export function computeStats(ev, q) {
  if (!q) return null;
  const items = collectAnswers(ev, q.id);

  if (q.type === 'mc' || q.type === 'quiz' || q.type === 'truefalse') {
    const counts = new Map(q.options.map((o) => [o.id, 0]));
    let valid = 0;
    let selections = 0;
    for (const item of items) {
      const values = Array.isArray(item.value) ? item.value : [item.value];
      const picked = new Set();
      for (const value of values) {
        if (counts.has(value) && !picked.has(value)) {
          picked.add(value);
          counts.set(value, counts.get(value) + 1);
          selections += 1;
        }
      }
      if (picked.size) valid += 1;
    }
    return {
      kind: 'choice',
      total: valid,
      selections,
      options: q.options.map((o) => ({ id: o.id, text: o.text, count: counts.get(o.id) || 0 })),
    };
  }

  if (q.type === 'rating') {
    const dist = [1, 2, 3, 4, 5].map((value) => ({ value, count: 0 }));
    let sum = 0;
    let total = 0;
    for (const item of items) {
      const n = Number(item.value);
      if (Number.isInteger(n) && n >= 1 && n <= 5) {
        dist[n - 1].count += 1;
        sum += n;
        total += 1;
      }
    }
    return {
      kind: 'rating',
      total,
      avg: total ? Math.round((sum / total) * 10) / 10 : 0,
      distribution: dist,
    };
  }

  const groups = new Map();
  let order = 0;
  for (const item of items) {
    let text = String(item.value || '').trim();
    if (!text) continue;
    if (q.type === 'wordcloud') text = text.replace(/\s+/g, ' ');
    const key = text.toLocaleLowerCase('tr');
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { text, count: 1, order: order++ });
    }
  }

  const list = [...groups.values()].sort((a, b) => b.count - a.count || a.order - b.order);

  if (q.type === 'wordcloud') {
    return { kind: 'wordcloud', total: list.reduce((s, w) => s + w.count, 0), words: list.slice(0, 120) };
  }

  return {
    kind: 'open',
    total: list.reduce((s, w) => s + w.count, 0),
    items: list.slice(0, 200),
    unique: list.length,
  };
}

export function recomputeScores(ev) {
  const scores = new Map(ev.participants.map((p) => [p.id, 0]));
  const quizQuestions = ev.questions.filter((q) => q.type === 'quiz' && q.correctId);

  for (const q of quizQuestions) {
    for (const p of ev.participants) {
      const a = getAnswer(p, q.id);
      if (!a || a.v !== q.correctId) continue;
      let factor = 1;
      const start = questionStartedAt(ev, p, q.id);
      if (q.timeLimit > 0 && start > 0) {
        const elapsed = Math.max(0, (a.at - start) / 1000);
        factor = 0.5 + 0.5 * Math.max(0, Math.min(1, 1 - elapsed / q.timeLimit));
      }
      scores.set(p.id, (scores.get(p.id) || 0) + Math.round(q.points * factor));
    }
  }

  for (const p of ev.participants) p.score = scores.get(p.id) || 0;
  return ev.participants;
}

export function leaderboard(ev, limit = 10) {
  recomputeScores(ev);
  return [...ev.participants]
    .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
    .slice(0, limit)
    .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, score: p.score }));
}

function currentQuestion(ev) {
  if (!Number.isInteger(ev.current) || ev.current < 0) return null;
  return ev.questions[ev.current] || null;
}

export function hostSnapshot(ev, { online = 0, onlineIds = null, publicUrl = null } = {}) {
  const q = currentQuestion(ev);
  const start = q ? ev.startedAt?.[q.id] || 0 : 0;
  return {
    role: 'host',
    code: ev.code,
    title: ev.title,
    phase: ev.phase,
    current: ev.current,
    total: ev.questions.length,
    questions: ev.questions,
    settings: ev.settings,
    createdAt: ev.createdAt,
    participants: ev.participants.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score || 0,
      joinedAt: p.joinedAt,
      lastSeen: p.lastSeen || 0,
      answered: Object.keys(p.answers || {}).length,
      progress: p.done ? ev.questions.length : Math.min(p.progress || 0, ev.questions.length),
      done: !!p.done,
      online: onlineIds ? onlineIds.has(p.id) : !!p.online,
    })),
    stats: q ? computeStats(ev, q) : null,
    leaderboard: leaderboard(ev, 10),
    answeredByQuestion: Object.fromEntries(
      ev.questions.map((question) => [
        question.id,
        ev.participants.reduce((count, p) => count + (getAnswer(p, question.id) ? 1 : 0), 0),
      ]),
    ),
    progressCounts: ev.questions.map((_, index) =>
      ev.participants.reduce((count, p) => {
        const at = p.done ? ev.questions.length : p.progress || 0;
        return count + (at === index ? 1 : 0);
      }, 0),
    ),
    finished: ev.participants.reduce((count, p) => count + (p.done ? 1 : 0), 0),
    serverNow: Date.now(),
    startedAt: start || null,
    deadline: q && q.timeLimit > 0 && start ? start + q.timeLimit * 1000 : null,
    online,
    publicUrl,
  };
}

export function publicSnapshot(ev, pid = null, { publicUrl = null } = {}) {
  const player = pid ? ev.participants.find((p) => p.id === pid) : null;
  const current = participantQuestion(ev, player);
  const q = current?.q || null;
  const index = current ? current.index : -1;
  const start = q ? questionStartedAt(ev, player, q.id) : 0;
  const answered = !!(player && q && getAnswer(player, q.id));
  const expired = !!(player && q && isQuestionExpired(ev, player, q));
  const revealed = answered || expired;
  const showStats = revealed || ev.settings.liveResults;
  const finished = !!player?.done;

  const answers = {};
  if (player) {
    for (const [qid, raw] of Object.entries(player.answers || {})) {
      answers[qid] = raw && typeof raw === 'object' && 'v' in raw ? raw.v : raw;
    }
  }

  let rank = null;
  if (player) {
    recomputeScores(ev);
    const ordered = [...ev.participants].sort(
      (a, b) => (b.score || 0) - (a.score || 0) || a.joinedAt - b.joinedAt,
    );
    rank = ordered.findIndex((p) => p.id === player.id) + 1 || null;
  }

  // Katılımcı ekranının durumu tamamen kişiseldir: herkes kendi sorusunda,
  // kendi süresinde ve kendi cevap durumundadır.
  const phase =
    ev.phase === 'lobby'
      ? 'lobby'
      : ev.phase === 'ended'
        ? 'ended'
        : finished
          ? 'done'
          : revealed
            ? 'results'
            : 'question';

  const leaderboardVisible = finished || revealed || ev.phase === 'ended';

  return {
    role: 'player',
    code: ev.code,
    title: ev.title,
    phase,
    eventPhase: ev.phase,
    current: index,
    total: ev.questions.length,
    participants: ev.participants.length,
    question: q
      ? {
          id: q.id,
          index,
          type: q.type,
          prompt: q.prompt,
          options: q.options,
          multi: !!q.multi,
          points: q.points,
          maxLength: q.maxLength,
          timeLimit: q.timeLimit,
          note: q.note,
          startedAt: start || null,
          deadline: q.timeLimit > 0 && start ? start + q.timeLimit * 1000 : null,
          answered,
          expired,
          // Doğru cevap yalnızca katılımcı cevap verdikten/süre dolduktan sonra açılır.
          correctId: revealed ? q.correctId : null,
          stats: showStats ? computeStats(ev, q) : null,
        }
      : null,
    leaderboard:
      leaderboardVisible && ev.settings.showLeaderboard ? leaderboard(ev, 5) : [],
    settings: {
      showLeaderboard: ev.settings.showLeaderboard,
      liveResults: ev.settings.liveResults,
      joinClosed: ev.settings.joinClosed,
      acceptingResponses: ev.settings.acceptingResponses,
    },
    serverNow: Date.now(),
    publicUrl,
    you: player
      ? {
          id: player.id,
          name: player.name,
          score: player.score || 0,
          rank,
          answers,
          progress: index,
          answered,
          expired,
          done: finished,
        }
      : null,
  };
}

export function applyAction(ev, type, payload = {}) {
  if (!ev.settings.acceptingResponses && type === 'start') {
    return { ok: false, error: 'Etkinlik cevap almaya kapalı. Önce "Cevaplara aç" düğmesini kullanın.' };
  }
  switch (type) {
    case 'start': {
      if (!ev.questions.length) return { ok: false, error: 'Önce en az bir soru ekleyin.' };
      const now = Date.now();
      ev.phase = 'live';
      ev.current = 0;
      ev.startedAt = {};
      // Herkes ilk sorudan kendi hızında başlar.
      for (const p of ev.participants) {
        p.answers = {};
        p.score = 0;
        p.progress = 0;
        p.qStartedAt = {};
        p.done = false;
        delete p.finishedAt;
      }
      ev.startedAt[ev.questions[0].id] = now;
      ev.updatedAt = now;
      return { ok: true };
    }
    case 'lock':
    case 'revealAll': {
      // Katılımcılar cevap verince sonuçları kendiliğinden görür.
      ev.updatedAt = Date.now();
      return { ok: true };
    }
    case 'next': {
      if (ev.phase === 'lobby') return applyAction(ev, 'start');
      if (!ev.questions.length) return { ok: false, error: 'Soru yok.' };
      ev.current = Math.min(Math.max(0, ev.current) + 1, ev.questions.length - 1);
      ev.updatedAt = Date.now();
      return { ok: true };
    }
    case 'back': {
      if (ev.phase === 'lobby') return { ok: false, error: 'Henüz başlamadı.' };
      ev.current = Math.max(0, Math.min(ev.current, ev.questions.length - 1) - 1);
      ev.updatedAt = Date.now();
      return { ok: true };
    }
    case 'goto': {
      const index = Number(payload.index);
      if (!Number.isInteger(index) || index < 0 || index >= ev.questions.length) {
        return { ok: false, error: 'Geçersiz soru.' };
      }
      ev.current = index;
      ev.updatedAt = Date.now();
      return { ok: true };
    }
    case 'end': {
      ev.phase = 'ended';
      ev.updatedAt = Date.now();
      return { ok: true };
    }
    case 'restart': {
      ev.phase = 'lobby';
      ev.current = -1;
      ev.startedAt = {};
      ev.participants = [];
      ev.updatedAt = Date.now();
      return { ok: true };
    }
    case 'resetAnswers': {
      const q = currentQuestion(ev);
      if (!q) return { ok: false, error: 'Soru yok.' };
      const index = ev.current;
      const now = Date.now();
      for (const p of ev.participants) {
        delete p.answers?.[q.id];
        if (p.progress === index && p.qStartedAt) p.qStartedAt[q.id] = now;
      }
      ev.updatedAt = now;
      return { ok: true };
    }
    case 'resetLobby': {
      // Cevapları koruyarak oturumu başa al (soruları değiştirmek için).
      ev.phase = 'lobby';
      ev.current = -1;
      ev.updatedAt = Date.now();
      return { ok: true };
    }
    default:
      return { ok: false, error: 'Bilinmeyen işlem.' };
  }
}

export function registerParticipant(ev, { name, token, socketId }) {
  const existing = token ? ev.participants.find((p) => p.token === token) || null : null;
  if (!existing && !ev.settings.acceptingResponses) return { ok: false, error: 'Bu etkinlik şu anda cevap almıyor.' };
  if (!existing && ev.settings.joinClosed) return { ok: false, error: 'Katılım kapalı.' };
  if (ev.participants.length >= LIMITS.participants) {
    return { ok: false, error: 'Oturum katılımcı sınırına ulaştı.' };
  }

  const cleanName = cleanText(name, LIMITS.name);
  if (cleanName.length < 2) return { ok: false, error: 'Lütfen adınızı yazın (en az 2 karakter).' };

  let player = existing;
  const resumed = !!player;

  if (player) {
    player.name = cleanName;
    player.lastSeen = Date.now();
    if (socketId) player.socketId = socketId;
  } else {
    player = {
      id: newId('p'),
      token: randomToken(18),
      name: cleanName,
      joinedAt: Date.now(),
      lastSeen: Date.now(),
      socketId: socketId || null,
      score: 0,
      answers: {},
    };
    ev.participants.push(player);
  }

  // Katılımcı, oturum canlıyken katıldıysa ilk cevaplanmamış sorudan başlar.
  player.qStartedAt = player.qStartedAt || {};
  if (!Number.isInteger(player.progress)) {
    let index = 0;
    while (index < ev.questions.length && getAnswer(player, ev.questions[index].id)) {
      index += 1;
    }
    player.progress = Math.min(index, Math.max(0, ev.questions.length - 1));
    player.done = ev.questions.length > 0 && index >= ev.questions.length;
  }
  if (ev.phase !== 'lobby') {
    const q = ev.questions[player.progress];
    if (q && !player.qStartedAt[q.id]) player.qStartedAt[q.id] = Date.now();
  }

  ev.updatedAt = Date.now();
  return { ok: true, player, resumed };
}

export function removeParticipant(ev, pid) {
  const index = ev.participants.findIndex((p) => p.id === pid);
  if (index === -1) return false;
  ev.participants.splice(index, 1);
  ev.updatedAt = Date.now();
  return true;
}
