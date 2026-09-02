import { NextResponse } from "next/server";
import { chatUiOf } from "@/lib/fractera/i18n";

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

  const url = new URL(request.url);
  const back = `${url.protocol}//${url.host}/`;

  return NextResponse.redirect(
    `${authBase}/register?callbackUrl=${encodeURIComponent(back)}&requireRole=user&reason=${encodeURIComponent(ui.guestBlocked)}`,
  );
}
