import "server-only";

import { generateText } from "ai";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getLanguageModel, hasOpenAiKey } from "@/lib/ai/providers";
import { getChatById, getMessagesByChatId, saveMessages } from "@/lib/db/queries";
import { type Channel, channelOfChat } from "./channels";
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

/** Текст сообщения из его частей. Части — договор шаблона, а не наша выдумка. */
function textOf(parts: unknown): string {
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
  bot?: string | null
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
      body: JSON.stringify({ chatId, text }),
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

  // СНАЧАЛА БАЗА — порядок владельца.
  await saveMessages({
    messages: [
      {
        attachments: [],
        chatId,
        createdAt: new Date(),
        id: crypto.randomUUID(),
        parts: [{ text, type: "text" }],
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
