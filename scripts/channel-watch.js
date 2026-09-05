#!/usr/bin/env node
'use strict';
//
// fractera-channel-watch — сторож канала агента. Две обязанности, один процесс.
//
//   1) ЛИМИТ ПОДПИСКИ (было шагом 115-3): при отказе по квоте сказать в Telegram
//      точное время сброса и напомнить, когда оно наступит.
//   2) ЖИВОСТЬ ОПРАШИВАТЕЛЯ (новое, шаг 120): заметить, что бот перестал ЧИТАТЬ
//      сообщения, перезапустить канал и сказать об этом.
//
// ✗ ЧЕМ ОПЛАЧЕНА ВТОРАЯ ОБЯЗАННОСТЬ. За одни сутки канал замолчал ТРИЖДЫ, и все
// три раза молча: квота (02:32), модальный вопрос CLI (09:29, два часа), мёртвый
// опрашиватель (12:02). Каждый раз владелец узнавал об этом тем, что его
// игнорируют. Приборы при этом показывали «работает»: pm2 online, процесс жив,
// перезапусков ноль.
//
// 🔒 ПРИЗНАК ВЫБРАН ПО СМЫСЛУ, А НЕ ПО УДОБСТВУ: `pending_update_count`.
// Telegram сам говорит, сколько сообщений НИКТО не забрал. Здоровый опрашиватель
// разбирает очередь за секунду; очередь, не пустеющая минуту, означает ровно то,
// что волнует владельца: «моё сообщение не читают». Считать сокеты было бы
// дешевле и глупее — исправный клиент имеет право закрыть простаивающее
// соединение, и мы получили бы ложные тревоги на пустом месте.
//
// 🔒 ЗАПРЕТ, КОТОРЫЙ НЕЛЬЗЯ СНИМАТЬ: только `getWebhookInfo` и `sendMessage`,
// НИКОГДА `getUpdates`. Telegram отдаёт каждое обновление ровно одному читателю;
// один вызов getUpdates отсюда — и переписка владельца начнёт МОЛЧА делиться
// пополам между плагином и сторожем. `getWebhookInfo` очередь не трогает.
//
// 🔒 ЗАВИСИМОСТЕЙ НЕТ: node:https вместо fetch, время форматируется вручную
// вместо toLocaleString (сборка Node может быть без полной ICU).

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

const SELFTEST = process.argv.includes('--selftest');

const WATCH_DIR = SELFTEST
  ? '/tmp/channel-watch-selftest'
  : '/root/.claude/projects/-opt-fractera-agent-workspace';
const STATE_FILE = SELFTEST
  ? '/tmp/channel-watch-selftest/state.json'
  : '/opt/fractera/channel-watch-state.json';

const ENV_FILE = '/root/.claude/channels/telegram/.env';
const ACCESS_FILE = '/root/.claude/channels/telegram/access.json';

const POLL_MS = 5000;                    // журнал сессии
const HEALTH_MS = 60000;                 // очередь Telegram
const RESET_MARGIN_MS = 30000;
const FRESH_WINDOW_MS = 30 * 60 * 1000;
const LATE_GUARD_MS = 6 * 3600 * 1000;

// 🔒 ДВА ПОДРЯД, А НЕ ОДИН. Очередь бывает непустой законно: сообщение пришло в
// ту самую секунду, когда мы спросили. Две проверки с минутой между ними
// отсекают этот случай и оставляют настоящий отказ.
const DEAD_STRIKES = 2;
// 🔒 НЕ ЧАЩЕ РАЗА В 15 МИНУТ. Перезапуск, который не помог, не должен
// превратиться в бесконечный цикл перезапусков с телеграммой на каждый.
const RESTART_COOLDOWN_MS = 15 * 60 * 1000;

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

// ---------- сеть ----------

function apiGet(token, method, cb) {
  const req = https.request({
    hostname: 'api.telegram.org', port: 443,
    path: '/bot' + token + '/' + method, method: 'GET',
  }, res => {
    let buf = '';
    res.on('data', d => { buf += d; });
    res.on('end', () => {
      if (res.statusCode !== 200) return cb(new Error('HTTP ' + res.statusCode));
      try { cb(null, JSON.parse(buf)); } catch (e) { cb(e); }
    });
  });
  req.on('error', e => cb(e));
  req.end();
}

function postOne(token, chatId, text, tries, cb) {
  const body = JSON.stringify({ chat_id: chatId, text: text, disable_web_page_preview: true });
  const req = https.request({
    hostname: 'api.telegram.org', port: 443,
    path: '/bot' + token + '/sendMessage', method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
  }, res => {
    let buf = '';
    res.on('data', d => { buf += d; });
    res.on('end', () => {
      if (res.statusCode === 200) { log('отправлено -> ' + chatId); return cb(true); }
      log('Telegram ответил ' + res.statusCode + ': ' + buf.slice(0, 200));
      if (tries > 1) return setTimeout(() => postOne(token, chatId, text, tries - 1, cb), 3000);
      cb(false);
    });
  });
  req.on('error', e => {
    log('сеть: ' + e.message);
    if (tries > 1) return setTimeout(() => postOne(token, chatId, text, tries - 1, cb), 3000);
    cb(false);
  });
  req.write(body);
  req.end();
}

function send(text) {
  return new Promise(resolve => {
    let token, ids;
    try { token = readToken(); ids = readChatIds(); }
    catch (e) { log('ОШИБКА чтения доступов: ' + e.message); return resolve(false); }
    if (!ids.length) { log('некому писать: allowFrom пуст'); return resolve(false); }
    let left = ids.length, ok = true;
    ids.forEach(id => postOne(token, id, text, 3, good => { ok = ok && good; if (--left === 0) resolve(ok); }));
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
    return fs.readdirSync(WATCH_DIR).filter(f => f.endsWith('.jsonl')).map(f => path.join(WATCH_DIR, f));
  } catch (e) { return []; }
}
function safeSize(f) { try { return fs.statSync(f).size; } catch (e) { return 0; } }

let state = null;
let timer = null;

// ---------- обязанность 1: лимит подписки ----------

function windowName(t) {
  if (t === 'five_hour') return 'пятичасовое окно';
  if (t === 'weekly' || t === 'seven_day') return 'недельное окно';
  return 'лимит' + (t ? ' (' + t + ')' : '');
}

function armTimer(resetsAt) {
  if (timer) clearTimeout(timer);
  const delay = Math.max(0, resetsAt * 1000 + RESET_MARGIN_MS - Date.now());
  timer = setTimeout(() => fireReset(false), delay);
  log('будильник заведён: через ' + Math.round(delay / 1000) + ' с');
}

function fireReset(late) {
  timer = null;
  state.pendingResetsAt = null;
  saveState(state);
  let text = '✅ Лимиты сброшены.\n\nClaude Code снова отвечает — можете продолжать.';
  if (late) text += '\n\n(напоминание с опозданием: сторож был перезапущен)';
  log('объявляю сброс' + (late ? ' с опозданием' : ''));
  send(text).then(() => { if (SELFTEST) { log('===SELFTEST_LIMIT_DONE==='); } });
}

function onLimitHit(resetsAt, q) {
  state.announcedResetsAt = resetsAt;
  state.pendingResetsAt = resetsAt;
  saveState(state);
  const when = new Date(resetsAt * 1000);
  const mins = Math.max(0, Math.round((when.getTime() - Date.now()) / 60000));
  log('ЛИМИТ: ' + windowName(q.rateLimitType) + ', сброс ' + fmt(when));
  send('⛔ Лимит подписки исчерпан.\n\n' +
    'Claude Code не обработал ваше сообщение — упёрся в ' + windowName(q.rateLimitType) + '.\n' +
    'Сброс: ' + fmt(when) + ' (через ' + mins + ' мин).\n\n' +
    'Напомню, когда лимиты сбросятся.');
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
  if (Date.now() - ts > FRESH_WINDOW_MS) return;
  if (state.announcedResetsAt === resetsAt) return;
  onLimitHit(resetsAt, q);
}

function scanOnce() {
  for (const f of listFiles()) {
    const size = safeSize(f);
    let off = state.offsets[f] || 0;
    if (size < off) off = 0;
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
    if (lastNl < 0) continue;
    const complete = chunk.slice(0, lastNl);
    state.offsets[f] = off + Buffer.byteLength(complete, 'utf8') + 1;
    for (const line of complete.split('\n')) handleLine(line);
  }
  saveState(state);
}

// ---------- обязанность 2: живость опрашивателя ----------

function restartChannel(cb) {
  // 🔒 ПЕРЕЗАПУСК ЧЕРЕЗ pm2, А НЕ УБИЙСТВОМ ПРОЦЕССА. pm2 — хозяин канала; сняв
  // процесс мимо него, мы получили бы гонку между нашим `kill` и его подъёмом.
  execFile('/usr/bin/env', ['pm2', 'restart', 'fractera-agent-channel'],
    { timeout: 60000, env: Object.assign({}, process.env, { PATH: '/usr/local/bin:/usr/bin:/bin' }) },
    (err) => cb(err || null));
}

// 🔒 ВТОРОЙ ПРИЗНАК СМЕРТИ: ОПРАШИВАТЕЛЬ ЖИВ КАК ПРОЦЕСС И НЕ ДЕРЖИТ СВЯЗИ.
//
// ✗ ИЗМЕРЕНО 2026-09-05: через шесть минут после перезапуска процесс `bun` жив, а
// сокетов у него НЕТ НИ ОДНОГО — ни к Telegram, ни вообще. Двенадцать замеров за
// 36 секунд дали ноль. Это не паузы между опросами: long-poll держал бы
// соединение почти всегда.
//
// 🛑 СТОРОЖ-СИРОТА САМОГО ПЛАГИНА ЗДЕСЬ НИ ПРИ ЧЁМ, и это проверено чтением его
// исходника: его `shutdown()` всегда доходит до `process.exit(0)` за две секунды.
// Наш процесс жив — значит умер ЦИКЛ ОПРОСА, а не плагин.
//
// 🔒 ПОЧЕМУ ЭТОТ ПРИЗНАК ДОБАВЛЕН ВТОРЫМ, А НЕ ВМЕСТО ПЕРВОГО. Очередь Telegram
// отвечает на вопрос «моё сообщение не читают» и молчит, пока владелец не пишет.
// Этот — замечает смерть В ТИШИНЕ, до того как человек её обнаружит. Первый
// точнее, второй быстрее; нужны оба.
//
// 🛑 ТРИ ПРОВЕРКИ ПОДРЯД, А НЕ ОДНА: короткий разрыв связи бывает и у здорового
// клиента, и перезапуск на каждый чих хуже редкой паузы.
// 🛑 И ТОЛЬКО ЕСЛИ ОПРАШИВАТЕЛЬ ВООБЩЕ ЕСТЬ: канал, остановленный владельцем
// намеренно, поднимать против его воли нельзя.
const DEAD_SOCKET_STRIKES = 3;

function pollerAlive(cb) {
  execFile('/usr/bin/pgrep', ['-fc', 'bun run --cwd'], (err, out) => {
    cb(!err && Number(String(out).trim()) > 0);
  });
}

function telegramLinks(cb) {
  execFile('/usr/bin/ss', ['-tn'], { maxBuffer: 4 << 20 }, (err, out) => {
    if (err) return cb(null); // прибор недоступен — молчим, а не выдумываем
    const n = String(out).split('\n').filter(l => /149\.154|91\.108/.test(l)).length;
    cb(n);
  });
}

function socketCheck() {
  pollerAlive(alive => {
    if (!alive) {
      // Канал остановлен — это законное состояние, счётчик сбрасываем.
      if (state.idleStrikes) log('опрашивателя нет вовсе — канал остановлен, счётчик сброшен');
      state.idleStrikes = 0; saveState(state);
      return;
    }
    telegramLinks(n => {
      if (n === null) return;
      if (n > 0) {
        if (state.idleStrikes) log('связь с Telegram есть — счётчик тишины сброшен');
        state.idleStrikes = 0; saveState(state);
        return;
      }
      state.idleStrikes = (state.idleStrikes || 0) + 1;
      saveState(state);
      log('опрашиватель жив, но связи с Telegram нет · подряд: ' + state.idleStrikes);
      if (state.idleStrikes < DEAD_SOCKET_STRIKES) return;

      const since = Date.now() - (state.lastRestartAt || 0);
      if (since < RESTART_COOLDOWN_MS) {
        log('перезапуск пропущен: прошло всего ' + Math.round(since / 60000) + ' мин из 15');
        return;
      }
      state.idleStrikes = 0;
      state.lastRestartAt = Date.now();
      saveState(state);
      log('ЦИКЛ ОПРОСА МЁРТВ В ТИШИНЕ — перезапускаю канал');
      restartChannel(err2 => {
        if (err2) {
          log('перезапуск не удался: ' + err2.message);
          send('🔴 Опрашиватель перестал держать связь с Telegram, и перезапустить канал не вышло. Нужны руки.');
          return;
        }
        send('🔌 Опрашиватель молча перестал держать связь с Telegram — я заметил это в тишине и перезапустил канал заранее.\n\nВаши сообщения не терялись: перерыва в приёме не было.');
      });
    });
  });
}

function healthCheck() {
  let token;
  try { token = readToken(); } catch (e) { return; }

  apiGet(token, 'getWebhookInfo', (err, j) => {
    if (err) { log('проверка очереди не удалась: ' + err.message); return; }
    const pending = Number((j && j.result && j.result.pending_update_count) || 0);

    if (pending === 0) {
      if (state.deadStrikes) log('очередь пуста — опрашиватель жив, счётчик сброшен');
      state.deadStrikes = 0;
      saveState(state);
      return;
    }

    state.deadStrikes = (state.deadStrikes || 0) + 1;
    saveState(state);
    log('в очереди Telegram непрочитанных: ' + pending + ' · подряд: ' + state.deadStrikes);
    if (state.deadStrikes < DEAD_STRIKES) return;

    const since = Date.now() - (state.lastRestartAt || 0);
    if (since < RESTART_COOLDOWN_MS) {
      log('перезапуск пропущен: прошло всего ' + Math.round(since / 60000) + ' мин из 15');
      return;
    }

    state.deadStrikes = 0;
    state.lastRestartAt = Date.now();
    saveState(state);
    log('ОПРАШИВАТЕЛЬ МЁРТВ — перезапускаю канал');

    restartChannel(err2 => {
      if (err2) {
        log('перезапуск не удался: ' + err2.message);
        send('🔴 Бот перестал читать сообщения, и перезапустить канал не получилось.\n\n' +
          'В очереди Telegram непрочитанных: ' + pending + '. Нужны руки.');
        return;
      }
      // 🔒 СООБЩЕНИЯ НЕ ПОТЕРЯНЫ, И ЭТО СКАЗАНО ПРЯМО. Пока их никто не забрал,
      // они лежат в очереди Telegram; после перезапуска опрашиватель их прочтёт.
      send('♻️ Бот перестал читать сообщения — я это заметил и перезапустил канал.\n\n' +
        'Непрочитанных было: ' + pending + '. Они не потеряны: очередь Telegram цела, и ответ придёт.\n' +
        'Если через минуту тихо — напишите ещё раз.');
    });
  });
}

// ---------- пуск ----------

if (SELFTEST) {
  fs.mkdirSync(WATCH_DIR, { recursive: true });
  for (const f of listFiles()) { try { fs.unlinkSync(f); } catch (e) {} }
  try { fs.unlinkSync(STATE_FILE); } catch (e) {}
}

state = loadState();
if (!state) {
  state = { offsets: {}, announcedResetsAt: null, pendingResetsAt: null, deadStrikes: 0, idleStrikes: 0, lastRestartAt: 0 };
  // 🔒 ПЕРВЫЙ ЗАПУСК НЕ ПЕРЕИГРЫВАЕТ ПРОШЛОЕ: иначе сторож объявил бы вчерашний
  // лимит в первую же секунду.
  for (const f of listFiles()) state.offsets[f] = safeSize(f);
  saveState(state);
  log('первый запуск: прошлое не переигрывается, файлов ' + Object.keys(state.offsets).length);
}
if (typeof state.deadStrikes !== 'number') state.deadStrikes = 0;
if (typeof state.idleStrikes !== 'number') state.idleStrikes = 0;
if (typeof state.lastRestartAt !== 'number') state.lastRestartAt = 0;

if (state.pendingResetsAt) {
  const t = state.pendingResetsAt * 1000 + RESET_MARGIN_MS;
  if (t > Date.now()) { log('перезапуск: будильник восстановлен'); armTimer(state.pendingResetsAt); }
  else if (Date.now() - t < LATE_GUARD_MS) { log('перезапуск: сброс уже наступил, объявляю'); fireReset(true); }
  else { log('перезапуск: просроченный будильник отброшен'); state.pendingResetsAt = null; saveState(state); }
}

log('сторож канала запущен · журнал ' + WATCH_DIR + ' · проверка очереди раз в ' + HEALTH_MS / 1000 + ' с'
  + (SELFTEST ? ' · РЕЖИМ ПРОВЕРКИ' : ''));

setInterval(scanOnce, POLL_MS);
scanOnce();
setInterval(healthCheck, HEALTH_MS);
healthCheck();
setInterval(socketCheck, HEALTH_MS);
socketCheck();

if (SELFTEST) {
  const secs = 45;
  const rec = {
    type: 'assistant',
    timestamp: new Date().toISOString(),
    error: 'rate_limit', isApiErrorMessage: true, apiErrorStatus: 429,
    quotaLimits: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + secs, rateLimitType: 'five_hour' },
    message: { role: 'assistant', content: [{ type: 'text', text: 'SELFTEST' }] }
  };
  fs.appendFileSync(path.join(WATCH_DIR, 'selftest.jsonl'), JSON.stringify(rec) + '\n');
  log('контроль: синтетическая запись положена, сброс через ' + secs + ' с');
  setTimeout(() => { log('===SELFTEST_DONE==='); process.exit(0); }, (secs + 45) * 1000);
}
