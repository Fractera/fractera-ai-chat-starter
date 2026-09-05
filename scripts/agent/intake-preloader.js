#!/usr/bin/env node
'use strict';
//
// intake-preloader — MCP-сервер приёма входящих (шаг 133, 2026-09-05).
//
// ЧТО ОН ДЕЛАЕТ. Даёт агенту один инструмент: `intake`. Агент, получив от плагина
// каналов файл или сообщение, зовёт его вместо того, чтобы читать файл самому.
// Инструмент стучится в дверь `/api/intake` слота, та кладёт исходник в
// медиатеку, переводит его в текст внешней моделью, пишет в три хранилища — и
// возвращает агенту ГОТОВЫЙ ТЕКСТ. Байтов агент не видит.
//
// 🔒 ЗАЧЕМ ТАК, СЛОВА ВЛАДЕЛЬЦА: «чтобы Telegram нативно переопределял эту задачу
// в OpenAI и вызвал процесс, который вернёт: пользователь загрузил аудио, которое
// после транскрибации внешней моделью вернуло такой текст…». Три довода, каждый
// самостоятельный: лимит подписки не тратится на разбор медиа · у агента ровно
// один входной формат — текст · каждый инструмент делает своё.
//
// 🔒 БЕЗ ЕДИНОЙ ЗАВИСИМОСТИ, И ЭТО НЕ ЩЕГОЛЬСТВО. MCP по stdio — это построчный
// JSON-RPC; трёх методов (`initialize`, `tools/list`, `tools/call`) достаточно.
// Взять SDK из папки чужого плагина значило бы привязать нашу способность к его
// версии: он обновится в СОСЕДНЮЮ папку, и сервер молча перестанет запускаться.
//
// 🛑 ЗАПРЕТ, ПОВТОРЁННЫЙ ЗДЕСЬ НАМЕРЕННО: этот сервер НИЧЕГО не отвечает человеку
// и не трогает Telegram. Он только принимает. Ответ — следующий шаг, и дверь, в
// которую он стучится, тоже не умеет отвечать (`/api/intake`, а не `hook`).

const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const INTAKE_URL = process.env.INTAKE_URL || 'http://127.0.0.1:3000/api/intake';
const SECRET_FILE = process.env.INTAKE_SECRET_FILE || '/opt/fractera/app/.env.local';
const SECRET_NAME = 'TELEGRAM_HOOK_SECRET';

/**
 * Секрет читается ИЗ ФАЙЛА, а не из окружения процесса.
 *
 * 🔒 ИЗМЕРЕНО, А НЕ ВЫВЕДЕНО: слот собран отдельным процессом и `.env.local` в
 * `process.env` не подтягивает — тот же приём уже применён в `parsePaused()` и в
 * чтении ключа OpenAI. Сервер MCP запускается агентом, у которого окружения слота
 * нет вовсе.
 * 🔒 БЕЗ КЭША: секрет могут сменить между сообщениями, и закэшированное значение
 * означало бы перезапуск ради галочки.
 */
function secret() {
  try {
    const raw = fs.readFileSync(SECRET_FILE, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(new RegExp('^\\s*' + SECRET_NAME + '\\s*=\\s*(.*)$'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch (e) { /* файла нет — законный исход на чужой машине */ }
  return '';
}

function postIntake(payload) {
  return new Promise((resolve) => {
    const key = secret();
    if (!key) return resolve({ ok: false, error: 'no-secret', reason: 'TELEGRAM_HOOK_SECRET не найден в ' + SECRET_FILE });

    const u = new URL(INTAKE_URL);
    const lib = u.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname, method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-channel-secret': key,
      },
    }, res => {
      let buf = '';
      res.on('data', d => { buf += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { resolve({ ok: false, error: 'bad-answer', reason: buf.slice(0, 300) }); }
      });
    });
    // 🔒 ТАЙМАУТ ЩЕДРЫЙ: внутри двери зрение или расшифровка, и девяносто секунд
    // там — законное время, а не признак поломки.
    req.setTimeout(180000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', e => resolve({ ok: false, error: 'network', reason: String(e.message) }));
    req.write(body);
    req.end();
  });
}

// ---------- инструмент ----------

const TOOL = {
  name: 'intake',
  description:
    'Принять входящее сообщение или файл во все хранилища проекта и получить обратно готовый текст. ' +
    'ВЫЗЫВАЙ ЭТО ВМЕСТО ЧТЕНИЯ ФАЙЛА: голос будет расшифрован, изображение описано, документ прочитан ' +
    'внешней моделью, исходник ляжет в медиатеку, а событие — в векторную память и граф знаний. ' +
    'Возвращает текст для тебя; отвечать человеку этот инструмент не умеет и не должен.',
  inputSchema: {
    type: 'object',
    properties: {
      chat_id: { type: 'string', description: 'Идентификатор чата из тега <channel chat_id="...">' },
      who: { type: 'string', description: 'Имя пользователя из того же тега, без @' },
      text: { type: 'string', description: 'Текст сообщения. Для файла — подпись к нему, если была' },
      path: { type: 'string', description: 'Путь к присланному файлу на диске (image_path или ответ download_attachment)' },
      kind: { type: 'string', description: 'text | voice | photo | document — чем сообщение было до разбора' },
      message_id: { type: 'string', description: 'message_id из тега — по нему повтор не задваивается' },
      forwarded_from: { type: 'string', description: 'Автор слов, если сообщение переслано' },
    },
    required: ['chat_id'],
  },
};

async function runIntake(a) {
  const payload = {
    chatId: String(a.chat_id || ''),
    who: String(a.who || ''),
    text: String(a.text || ''),
    kind: String(a.kind || (a.path ? 'document' : 'text')),
  };
  if (a.message_id) payload.externalId = 'tg-' + a.message_id;
  if (a.forwarded_from) payload.forwardedFrom = String(a.forwarded_from);

  if (a.path) {
    let bytes;
    try { bytes = fs.readFileSync(a.path); }
    catch (e) { return 'Файл не прочитан: ' + String(e.message) + '. Приём не выполнен.'; }
    // 🛑 ИМЯ ФАЙЛА — ЕДИНСТВЕННЫЙ ИСТОЧНИК РОДА на той стороне: по расширению
    // решается, звать ли зрение, расшифровку или чтение документа.
    payload.fileName = a.path.split('/').pop() || 'file';
    payload.fileBase64 = bytes.toString('base64');
  }

  const r = await postIntake(payload);
  if (!r || r.ok !== true) {
    // 🔒 ОТКАЗ НАЗЫВАЕТСЯ ПРИЧИНОЙ. Агент прочитает это и скажет человеку, что
    // именно не сохранилось, вместо бодрого «готово».
    return 'Приём НЕ выполнен: ' + String((r && (r.error || r.reason)) || 'нет ответа') +
           (r && r.reason ? ' (' + String(r.reason).slice(0, 200) + ')' : '');
  }
  return String(r.forAgent || '(дверь не вернула текст)');
}

// ---------- MCP по stdio: построчный JSON-RPC ----------

// 🔒 СЧЁТЧИК ЖИВЫХ ВЫЗОВОВ — НЕ УКРАШЕНИЕ, А ЗАЩИТА ОТ ОБОРВАННОГО ПРИЁМА.
// ✗ измерено 2026-09-05: сервер выходил по закрытию stdin немедленно, и разбор,
// шедший в этот момент, обрывался на середине — файл уже лёг в медиатеку, а
// текст не вернулся никому. Разбор изображения идёт десятки секунд, и закрытие
// входа в эту секунду — обычное дело, а не редкость.
let inFlight = 0;
let stdinClosed = false;
function maybeExit() { if (stdinClosed && inFlight === 0) process.exit(0); }

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function ok(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, message) { send({ jsonrpc: '2.0', id, error: { code: -32603, message } }); }

async function handle(m) {
  // Уведомления идут без `id` и ответа НЕ ждут: ответить на них значит нарушить
  // протокол и получить разрыв соединения.
  if (m.id === undefined || m.id === null) return;

  if (m.method === 'initialize') {
    return ok(m.id, {
      protocolVersion: (m.params && m.params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'intake-preloader', version: '1.0.0' },
    });
  }
  if (m.method === 'tools/list') return ok(m.id, { tools: [TOOL] });
  if (m.method === 'tools/call') {
    const p = m.params || {};
    if (p.name !== TOOL.name) return fail(m.id, 'unknown tool: ' + p.name);
    inFlight++;
    try {
      const text = await runIntake(p.arguments || {});
      ok(m.id, { content: [{ type: 'text', text }] });
    } catch (e) {
      ok(m.id, { content: [{ type: 'text', text: 'Приём упал: ' + String(e && e.message) }], isError: true });
    } finally {
      inFlight--;
      maybeExit();
    }
    return;
  }
  if (m.method === 'ping') return ok(m.id, {});
  return fail(m.id, 'method not found: ' + m.method);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  // 🔒 РАЗБОР ПОСТРОЧНЫЙ И С ХВОСТОМ: сообщение приезжает кусками, и половина
  // строки в конце куска — обычное дело, а не ошибка.
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch (e) { continue; }
    handle(m);
  }
});
// 🔒 ЗАКРЫЛСЯ ВХОД — ДОЖДАТЬСЯ НЕЗАВЕРШЁННОГО И ТОЛЬКО ПОТОМ ВЫЙТИ. Ждать нового
// уже некого, но приём, начатый секунду назад, обязан дойти до конца: файл в
// медиатеке без записи в хранилищах — половина работы, и худшая её половина.
process.stdin.on('end', () => { stdinClosed = true; maybeExit(); });
