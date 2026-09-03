// @api inbound message from a channel service becomes a chat message

import { type NextRequest, NextResponse } from "next/server";
import { answerInboundMessage } from "@/lib/fractera/answer";
import {
  type InboundMessage,
  isChannel,
  receiveInbound,
  secretMatches,
} from "@/lib/fractera/channels";

// 🔒 ОТВЕТ МОДЕЛИ ИДЁТ ДОЛЬШЕ УМОЛЧАНИЯ NEXT. Дверь ждёт генерацию, а она
// занимает секунды; предел по умолчанию оборвал бы её на середине.
export const maxDuration = 60;

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

    // 🔒 ОТВЕТ РОЖДАЕТСЯ ЗДЕСЬ, А НЕ В СЛУЖБЕ (97-5). Служба переведена в режим
    // «отдаю приложению»: она больше не отвечает сама, иначе на один вопрос
    // человек получал бы два ответа — её из графа знаний и наш из чата.
    //
    // 🛑 ПОВТОР НЕ ОТВЕЧАЕТ ВТОРОЙ РАЗ. Служба повторяет доставку, если мы не
    // успели ответить вовремя; без этого условия каждый повтор порождал бы
    // новый ответ на уже отвеченное.
    //
    // 🔒 ЖДЁМ ЗАВЕРШЕНИЯ, А НЕ ОТПУСКАЕМ В ФОН. Служба считает доставку удачной
    // по нашему ответу; ответив раньше времени, мы сказали бы «принято» о работе,
    // которая ещё может не выйти. Цена — служба ждёт нас, и это правильная цена.
    let answered: Awaited<ReturnType<typeof answerInboundMessage>> | null = null;
    if (!saved.duplicate) {
      answered = await answerInboundMessage(saved.chatId);
    }

    return NextResponse.json({ ok: true, ...saved, answered });
  } catch (error) {
    // 🔒 ПРИЧИНА ПИШЕТСЯ В ЛОГ, А НЕ ТОЛЬКО ОТДАЁТСЯ СЛУЖБЕ. Служба ответ
    // выбрасывает: у неё отказ хука намеренно молчаливый, строка остаётся в её
    // журнале. Не запиши мы причину здесь — узнать её было бы неоткуда.
    console.error("[channels/inbound]", error);
    return NextResponse.json({ error: "not saved" }, { status: 500 });
  }
}
