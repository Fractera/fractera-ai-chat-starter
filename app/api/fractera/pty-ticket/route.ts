import { NextResponse } from "next/server";
import {
  mintPtyTicket,
  PTY_TICKET_TTL_MS,
} from "@/lib/fractera/pty-ticket.mjs";
import { fracteraSession } from "@/lib/fractera/session";

// ДВЕРЬ БИЛЕТА НА ТЕРМИНАЛ (шаг 114-3).
//
// 🔒 ЗАМОК СТОИТ ЗДЕСЬ, А НЕ В МОСТУ, И ЭТО РАЗДЕЛЕНИЕ НАМЕРЕННОЕ. Здесь живёт
// знание о том, КТО вправе открыть терминал, — и оно спрашивается у той же
// единственной службы входа `:3001`, что и везде в чате (`fracteraSession()`).
// Мост знает только, действителен ли предъявленный билет, и о ролях не знает
// ничего: вторая копия правила о правах разошлась бы с этой на первой правке.
//
// 🔒 РОЛЬ — `architect`, ТА ЖЕ, ЧТО У КЛЮЧА OPENAI. Терминал — это оболочка на
// боевой машине; давать её более широкому кругу, чем тому, кому доверен ключ,
// нельзя ни при каком доводе об удобстве.
//
// 🛑 НАСТРОЕК СЕГМЕНТА ЗДЕСЬ НЕТ, И ЭТО ИЗМЕРЕНО СБОРКОЙ СОСЕДА: у шаблона
// включён `cacheComponents`, несовместимый и с `runtime`, и с `dynamic`. Дверь
// читает куки — значит и так исполняется на узле, объявлять это нечем.
//
// 🛑 ОТВЕТ НЕ КЭШИРУЕТСЯ НИКОГДА. Билет одноразовый: отданный из кэша второму
// человеку он был бы уже погашен, и терминал не открылся бы у обоих.

export async function POST() {
  const session = await fracteraSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!session.roles.includes("architect")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { expiresInMs, ticket } = mintPtyTicket(session.email);
  return NextResponse.json(
    { expiresInMs, ticket, ttlMs: PTY_TICKET_TTL_MS },
    { headers: { "Cache-Control": "no-store" } }
  );
}
