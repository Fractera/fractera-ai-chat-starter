import "server-only";

import { generateText } from "ai";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getLanguageModel, hasOpenAiKey } from "@/lib/ai/providers";
import { getChatById, getMessagesByChatId, saveMessages } from "@/lib/db/queries";
import { type Channel, channelOfChat } from "./channels";
import { fetchMedia } from "./media";
import { notifyChat } from "./notify";
import { slotEnv } from "./slot-env";

// 🪦 ЭТОТ ФАЙЛ БЫЛ ПАРКОВКОЙ С 2026-09-03 И ВКЛЮЧЁН В ТОТ ЖЕ ДЕНЬ.
//
// Здесь стояло: «никем не зовётся; включать — отдельным подшагом и по слову
// владельца». Слово получено, дословно: «сообщения из телеграма не попадают в
// запрос к искусственному интеллекту, а нужно бы». Запрет ставил тот же голос,
// что его снял, и снят он потому, что отпало условие: приём был не закончен, а
// теперь работает.
//
// ОТВЕТ, РОЖДЁННЫЙ НА СЕРВЕРЕ — ДЛЯ СООБЩЕНИЙ, У КОТОРЫХ НЕТ БРАУЗЕРА (97-5).
//
// 🛑 ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ПУТЬ, А НЕ ПЕРЕИСПОЛЬЗОВАНИЕ `/api/chat`. Та дверь
// устроена вокруг СТРИМА В БРАУЗЕР: поток отдаётся тому, кто его запросил.
// Сообщение из Telegram приходит, когда браузера нет вовсе, и запрашивать поток
// некому. Общего берём столько, сколько берётся без ломки: выбор модели и
// проверку ключа.
//
// 🔒 БРАУЗЕРНЫЙ ПУТЬ ОСТАЁТСЯ ОСНОВНЫМ (решение владельца 2026-09-03: «Telegram
// это не контрольная точка входа… в большинстве случаев пользователь будет
// пользоваться мобильным чатом в вебе»). Этот путь — побочный, и переносить на
// него генерацию целиком «раз уж написали» запрещено.
//
// 🔒 ПОРЯДОК НАЗВАН ВЛАДЕЛЬЦЕМ ДОСЛОВНО: «только в тот момент, когда сообщение в
// ленте чата будет завершено, оно будет отправлено в Telegram». Сначала база,
// потом канал — не наоборот. Обратный порядок дал бы человеку ответ, которого
// нет в истории.

/** Сколько последних сообщений разговора уходит модели как контекст. */
const CONTEXT_DEPTH = 20;

/** Адрес службы каналов. Своей копии секрета у чата нет — см. `slot-env.ts`. */
function channelsUrl(): string {
  return process.env.CHANNELS_SERVICE_URL || "http://127.0.0.1:3500";
}

/**
 * Экранирование для Telegram `parse_mode: "HTML"` (шаг 104). Разрешает ровно те четыре
 * символа, которые Telegram трактует как разметку (`< > & "`), а не полный HTML-набор —
 * текст пользователя не должен становиться разметкой сам по себе, иначе `<b>жирный</b>`,
 * присланный человеком, стал бы настоящим тегом в чужом сообщении.
 */
export function escapeTelegramHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Текст сообщения из его частей. Части — договор шаблона, а не наша выдумка. Общая с шагом 103. */
export function textOf(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts
    .map((p) =>
      p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text ?? "") : ""
    )
    .join(" ")
    .trim();
}

/**
 * Отправить текст в канал разговора.
 *
 * 🔒 ТОКЕН БОТА ОСТАЁТСЯ В СЛУЖБЕ. Мы отдаём ей текст и адрес; она одна знает,
 * чем говорить в Telegram, и это правильно: второй путь токена расходится молча.
 */
export async function sendToChannel(
  channel: Channel,
  chatId: string,
  text: string,
  bot?: string | null,
  parseMode?: "HTML"
): Promise<{ ok: boolean; error?: string }> {
  if (channel !== "telegram") {
    return { error: `канал ${channel} не умеет отправлять`, ok: false };
  }
  try {
    // 🛑 ОТВЕЧАЕМ ТЕМ БОТОМ, КОТОРОМУ ПРИНАДЛЕЖИТ РАЗГОВОР. ✗ без этого служба
    // берёт ПЕРВОГО, а он не знает собеседников второго: ответ во второй
    // разговор не дошёл бы, и отказ читался бы как «Telegram отверг сообщение».
    const suffix = bot ? `?bot=${encodeURIComponent(bot)}` : "";
    const r = await fetch(`${channelsUrl()}/telegram/send${suffix}`, {
      body: JSON.stringify({ chatId, parseMode, text }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(20_000),
    });
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    return r.ok ? { ok: true } : { error: d.error ?? `служба ответила ${r.status}`, ok: false };
  } catch (e) {
    return { error: String((e as Error).message ?? e), ok: false };
  }
}

/**
 * Файл в Telegram (шаг 105). Байты берутся из МЕДИАТЕКИ ПРОЕКТА тем же приёмом, что
 * `inlineAttachmentsForModel` — `fetchMedia`, а не второй способ добраться до склада.
 *
 * 🔒 РОД РЕШАЕТ МЕТОД ТАК ЖЕ, КАК В СЛУЖБЕ (`/telegram/sendFile`): `image` → фото,
 * `audio` → голосовое, всё остальное → документ. Вторая копия этого правила здесь не
 * заводится — служба уже решает это сама по полю `kind`, мы его только называем.
 */
async function sendFileToChannel(
  channel: Channel,
  chatId: string,
  base64: string,
  kind: "image" | "audio" | "document",
  name: string,
  bot?: string | null
): Promise<{ ok: boolean; error?: string }> {
  if (channel !== "telegram") {
    return { error: `канал ${channel} не умеет отправлять`, ok: false };
  }
  try {
    const suffix = bot ? `?bot=${encodeURIComponent(bot)}` : "";
    const r = await fetch(`${channelsUrl()}/telegram/sendFile${suffix}`, {
      body: JSON.stringify({ base64, chatId, kind, name }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(60_000),
    });
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    return r.ok ? { ok: true } : { error: d.error ?? `служба ответила ${r.status}`, ok: false };
  } catch (e) {
    return { error: String((e as Error).message ?? e), ok: false };
  }
}

function attachmentKind(mediaType: string | undefined): "image" | "audio" | "document" {
  const top = (mediaType ?? "").split("/")[0];
  if (top === "image") {
    return "image";
  }
  if (top === "audio") {
    return "audio";
  }
  return "document";
}

/**
 * Зеркалирование вложений сообщения в связанный Telegram (шаг 105, продолжение шага 103).
 *
 * 🔒 ЗЕРКАЛИТСЯ ТОЛЬКО ТО, ЧТО ЛЕЖИТ В НАШЕЙ МЕДИАТЕКЕ. `/api/fractera/media/<id>` — единственный
 * адрес, за которым стоят настоящие байты; часть с чужим или отсутствующим `url` пропускается
 * молча, а не ломает отправку остальных вложений и текста.
 */
export async function mirrorAttachments(
  parts: unknown,
  channel: Channel,
  chatId: string,
  bot?: string | null
): Promise<void> {
  if (!Array.isArray(parts)) {
    return;
  }
  for (const part of parts) {
    const p = part as {
      type?: string;
      url?: string;
      mediaType?: string;
      name?: string;
      filename?: string;
    };
    if (p?.type !== "file" || typeof p.url !== "string") {
      continue;
    }
    const prefix = "/api/fractera/media/";
    if (!p.url.startsWith(prefix)) {
      continue;
    }
    const id = p.url.slice(prefix.length);
    const res = await fetchMedia(id);
    if (!res) {
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const name = p.filename ?? p.name ?? "file";
    await sendFileToChannel(channel, chatId, buf.toString("base64"), attachmentKind(p.mediaType), name, bot);
  }
}

/**
 * Ответить на сообщение, пришедшее из канала: сочинить, СОХРАНИТЬ, отправить.
 *
 * 🔒 ОТКАЗ ТОЖЕ ДОЕЗЖАЕТ ДО ЧЕЛОВЕКА, И ЭТО НЕ ВЕЖЛИВОСТЬ. Пока служба отвечала
 * сама, молчание было невозможно; с переключением её в режим «отдаю приложению»
 * любая наша неудача превращается в тишину, а тишина в мессенджере читается как
 * «бот сломался». Поэтому причина уходит тем же путём, что ответ.
 *
 * 🛑 ОТКАЗ НЕ СОХРАНЯЕТСЯ В ЛЕНТУ КАК ОТВЕТ МОДЕЛИ. Он про состояние системы, а
 * не про разговор: история, в которую подмешаны служебные сообщения, через месяц
 * станет непригодной для того самого разбора, ради которого всё строится.
 */
export async function answerInboundMessage(chatId: string): Promise<{
  saved: boolean;
  delivered: boolean;
  reason?: string;
}> {
  const target = await channelOfChat(chatId);
  // Хозяин нужен, чтобы объявить ответ в ЕГО открытую вкладку.
  const owner = (await getChatById({ id: chatId }))?.userId ?? "";

  const fail = async (reason: string) => {
    if (target) {
      await sendToChannel(target.channel, target.chatId, reason, target.bot);
    }
    return { delivered: false, reason, saved: false };
  };

  if (!hasOpenAiKey()) {
    // Та же фраза, что видит человек в браузере, — один смысл на две поверхности.
    return await fail(
      "Не могу ответить: похоже, у вас нет ключа OpenAI. Настройте его в административной панели."
    );
  }

  const history = await getMessagesByChatId({ id: chatId });
  const recent = history.slice(-CONTEXT_DEPTH);
  if (recent.length === 0) {
    return await fail("Не вижу сообщения, на которое отвечать.");
  }

  let text = "";
  try {
    const result = await generateText({
      messages: recent.map((m) => ({
        content: textOf(m.parts),
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      })),
      model: getLanguageModel(slotEnv("OPENAI_TEXT_MODEL") || DEFAULT_CHAT_MODEL),
    });
    text = result.text.trim();
  } catch (e) {
    // 🛑 ПРИЧИНА ОТ МОДЕЛИ ПЕРЕСКАЗЫВАЕТСЯ, А НЕ ПРОБРАСЫВАЕТСЯ. В её тексте
    // бывает фрагмент ключа и внутренние адреса, а читает это человек в
    // мессенджере.
    const raw = String((e as Error).message ?? e);
    const quota = /quota|insufficient|billing/i.test(raw);
    return await fail(
      quota
        ? "Ключ OpenAI не работает — похоже, на счёте нет средств. Проверьте его в административной панели."
        : "Не удалось получить ответ модели. Попробуйте ещё раз через минуту."
    );
  }

  if (!text) {
    return await fail("Модель вернула пустой ответ.");
  }

  // 🔒 ШАГ 101 — та же форма каркаса, что в браузерном пути (`lib/types.ts` → `ParseStepData`).
  // Здесь нет `writer` и нет открытой вкладки, которой стримить промежуточный `pending` — шаг
  // приходит сразу готовым. Ограничение названо в ТЗ подшага, а не найдено постфактум.
  // СНАЧАЛА БАЗА — порядок владельца.
  await saveMessages({
    messages: [
      {
        attachments: [],
        chatId,
        createdAt: new Date(),
        id: crypto.randomUUID(),
        // 🔒 ПОРЯДОК В МАССИВЕ — ПОРЯДОК НА ЭКРАНЕ. `parts` рисуются в том порядке, в котором
        // лежат: «Ход ответа» обязан идти ПЕРЕД текстом, иначе в веб-чате (куда попадают и
        // Telegram-разговоры) читатель видит готовый ответ раньше объяснения, откуда он взялся —
        // найдено владельцем 2026-09-03 живым просмотром.
        parts: [
          {
            data: { id: "model-answer", label: "Модель сформировала ответ", status: "done" },
            id: "model-answer",
            type: "data-parse-step",
          },
          { text, type: "text" },
        ],
        role: "assistant",
      },
    ],
  });

  // 🛑 ОТВЕТ ТОЖЕ ОБЪЯВЛЯЕТСЯ ВКЛАДКЕ, ИНАЧЕ ОН ПОЯВИТСЯ ТОЛЬКО ПОСЛЕ
  // ПЕРЕЗАГРУЗКИ. Уведомление стояло на входящем сообщении; ответ модели
  // рождается здесь, отдельной записью, и без своего сигнала он для открытой
  // ленты не существует. Человек увидел бы свой вопрос живьём и ждал бы ответа,
  // который уже пришёл.
  await notifyChat(chatId, owner);

  if (!target) {
    // Разговор без канала — отвечать наружу некуда, и это законно: ответ уже в
    // ленте, человек его увидит в браузере.
    return { delivered: false, saved: true };
  }

  const sent = await sendToChannel(target.channel, target.chatId, text, target.bot);
  return { delivered: sent.ok, reason: sent.error, saved: true };
}
