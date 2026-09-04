import { randomBytes } from "node:crypto";

// ОДНОРАЗОВЫЙ БИЛЕТ НА ТЕРМИНАЛ — ЗАМОК, КОТОРОГО У ОРИГИНАЛА НЕ БЫЛО (шаг 114-3).
//
// 🛑 ЧЕМ ЭТО ОПЛАЧЕНО ЗАРАНЕЕ, А НЕ ПОСЛЕ. Мост терминала до шага 500
// (`ai-workspace`, `bridges/platforms/server.js` на ревизии `e1e7ff0^`) принимал
// ЛЮБОЕ соединение: ни токена, ни куки, ни проверки origin. Прикрывала только
// топология — петля плюс nginx. Один открытый порт означал там root-shell для
// всякого, кто до него дотянулся. Здесь мост живёт в процессе чата, который
// СМОТРИТ НАРУЖУ, и повторять ту конструкцию нельзя.
//
// 🔒 ПОЧЕМУ БИЛЕТ, А НЕ ПРОВЕРКА КУКИ ПРЯМО В МОСТУ. Куку проверяет служба входа
// `:3001` — это сетевой вызов. Ставить его на каждое рукопожатие WebSocket значит
// положить открытие терминала на доступность чужой службы и получать отказ,
// который выглядит как «терминал сломан». Билет выдаёт дверь Next, где сессия
// проверена штатным путём (`fracteraRoles()`), а мост сверяет короткую строку в
// собственной памяти.
//
// 🔒 ФАЙЛ НАМЕРЕННО `.mjs`, А НЕ `.ts`, И ЭТО ГЛАВНОЕ РЕШЕНИЕ ЗДЕСЬ. Его читают
// ДВЕ половины: дверь внутри сборки Next и `server.js` рядом с ней. `server.js`
// — обычный Node и TypeScript не исполняет; писать проверку билета второй раз
// значило бы завести две правды об одном замке. Одна реализация, два импорта.
//
// 🔒 ХРАНИЛИЩЕ — `globalThis`, И ЭТО СЛЕДСТВИЕ ТОГО ЖЕ. Импорт из маршрута идёт
// через сборщик Next, импорт из `server.js` — через загрузчик Node: **процесс
// один, а экземпляра модуля два**, и таблица в области модуля у них была бы
// разной. Билет, выданный дверью, мост бы не нашёл. `globalThis` у процесса
// один — он и есть общая память этих двух половин.
//
// 🛑 БИЛЕТ НЕ ПЕРЕЖИВАЕТ ПЕРЕЗАПУСК, И ЭТО ВЕРНО: он живёт минуту, а
// `pm2 restart` рвёт и сам WebSocket. Класть его в базу значило бы завести
// вторую правду о живой сессии ради вещи, которая умирает быстрее перезапуска.

const TTL_MS = 60_000;

/** Потолок: защита от того, кто дёргает дверь в цикле. */
const MAX_TICKETS = 64;

const STORE_KEY = "__fracteraPtyTickets";

/**
 * @typedef {{ email: string, expiresAt: number }} Ticket
 * @returns {Map<string, Ticket>}
 */
function store() {
  const g = /** @type {Record<string, Map<string, Ticket> | undefined>} */ (
    /** @type {unknown} */ (globalThis)
  );
  let s = g[STORE_KEY];
  if (!s) {
    s = new Map();
    g[STORE_KEY] = s;
  }
  return s;
}

/**
 * @param {Map<string, Ticket>} s
 * @param {number} now
 */
function sweep(s, now) {
  for (const [id, t] of s) {
    if (t.expiresAt <= now) {
      s.delete(id);
    }
  }
}

/**
 * Выдать билет вошедшему человеку.
 *
 * 🔒 РОЛЬ ЗДЕСЬ НЕ ПРОВЕРЯЕТСЯ И НЕ ХРАНИТСЯ. Это делает дверь, и только она:
 * билет, знающий о ролях, стал бы второй правдой о правах.
 *
 * @param {string} email
 * @returns {{ ticket: string, expiresInMs: number }}
 */
export function mintPtyTicket(email) {
  const s = store();
  const now = Date.now();
  sweep(s, now);

  // Переполнение чистится самым старым, а не отказом: отказать человеку,
  // который просто дважды обновил страницу, выглядело бы поломкой.
  while (s.size >= MAX_TICKETS) {
    const [oldest] = [...s.entries()].sort(
      (a, b) => a[1].expiresAt - b[1].expiresAt
    );
    if (!oldest) {
      break;
    }
    s.delete(oldest[0]);
  }

  const ticket = randomBytes(32).toString("base64url");
  s.set(ticket, { email, expiresAt: now + TTL_MS });
  return { expiresInMs: TTL_MS, ticket };
}

/**
 * Погасить билет. Возвращает почту владельца или `null`.
 *
 * 🔒 БИЛЕТ УДАЛЯЕТСЯ ДО ПРОВЕРКИ СРОКА, А НЕ ПОСЛЕ. Иначе просроченный лежит до
 * следующей уборки, и его можно предъявлять сколько угодно раз, каждый раз
 * получая один и тот же отказ, — то есть проверять чужие билеты на живость.
 *
 * @param {unknown} ticket
 * @returns {string | null}
 */
export function redeemPtyTicket(ticket) {
  if (typeof ticket !== "string" || ticket.length === 0) {
    return null;
  }
  const s = store();
  const now = Date.now();
  sweep(s, now);

  const found = s.get(ticket);
  if (!found) {
    return null;
  }
  s.delete(ticket);
  return found.expiresAt > now ? found.email : null;
}

/** Сколько билетов сейчас живо — только для прибора. @returns {number} */
export function ptyTicketCount() {
  const s = store();
  sweep(s, Date.now());
  return s.size;
}

/** Срок жизни билета, чтобы дверь и прибор не держали своих копий числа. */
export const PTY_TICKET_TTL_MS = TTL_MS;
