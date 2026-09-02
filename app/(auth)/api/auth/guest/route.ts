import { NextResponse } from "next/server";

// ГОСТЕВОЙ ВХОД ЗАКРЫТ (правка владельца 2026-09-02).
//
// 🔒 ЕГО СЛОВА: «сделай блокировку гостевого способа регистрации… запрети
// гостевые сообщения без регистрации». Шаблон заводил здесь безымянного
// пользователя одним переходом — это была бы ВТОРАЯ ПРАВДА О ЧЕЛОВЕКЕ: чат знал
// бы своих гостей, а проект — своих людей, и связать их потом нечем.
//
// 🔒 МАРШРУТ ОСТАВЛЕН ЖИТЬ И ОТВЕЧАЕТ ОТКАЗОМ, А НЕ УДАЛЁН. Удалённый маршрут
// даёт `404`, который читается как «сломалось»; отказ называет причину и уводит
// туда, где вход настоящий. Заодно старые ссылки и закладки не обрываются.
//
// 🛑 ОДНОЙ ЭТОЙ ДВЕРИ МАЛО, И ЭТО СКАЗАНО ЗДЕСЬ, А НЕ ПОДРАЗУМЕВАЕТСЯ: гостя
// закрывают ТРИ замка — этот, переадресация в `proxy.ts` и проверка роли на
// двери сообщений. Один замок обходят, три — нет.
export async function GET(request: Request) {
  const ui = chatUiOf(request.headers.get("accept-language"));
  const authBase =
    process.env.NEXT_PUBLIC_AUTH_URL ||
    process.env.AUTH_SERVICE_URL ||
    "http://localhost:3001";

  // 🛑 АДРЕС ВОЗВРАТА — ИЗ ЗАГОЛОВКОВ NGINX, А НЕ ИЗ request.url. ✗ измерено
  // дважды за день: внутренний адрес за прокси выглядит как localhost:3600, и
  // человек после входа попадал бы в никуда. Тот же приём, что в proxy.ts.
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const back = host ? `${proto}://${host}/` : new URL(request.url).origin + "/";

  return NextResponse.redirect(
    `${authBase}/login?redirectUrl=${encodeURIComponent(back)}`,
  );
}
