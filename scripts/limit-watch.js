#!/usr/bin/env node
'use strict';
//
// fractera-limit-watch — сторож лимита подписки Claude Code.
//
// Читает журнал сессии, который Claude Code пишет сам, и при отказе по квоте
// шлёт владельцу в Telegram два сообщения: «лимит исчерпан, сброс в HH:MM»
// и, по будильнику, «лимиты сброшены». Искусственный интеллект не участвует:
// разбор JSON, таймер, HTTP.
//
// ЗАПРЕТ, КОТОРЫЙ НЕЛЬЗЯ СНИМАТЬ: только sendMessage, НИКОГДА getUpdates.
//    Telegram отдаёт каждое обновление ровно одному читателю. Один вызов
//    getUpdates отсюда — и сообщения владельца начнут МОЛЧА делиться пополам
//    между плагином каналов и этим сторожем. Опрашиватель у бота ровно один,
//    и это не он.
//
// ЗАВИСИМОСТЕЙ НЕТ И НЕ ДОЛЖНО ПОЯВИТЬСЯ: node:https вместо fetch (работает
//    на любой версии Node), время форматируется вручную вместо toLocaleString
//    (сборка Node может быть без полной ICU, и 'ru-RU' молча выродится в C).

const fs = require('fs');
const path = require('path');
const https = require('https');

const SELFTEST = process.argv.includes('--selftest');

const WATCH_DIR = SELFTEST
  ? '/tmp/limit-watch-selftest'
  : '/root/.claude/projects/-opt-fractera-agent-workspace';
const STATE_FILE = SELFTEST
  ? '/tmp/limit-watch-selftest/state.json'
  : '/opt/fractera/limit-watch-state.json';

const ENV_FILE = '/root/.claude/channels/telegram/.env';
const ACCESS_FILE = '/root/.claude/channels/telegram/access.json';

const POLL_MS = 5000;
const RESET_MARGIN_MS = 30000;          // запас после resetsAt: не объявлять готовность раньше сервера
const FRESH_WINDOW_MS = 30 * 60 * 1000; // запись старше — из прошлой жизни, не объявлять
const LATE_GUARD_MS = 6 * 3600 * 1000;  // просрочен больше чем на это — молча отбросить

function p2(n) { return String(n).padStart(2, '0'); }
function fmt(d) { return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
function log(m) { const d = new Date(); console.log('[' + fmt(d) + ':' + p2(d.getSeconds()) + '] ' + m); }

// ---------- доступы ----------

function readToken() {
  const txt = fs.readFileSync(ENV_FILE, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*TELEGRAM_BOT_TOKEN\s*=\s*(.*)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('TELEGRAM_BOT_TOKEN не найден в ' + ENV_FILE);
}

function readChatIds() {
  const j = JSON.parse(fs.readFileSync(ACCESS_FILE, 'utf8'));
  return (j.allowFrom || []).map(String);
}

// ---------- отправка ----------

function postOne(token, chatId, text, tries, cb) {
  const body = JSON.stringify({ chat_id: chatId, text: text, disable_web_page_preview: true });
  const req = https.request({
    hostname: 'api.telegram.org',
    port: 443,
    path: '/bot' + token + '/sendMessage',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
  }, function (res) {
    let buf = '';
    res.on('data', function (d) { buf += d; });
    res.on('end', function () {
      if (res.statusCode === 200) { log('отправлено -> ' + chatId); return cb(true); }
      log('Telegram ответил ' + res.statusCode + ': ' + buf.slice(0, 200));
      if (tries > 1) return setTimeout(function () { postOne(token, chatId, text, tries - 1, cb); }, 3000);
      cb(false);
    });
  });
  req.on('error', function (e) {
    log('сеть: ' + e.message);
    if (tries > 1) return setTimeout(function () { postOne(token, chatId, text, tries - 1, cb); }, 3000);
    cb(false);
  });
  req.write(body);
  req.end();
}

function send(text) {
  return new Promise(function (resolve) {
    let token, ids;
    try { token = readToken(); ids = readChatIds(); }
    catch (e) { log('ОШИБКА чтения доступов: ' + e.message); return resolve(false); }
    if (!ids.length) { log('некому писать: allowFrom пуст'); return resolve(false); }
    let left = ids.length, ok = true;
    ids.forEach(function (id) {
      postOne(token, id, text, 3, function (good) { ok = ok && good; if (--left === 0) resolve(ok); });
    });
  });
}

// ---------- состояние ----------

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return null; } }
function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function listFiles() {
  try {
    return fs.readdirSync(WATCH_DIR)
      .filter(function (f) { return f.endsWith('.jsonl'); })
      .map(function (f) { return path.join(WATCH_DIR, f); });
  } catch (e) { return []; }
}
function safeSize(f) { try { return fs.statSync(f).size; } catch (e) { return 0; } }

// ---------- разбор ----------

function windowName(t) {
  if (t === 'five_hour') return 'пятичасовое окно';
  if (t === 'weekly' || t === 'seven_day') return 'недельное окно';
  return 'лимит' + (t ? ' (' + t + ')' : '');
}

let state = null;
let timer = null;

function armTimer(resetsAt) {
  if (timer) clearTimeout(timer);
  const delay = Math.max(0, resetsAt * 1000 + RESET_MARGIN_MS - Date.now());
  timer = setTimeout(function () { fireReset(false); }, delay);
  log('будильник заведён: через ' + Math.round(delay / 1000) + ' с');
}

function fireReset(late) {
  timer = null;
  state.pendingResetsAt = null;
  saveState(state);
  let text = '✅ Лимиты сброшены.\n\nClaude Code снова отвечает — можете продолжать.';
  if (late) text += '\n\n(напоминание с опозданием: сторож был перезапущен)';
  log('объявляю сброс' + (late ? ' с опозданием' : ''));
  send(text).then(function () {
    if (SELFTEST) { log('===SELFTEST_DONE==='); setTimeout(function () { process.exit(0); }, 1000); }
  });
}

function onLimitHit(resetsAt, q) {
  state.announcedResetsAt = resetsAt;
  state.pendingResetsAt = resetsAt;
  saveState(state);
  const when = new Date(resetsAt * 1000);
  const mins = Math.max(0, Math.round((when.getTime() - Date.now()) / 60000));
  const text =
    '⛔ Лимит подписки исчерпан.\n\n' +
    'Claude Code не обработал ваше сообщение — упёрся в ' + windowName(q.rateLimitType) + '.\n' +
    'Сброс: ' + fmt(when) + ' (через ' + mins + ' мин).\n\n' +
    'Напомню, когда лимиты сбросятся.';
  log('ЛИМИТ: ' + windowName(q.rateLimitType) + ', сброс ' + fmt(when));
  send(text);
  armTimer(resetsAt);
}

function handleLine(line) {
  if (!line || line.indexOf('"quotaLimits"') === -1) return;
  let rec;
  try { rec = JSON.parse(line); } catch (e) { return; }
  const q = rec.quotaLimits || (rec.message && rec.message.quotaLimits);
  if (!q || q.status !== 'rejected') return;
  const resetsAt = Number(q.resetsAt);
  if (!resetsAt) return;
  const ts = Date.parse(rec.timestamp || '') || Date.now();
  if (Date.now() - ts > FRESH_WINDOW_MS) return;      // запись из прошлой жизни
  if (state.announcedResetsAt === resetsAt) return;   // уже объявлено
  onLimitHit(resetsAt, q);
}

function scanOnce() {
  for (const f of listFiles()) {
    const size = safeSize(f);
    let off = state.offsets[f] || 0;
    if (size < off) off = 0;            // файл усечён или подменён
    if (size === off) continue;
    let chunk;
    try {
      const fd = fs.openSync(f, 'r');
      const buf = Buffer.alloc(size - off);
      fs.readSync(fd, buf, 0, buf.length, off);
      fs.closeSync(fd);
      chunk = buf.toString('utf8');
    } catch (e) { continue; }
    const lastNl = chunk.lastIndexOf('\n');
    if (lastNl < 0) continue;           // строка ещё дописывается — подождём
    const complete = chunk.slice(0, lastNl);
    state.offsets[f] = off + Buffer.byteLength(complete, 'utf8') + 1;
    for (const line of complete.split('\n')) handleLine(line);
  }
  saveState(state);
}

// ---------- пуск ----------

if (SELFTEST) {
  fs.mkdirSync(WATCH_DIR, { recursive: true });
  for (const f of listFiles()) { try { fs.unlinkSync(f); } catch (e) {} }
  try { fs.unlinkSync(STATE_FILE); } catch (e) {}
}

state = loadState();
if (!state) {
  state = { offsets: {}, announcedResetsAt: null, pendingResetsAt: null };
  // ПЕРВЫЙ ЗАПУСК НЕ ПЕРЕИГРЫВАЕТ ПРОШЛОЕ: смещения ставятся на текущий конец
  // файлов. Иначе сторож в первую же секунду объявил бы вчерашний лимит.
  for (const f of listFiles()) state.offsets[f] = safeSize(f);
  saveState(state);
  log('первый запуск: прошлое не переигрывается, файлов ' + Object.keys(state.offsets).length);
}

if (state.pendingResetsAt) {
  const t = state.pendingResetsAt * 1000 + RESET_MARGIN_MS;
  if (t > Date.now()) { log('перезапуск: будильник восстановлен'); armTimer(state.pendingResetsAt); }
  else if (Date.now() - t < LATE_GUARD_MS) { log('перезапуск: сброс уже наступил, объявляю'); fireReset(true); }
  else { log('перезапуск: просроченный будильник отброшен'); state.pendingResetsAt = null; saveState(state); }
}

log('сторож лимита запущен · каталог ' + WATCH_DIR + (SELFTEST ? ' · РЕЖИМ ПРОВЕРКИ' : ''));
setInterval(scanOnce, POLL_MS);
scanOnce();

if (SELFTEST) {
  const secs = 45;
  const rec = {
    type: 'assistant',
    timestamp: new Date().toISOString(),
    error: 'rate_limit',
    isApiErrorMessage: true,
    apiErrorStatus: 429,
    quotaLimits: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + secs, rateLimitType: 'five_hour' },
    message: { role: 'assistant', content: [{ type: 'text', text: 'SELFTEST' }] }
  };
  fs.appendFileSync(path.join(WATCH_DIR, 'selftest.jsonl'), JSON.stringify(rec) + '\n');
  log('контроль: синтетическая запись положена, сброс через ' + secs + ' с');
}
