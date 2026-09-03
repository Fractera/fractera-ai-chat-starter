import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getChatById, getMessageById, saveChat, saveMessages } from "@/lib/db/queries";
import { chat, user } from "@/lib/db/schema";
import { notifyChat } from "./notify";
import { slotEnv } from "./slot-env";

// СООБЩЕНИЕ, ПРИШЕДШЕЕ ИЗ КАНАЛА, СТАНОВИТСЯ СООБЩЕНИЕМ ЧАТА (97-2).
//
// 🔒 TELEGRAM — НЕ ГЛАВНЫЙ ВХОД, И ЭТОТ ФАЙЛ ПОСТРОЕН ИСХОДЯ ИЗ ЭТОГО. Слово
// владельца 2026-09-03: «Telegram здесь только расширение функциональности для
// редких кейсов, в большинстве случаев пользователь будет пользоваться мобильным
// чатом в веб». Поэтому здесь нет ничего, что переделывало бы обычный путь: тот
// живёт в `app/(chat)/api/chat/route.ts` и остаётся основным.
//
// 🔒 КАНАЛ ОБЪЯВЛЕН СПИСКОМ ИЗ ОДНОГО ЗНАЧЕНИЯ ИМЕННО ПОЭТОМУ. Завтра рядом
// встанут календарь и внешний исполнитель; строка `"telegram"`, зашитая по коду,
// потребовала бы искать все места, а список правится одной правкой вместе с
// перечислением.
export const CHANNELS = ["telegram"] as const;
export type Channel = (typeof CHANNELS)[number];

export function isChannel(v: unknown): v is Channel {
  return typeof v === "string" && (CHANNELS as readonly string[]).includes(v);
}

/** Что служба каналов присылает на дверь. Форма измерена по `services/channels/server.js`. */
export type InboundMessage = {
  channel: Channel;
  chatId: string;
  text: string;
  who?: string | null;
  at?: string | null;
  externalId?: string | number | null;
};

/**
 * Общий секрет двери.
 *
 * 🔒 БЕРЁТСЯ ИЗ ОКРУЖЕНИЯ ЧАТА ИЛИ ИЗ ФАЙЛА ПРОЕКТА — своей копии нет. Тот же
 * секрет лежит в `config.json` службы `:3500`, и он там ОДИН: две правды о
 * секрете расходятся в тот день, когда его меняют.
 */
export function hookSecret(): string {
  return process.env.CHANNELS_HOOK_SECRET || slotEnv("CHANNELS_HOOK_SECRET");
}

/**
 * Сверка секрета.
 *
 * 🔒 СРАВНЕНИЕ ПОСТОЯННОГО ВРЕМЕНИ, А НЕ `===`. Обычное сравнение строк выходит
 * на первом несовпавшем байте, и по времени ответа секрет подбирается посимвольно.
 * Цена правильного способа — одна функция стандартной библиотеки.
 *
 * 🛑 ПУСТОЙ НАСТРОЕННЫЙ СЕКРЕТ ОТКЛЮЧАЕТ ДВЕРЬ, А НЕ ОТКРЫВАЕТ ЕЁ. Не задан
 * секрет — дверь не принимает никого: «настройка забыта» не имеет права
 * означать «принимай всех».
 */
export function secretMatches(given: string | null): boolean {
  const want = hookSecret();
  if (!(want && given)) {
    return false;
  }
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  // timingSafeEqual падает на разной длине — длину сверяем отдельно.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Постоянный идентификатор разговора для собеседника канала.
 *
 * 🔒 РАЗГОВОР ОДИН НА ОДИН `chatId` КАНАЛА, И ЭТО ДОПУЩЕНИЕ, ПОДТВЕРЖДЁННОЕ
 * ВЛАДЕЛЬЦЕМ. Новый разговор на каждое сообщение рассыпал бы переписку на сотни
 * веток по одной строке, и вопрос «что мы обсуждали вчера» перестал бы иметь
 * ответ.
 *
 * 🔒 ИДЕНТИФИКАТОР ВЫЧИСЛЯЕТСЯ, А НЕ ХРАНИТСЯ В ТАБЛИЦЕ СВЯЗИ. Таблица «канал →
 * разговор» — это второй источник правды и лишняя миграция чужой схемы; хеш от
 * `channel:chatId` даёт тот же ответ на любой машине и в любой сессии. Форма —
 * UUID пятой версии: колонка объявлена `uuid`, и любая другая строка в неё не
 * ляжет.
 */
export function conversationId(channel: Channel, chatId: string): string {
  const h = createHash("sha1").update(`fractera:${channel}:${chatId}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // версия 5
  b[8] = (b[8] & 0x3f) | 0x80; // вариант RFC 4122
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Чей это разговор.
 *
 * 🔒 РЕШЕНИЕ ВЛАДЕЛЬЦА 2026-09-03, ДОСЛОВНО: «Ваша учётная запись». Разговор из
 * канала принадлежит человеку, привязавшему бота, — не новой записи «пользователь
 * Telegram» и не служебной записи «Telegram». Причина не в экономии: своего входа
 * у чата нет по закону шага 96, и запись человека, заведённая мимо службы `:3001`,
 * стала бы второй правдой о людях. Ровно за это удалён провайдер `guest`.
 *
 * Явная настройка сильнее умолчания; умолчание — первая заведённая учётная
 * запись, и оно названо вслух, а не подразумевается.
 */
export async function ownerUserId(): Promise<string> {
  const client = postgres(process.env.POSTGRES_URL ?? "");
  const db = drizzle(client);
  try {
    const wanted = process.env.CHANNELS_OWNER_EMAIL || slotEnv("CHANNELS_OWNER_EMAIL");
    if (wanted) {
      const [row] = await db.select().from(user).where(eq(user.email, wanted));
      if (row) {
        return row.id;
      }
      throw new Error(`CHANNELS_OWNER_EMAIL=${wanted}: такой учётной записи нет`);
    }
    // 🛑 `demo@local` — НЕ ЧЕЛОВЕК, А ЗАПИСЬ РЕЖИМА БЕЗ ДОМЕНА, И БРАТЬ ЕЁ
    // ВЛАДЕЛЬЦЕМ НЕЛЬЗЯ. ✗ оплачено 2026-09-03 в тот же день: умолчание «первая
    // заведённая запись» дало именно её — она создаётся при рождении сервера,
    // раньше живых людей. Сообщения из Telegram легли ей, владелец вошёл под
    // своей учётной записью и увидел ПУСТО. Данные были целы и невидимы, что
    // снаружи неотличимо от «канал не работает».
    //
    // 🔒 ПРАВИЛО, А НЕ КОНСТАНТА: пропускаем служебную запись, берём первую
    // настоящую. Вписать сюда конкретный адрес значило бы сломать это на
    // следующем сервере, где адрес другой.
    const all = await db.select().from(user).orderBy(asc(user.createdAt));
    if (all.length === 0) {
      throw new Error("В чате нет ни одной учётной записи — некому владеть разговором");
    }
    const human = all.find((u) => u.email !== "demo@local");
    return (human ?? all[0]).id;
  } finally {
    await client.end();
  }
}

/**
 * Записать разговору его канал.
 *
 * 🔒 ЭТО НЕ ВТОРОЕ ХРАНИЛИЩЕ, А ПОЛЕ РОДНОГО. Закон владельца 2026-09-03:
 * единственный источник данных о сообщениях — хранилище чата, и промежуточных
 * слоёв из-за Telegram не заводим.
 */
export async function setChatChannel(row: {
  id: string;
  channel: Channel;
  chatId: string;
  who: string | null;
}): Promise<void> {
  const client = postgres(process.env.POSTGRES_URL ?? "");
  const db = drizzle(client);
  try {
    await db
      .update(chat)
      .set({ channel: row.channel, channelChatId: row.chatId, channelWho: row.who })
      .where(eq(chat.id, row.id));
  } finally {
    await client.end();
  }
}

/**
 * Куда отвечать: канал разговора и адрес собеседника в нём.
 *
 * 🔒 ЧИТАЕТСЯ ИЗ РАЗГОВОРА, А НЕ ИЗ ЗАГОЛОВКА. Заголовок написан для человека:
 * начни машина его разбирать — его нельзя ни переименовать, ни перевести.
 * `null` — обычный разговор в браузере, отвечать наружу некуда, и это норма.
 */
export async function channelOfChat(
  id: string
): Promise<{ channel: Channel; chatId: string } | null> {
  const client = postgres(process.env.POSTGRES_URL ?? "");
  const db = drizzle(client);
  try {
    const [row] = await db.select().from(chat).where(eq(chat.id, id));
    if (!(row?.channel && row.channelChatId) || !isChannel(row.channel)) {
      return null;
    }
    return { channel: row.channel, chatId: row.channelChatId };
  } finally {
    await client.end();
  }
}

/**
 * Положить входящее сообщение в чат. Возвращает разговор и сообщение.
 *
 * 🔒 ЗАПИСЬ ИДЁТ ГОТОВЫМИ `saveChat`/`saveMessages`, А НЕ СВОИМ SQL. Это чужая
 * вендоренная схема: своя вставка мимо них разошлась бы с шаблоном на первом же
 * обновлении сверху, и разошлась бы молча.
 */
export async function receiveInbound(
  msg: InboundMessage
): Promise<{ chatId: string; messageId: string; created: boolean; duplicate: boolean }> {
  const id = conversationId(msg.channel, msg.chatId);
  const existing = await getChatById({ id });

  if (existing) {
    // 🔒 РАЗГОВОРЫ, ЗАВЕДЁННЫЕ ДО 97-4, КАНАЛА НЕ ЗНАЮТ — ДОПИСЫВАЕМ ЕГО ЗДЕСЬ.
    // Иначе отвечать в них было бы нечем, и вылечить это можно было бы только
    // руками в базе. Условие защищает от лишней записи на каждом сообщении.
    if (!existing.channelChatId) {
      await setChatChannel({ channel: msg.channel, chatId: msg.chatId, id, who: msg.who ?? null });
    }
  } else {
    await saveChat({
      id,
      title: `${msg.channel === "telegram" ? "Telegram" : msg.channel} · ${msg.who || msg.chatId}`,
      userId: await ownerUserId(),
      // 🔒 ЛИЧНЫЙ, А НЕ ПУБЛИЧНЫЙ. Переписка человека с ботом по умолчанию
      // видима только ему; открыть её — отдельное осознанное действие.
      visibility: "private",
    });
    // 🔒 КАНАЛ ЗАПИСЫВАЕТСЯ ОТДЕЛЬНЫМ ДЕЙСТВИЕМ, А НЕ ЧЕРЕЗ `saveChat`. Тот
    // пришёл из чужого шаблона и знает ровно четыре поля; расширять его подпись
    // значит удорожать каждое обновление сверху. Наше — рядом и наше.
    await setChatChannel({ channel: msg.channel, chatId: msg.chatId, id, who: msg.who ?? null });
  }

  // 🔒 ИДЕНТИФИКАТОР СООБЩЕНИЯ ТОЖЕ ВЫЧИСЛЯЕТСЯ, КОГДА ЕСТЬ ИЗ ЧЕГО. Служба
  // повторит доставку, если приложение не ответило вовремя, — и без этого одно
  // сообщение легло бы в базу дважды. Нет внешнего номера — обычный случайный.
  const messageId = msg.externalId
    ? conversationId(msg.channel, `msg:${msg.chatId}:${msg.externalId}`)
    : conversationId(msg.channel, `msg:${msg.chatId}:${Date.now()}:${msg.text.slice(0, 64)}`);

  // 🛑 ПОВТОРНАЯ ДОСТАВКА — ЗАКОННЫЙ ИСХОД, А НЕ ОТКАЗ. ✗ найдено измерением
  // в тот же час: второй толчок с тем же номером падал на уникальном ключе, и
  // дверь отвечала `500`. Строка при этом не удваивалась — то есть данные были
  // целы, а служба видела ошибку и записывала в журнал отказ, которого не было.
  // «Уже принято» и «не принято» обязаны различаться: иначе первый же повтор
  // Telegram выглядит как поломка чата.
  //
  // 🔒 ПРОВЕРКОЙ, А НЕ ЛОВЛЕЙ КОДА ОШИБКИ. Код `23505` принадлежит драйверу
  // Postgres и приезжает сюда завёрнутым в чужой класс ошибки: разбирать его
  // значило бы зависеть от формы чужого исключения, которая меняется с
  // обновлением шаблона. Один лишний запрос по первичному ключу дешевле.
  const already = await getMessageById({ id: messageId });
  if (already.length > 0) {
    return { chatId: id, created: !existing, duplicate: true, messageId };
  }

  await saveMessages({
    messages: [
      {
        attachments: [],
        chatId: id,
        createdAt: msg.at ? new Date(msg.at) : new Date(),
        id: messageId,
        parts: [{ text: msg.text, type: "text" }],
        role: "user",
      },
    ],
  });

  // 🔒 СИГНАЛ ПОСЛЕ ЗАПИСИ, А НЕ ДО НЕЁ (100-1). Обратный порядок заставил бы
  // вкладку перечитать разговор раньше, чем в нём появилось сообщение, — и она
  // показала бы прежнее состояние, объявив его новым.
  await notifyChat(id);

  return { chatId: id, created: !existing, duplicate: false, messageId };
}
