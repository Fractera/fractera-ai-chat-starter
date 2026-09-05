import { NextResponse } from "next/server";
import {
  claudeAuthState,
  maskToken,
  readTelegramAccess,
  readTelegramToken,
  TELEGRAM_TOKEN_RE,
  writeTelegramToken,
} from "@/lib/fractera/claude-cli.mjs";
import { fracteraRoles } from "@/lib/fractera/session";

// ДВЕРЬ ПОДКЛЮЧЕНИЯ АГЕНТА: ПОДПИСКА И ТОКЕН БОТА (шаг 115).
//
// 🔒 ОДНА ДВЕРЬ НА ОБЕ ПОЛОВИНЫ, ПОТОМУ ЧТО ОКНО ОДНО. Владелец: «в нашей
// кнопке… расширим функционал и вставим дополнительное поле для Telegram-бота».
// Две двери означали бы два запроса ради одного экрана и два места, где
// проверяется одна и та же роль.
//
// 🔒 ЗАМОК — `architect`, ТОТ ЖЕ, ЧТО У ТЕРМИНАЛА И КЛЮЧА OpenAI. Токен бота
// это доступ к переписке владельца; давать его более широкому кругу, чем тому,
// кому доверена оболочка сервера, нельзя ни при каком доводе об удобстве.
//
// 🛑 НАРУЖУ ТОКЕН НЕ ВЫХОДИТ НИКОГДА — только признак «есть» и маска. Тот же
// закон, что у двери ключа OpenAI: маска отвечает на вопрос «тот ли токен», не
// отдавая токена.
//
// 🛑 НАСТРОЕК СЕГМЕНТА ЗДЕСЬ НЕТ: у шаблона включён `cacheComponents`, и он
// несовместим ни с `runtime`, ни с `dynamic`. Дверь читает файл и куки — значит
// и так исполняется на узле.

function payload() {
  const auth = claudeAuthState();
  const token = readTelegramToken();
  const access = readTelegramAccess();
  return {
    subscription: { loggedIn: auth.loggedIn, method: auth.method },
    telegram: {
      // Сколько собеседников уже привязано и какие коды ждут привязки. Окно
      // опрашивает эту дверь, пока открыто, — поэтому код, пришедший человеку
      // в Telegram, появляется у него на экране САМ, без переписывания.
      allowed: access.allowed,
      masked: maskToken(token),
      pending: access.pending,
      present: Boolean(token),
    },
  };
}

export async function GET() {
  const roles = await fracteraRoles();
  if (!roles.includes("architect")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json(payload(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const roles = await fracteraRoles();
  if (!roles.includes("architect")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    token?: string;
  } | null;
  const token = (body?.token ?? "").trim();

  // 🔒 ФОРМА ПРОВЕРЯЕТСЯ ДО ЗАПИСИ. Токен, не похожий на токен, — это опечатка,
  // и записанный он ломает не эту страницу, а запуск канала через минуту, где
  // причина будет выглядеть как «Telegram не отвечает».
  if (!TELEGRAM_TOKEN_RE.test(token)) {
    return NextResponse.json({ error: "bad-format" }, { status: 400 });
  }

  try {
    writeTelegramToken(token);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "write-failed", reason: message },
      { status: 500 }
    );
  }

  // 🛑 «СОХРАНЕНО» И «РАБОТАЕТ» — РАЗНЫЕ УТВЕРЖДЕНИЯ, И ЭТО СКАЗАНО ОТВЕТОМ.
  // Плагин читает файл при запуске канала; пока канал не запущен, записанный
  // токен не проверен ничем, кроме своей формы.
  return NextResponse.json({ ...payload(), saved: true });
}
