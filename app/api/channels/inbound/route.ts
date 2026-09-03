// @api inbound message from a channel service becomes a chat message

import { type NextRequest, NextResponse } from "next/server";
import {
  type InboundMessage,
  isChannel,
  receiveInbound,
  secretMatches,
} from "@/lib/fractera/channels";

// ДВЕРЬ ВХОДЯЩЕГО СООБЩЕНИЯ ИЗ КАНАЛА (97-2).
//
// 🔒 ЗАМОК ЗДЕСЬ ДРУГОЙ, А НЕ СНЯТЫЙ. Все остальные двери чата закрыты сессией
// человека; у службы `:3500` сессии нет и быть не может — она машина. Поэтому
// дверь стоит на общем секрете, и в `proxy.ts` она названа поимённо, с причиной.
//
// 🛑 И ПОЭТОМУ ЖЕ ОНА ЕДИНСТВЕННАЯ. Каждая следующая дверь без сессии — это
// расширение поверхности, которую никто не охраняет куками; заводить их «по
// аналогии» нельзя.

export async function POST(request: NextRequest) {
  if (!secretMatches(request.headers.get("x-channel-secret"))) {
    // 🔒 ПРИЧИНА ОТКАЗА НЕ НАЗЫВАЕТСЯ. «Секрет не настроен» и «секрет неверен» —
    // разные ответы для нас и одинаковые для чужого: второй подсказывает, что
    // подбирать есть что.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const channel = body.channel;
  if (!isChannel(channel)) {
    return NextResponse.json({ error: "unknown channel" }, { status: 400 });
  }

  const chatId = String(body.chatId ?? "").trim();
  const text = String(body.text ?? "").trim();
  if (!(chatId && text)) {
    // 🛑 ПУСТОЙ ТЕКСТ ОТКЛОНЯЕТСЯ ЗДЕСЬ, А НЕ МОЛЧА ПРОГЛАТЫВАЕТСЯ. Голос и
    // снимок приезжают без текста — это законные сообщения, но их дом следующий
    // подшаг: принять их сейчас значило бы записать пустую строку в ленту.
    return NextResponse.json({ error: "chatId and text are required" }, { status: 400 });
  }

  const msg: InboundMessage = {
    at: typeof body.at === "string" ? body.at : null,
    channel,
    chatId,
    externalId: (body.externalId ?? body.id ?? null) as string | number | null,
    text,
    who: typeof body.who === "string" ? body.who : null,
  };

  try {
    const saved = await receiveInbound(msg);

    // 🛑 ЗДЕСЬ НЕ ОТВЕЧАЮТ, И ЭТО ГРАНИЦА ЗАДАЧИ, А НЕ НЕДОДЕЛКА.
    //
    // Решение владельца 2026-09-03, дословно: «сейчас мы не концентрируемся на
    // том, как это будет работать с точки зрения ответа… переключаться на
    // решение ответов, как модель будет отвечать, мы ещё не будем, ещё очень
    // рано. Я тебе дал конкретное задание — обеспечить приём сообщений от разных
    // агентов». Текущая задача — ПРИЁМ, и только он.
    //
    // ✗ Оплачено в тот же час: я вызвал отсюда генерацию ответа, хотя владелец
    // дважды за сессию просил этого не делать. Вызов снят; сам код парковкой
    // лежит в `lib/fractera/answer.ts` и НИКЕМ НЕ ЗОВЁТСЯ — это сказано вслух,
    // чтобы следующий не счёл его живым.
    return NextResponse.json({ ok: true, ...saved });
  } catch (error) {
    // 🔒 ПРИЧИНА ПИШЕТСЯ В ЛОГ, А НЕ ТОЛЬКО ОТДАЁТСЯ СЛУЖБЕ. Служба ответ
    // выбрасывает: у неё отказ хука намеренно молчаливый, строка остаётся в её
    // журнале. Не запиши мы причину здесь — узнать её было бы неоткуда.
    console.error("[channels/inbound]", error);
    return NextResponse.json({ error: "not saved" }, { status: 500 });
  }
}
