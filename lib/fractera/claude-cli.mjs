import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ЗНАНИЕ О CLI `claude` В ОДНОМ МЕСТЕ (шаг 115).
//
// 🔒 `.mjs`, А НЕ `.ts`, ПО ТОЙ ЖЕ ПРИЧИНЕ, ЧТО У `pty-ticket.mjs`: файл читают
// ДВЕ половины — двери внутри сборки Next и `server.mjs` рядом с ней, а он
// TypeScript не исполняет. Две реализации одного знания разошлись бы на первой
// же правке; здесь их одна.
//
// 🔒 ЧТО ИМЕННО СЮДА ПЕРЕЕХАЛО: где лежит бинарь, вошли ли по подписке и где
// плагин канала ищет токен. Всё это — свойства ЧУЖОГО инструмента, а знание о
// чужом инструменте живёт в одном месте (закон шага 109).

/** Путь к CLI. `which` — потому что установка глобальная и путь машинный. */
export function claudeBin() {
  if (process.env.CLAUDE_BIN) {
    return process.env.CLAUDE_BIN;
  }
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  const found = which.status === 0 ? which.stdout.trim() : "";
  return found || "claude";
}

/**
 * Вошли ли уже по подписке.
 *
 * 🔒 СПРАШИВАЕМ ПОЛЕ, А НЕ КОД ВОЗВРАТА: у `claude auth status` он нулевой и у
 * вошедшего, и у невошедшего — она печатает JSON в обоих случаях.
 *
 * `null` — спросить не удалось. Это НЕ «не вошёл»: разница решает, покажем мы
 * человеку вход или ложное «подключено».
 *
 * @returns {{ loggedIn: boolean | null, method: string | null }}
 */
export function claudeAuthState() {
  try {
    const out = spawnSync(claudeBin(), ["auth", "status"], {
      encoding: "utf8",
      timeout: 15_000,
    });
    if (out.status !== 0 || !out.stdout) {
      return { loggedIn: null, method: null };
    }
    const parsed = JSON.parse(out.stdout);
    return {
      loggedIn: typeof parsed.loggedIn === "boolean" ? parsed.loggedIn : null,
      method: typeof parsed.authMethod === "string" ? parsed.authMethod : null,
    };
  } catch {
    return { loggedIn: null, method: null };
  }
}

// ── токен бота для канала Telegram ───────────────────────────────────────────
//
// 🔒 АДРЕС ФАЙЛА НЕ НАШ, А ПЛАГИНА, И ПОТОМУ ОН ЗДЕСЬ ОДИН. Официальный плагин
// `telegram@claude-plugins-official` читает `~/.claude/channels/telegram/.env`
// (измерено чтением его исходника, версия 0.0.7). Записав токен куда-то ещё, мы
// получили бы «сохранено» и неработающий канал — молча.
//
// 🛑 ТОКЕН НЕ ХОДИТ ЧЕРЕЗ ТЕРМИНАЛ. Его можно было бы подставить в командную
// строку запуска, и это на один файл меньше кода — но оболочка отражает
// набранное в ленту и кладёт строку в свою историю. Секрет, показанный на
// экране, перестаёт быть секретом.

export function telegramEnvPath() {
  return (
    process.env.CLAUDE_TELEGRAM_ENV ||
    join(homedir(), ".claude", "channels", "telegram", ".env")
  );
}

/** Формат токена BotFather: `<цифры>:<строка>`. Проверяем ДО записи. */
export const TELEGRAM_TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;

/** Маска: отвечает на «тот ли токен», не отдавая токена. */
export function maskToken(token) {
  if (!token) {
    return "";
  }
  const [id] = token.split(":");
  return `${id}:…${token.slice(-4)}`;
}

/** @returns {string} токен или пустая строка */
export function readTelegramToken() {
  try {
    const raw = readFileSync(telegramEnvPath(), "utf8");
    return (raw.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m) ?? [])[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

/**
 * Записать токен туда, где его ждёт плагин.
 *
 * 🔒 ФАЙЛ ПИШЕТСЯ ЦЕЛИКОМ, А НЕ ПОСТРОЧНО, И ЭТО ЗДЕСЬ ВЕРНО: он наш по
 * происхождению — создаётся этой дверью либо командой `/telegram:configure`, и
 * ничего, кроме токена, в нём не живёт. Построчная правка нужна там, где у
 * файла несколько хозяев (окружение слота), а тут хозяин один.
 */
export function writeTelegramToken(token) {
  const path = telegramEnvPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `TELEGRAM_BOT_TOKEN=${token}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

// ── привязка собеседника ─────────────────────────────────────────────────────
//
// 🔒 КОД ПРИВЯЗКИ СЕРВЕР УЖЕ ЗНАЕТ — ПЕРЕПИСЫВАТЬ ЕГО РУКАМИ НЕЗАЧЕМ (115-2).
// Владелец: «не очевидно было что нужно встраивать руками». И он прав дважды:
// плагин кладёт ожидающие коды в `access.json` рядом с токеном, то есть данные
// у нас есть, а человек всё равно переписывал их с экрана на экран.
//
// 🛑 ИДЕНТИФИКАТОР СОБЕСЕДНИКА НАРУЖУ НЕ ОТДАЁТСЯ. В файле рядом с кодом лежит
// `senderId` — это учётная запись владельца в Telegram, и окну она не нужна:
// оно показывает код и число привязанных, а не «кто именно». Отдавать больше,
// чем нужно поверхности, — это то же, что отдавать токен вместо маски.

export function telegramAccessPath() {
  return join(dirname(telegramEnvPath()), "access.json");
}

/**
 * Что знает плагин о привязке.
 *
 * @returns {{ allowed: number, pending: { code: string, expiresAt: number }[] }}
 */
export function readTelegramAccess() {
  try {
    const raw = JSON.parse(readFileSync(telegramAccessPath(), "utf8"));
    const allowFrom = Array.isArray(raw.allowFrom) ? raw.allowFrom : [];
    const pendingRaw =
      raw.pending && typeof raw.pending === "object" ? raw.pending : {};
    const now = Date.now();
    const pending = Object.entries(pendingRaw)
      // Просроченный код показывать нельзя: он выглядит рабочим и не сработает,
      // а человек пойдёт искать поломку там, где её нет.
      .filter(([, v]) => !v?.expiresAt || v.expiresAt > now)
      .map(([code, v]) => ({ code, expiresAt: v?.expiresAt ?? 0 }));
    return { allowed: allowFrom.length, pending };
  } catch {
    return { allowed: 0, pending: [] };
  }
}
