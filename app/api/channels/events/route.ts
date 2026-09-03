// @api server-sent events: this chat got a new message

import type { NextRequest } from "next/server";
import postgres from "postgres";
import { auth } from "@/app/(auth)/auth";
import { getChatById } from "@/lib/db/queries";
import { CHAT_CHANNEL } from "@/lib/fractera/notify";

// ЖИВОЕ ОБНОВЛЕНИЕ ЛЕНТЫ — СЕРВЕР ГОВОРИТ ВКЛАДКЕ САМ (100-1, 2026-09-03).
//
// 🔒 SSE, А НЕ WEBSOCKET, И ДОВОД НЕ ВКУСОВОЙ. Здесь односторонний поток:
// говорит только сервер, вкладка молчит. Обратный канал у нас уже есть — это
// обычный запрос. WebSocket добавил бы своё рукопожатие, свой адаптер и своё
// поведение за прокси, не дав ничего сверх.
//
// 🔒 `EventSource` САМ ПЕРЕПОДКЛЮЧАЕТСЯ ПРИ ОБРЫВЕ — этого не надо писать.
//
// 🛑 `X-Accel-Buffering: no` — НЕ УКРАШЕНИЕ. nginx по умолчанию копит ответ в
// буфере и отдаёт кусками; для потока это означает, что событие доедет через
// минуту или не доедет вовсе. Заголовок выключает буфер для этого ответа, и
// править конфиг nginx не нужно — что важно, потому что nginx принадлежит
// платформе, а не проекту.
//
// 🔒 ЗАМОК ОБЫЧНЫЙ ДЛЯ ЭТОГО ПРИЛОЖЕНИЯ, И ПРОВЕРЯЕТСЯ ХОЗЯИН РАЗГОВОРА.
// Поток о чужом разговоре сообщал бы посторонним, что там идёт переписка, —
// это утечка, даже если содержимое не едет.
// 🛑 `runtime` И `dynamic` ЗДЕСЬ ЗАПРЕЩЕНЫ САМИМ ФРЕЙМВОРКОМ, И ЭТО НЕ ПРИДИРКА
// СБОРКИ. ✗ оплачено 2026-09-03: я перенёс эти две строки из гостевого стартера,
// где они законны, и сборка отказала словами «Route segment config "runtime" is
// not compatible with nextConfig.cacheComponents». У чата ВКЛЮЧЕНЫ
// `cacheComponents` — другая настройка проекта, и привычка соседнего репозитория
// здесь не действует.
//
// 🔒 УРОК ШИРЕ ЭТОГО ФАЙЛА: два наших репозитория на одном фреймворке настроены
// ПО-РАЗНОМУ, и код, скопированный между ними, проверяется сборкой, а не памятью.
//
// Поток и без этих строк динамический по природе: он читает сессию и держит
// соединение — закэшировать такое нечем.

// Держим соединение долго: короткий предел рвал бы поток каждые полминуты.
export const maxDuration = 3600;

/** Как часто посылать пустой комментарий, чтобы соединение не закрыли по тишине. */
const KEEPALIVE_MS = 25_000;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new Response("unauthorized", { status: 401 });
  }

  // 🔒 ПОТОК ПРИНАДЛЕЖИТ ЧЕЛОВЕКУ, А НЕ РАЗГОВОРУ (100-2, 2026-09-03).
  //
  // ✗ ОПЛАЧЕНО ЗАКАЗОМ ВЛАДЕЛЬЦА «исправь список слева, чтобы новый разговор
  // появлялся сам»: поток был привязан к ОТКРЫТОМУ разговору, и о разговоре,
  // которого на экране ещё нет, вкладка узнать не могла по устройству. Новый
  // собеседник писал боту — и не появлялся в списке до перезагрузки.
  //
  // Разговор теперь НЕОБЯЗАТЕЛЕН: он только выбирает, какие сообщения
  // пересылать. События о списке идут всегда, потому что список принадлежит
  // человеку целиком.
  const chatId = request.nextUrl.searchParams.get("chatId") ?? "";

  if (chatId) {
    const chat = await getChatById({ id: chatId });
    if (!chat || chat.userId !== session.user.id) {
      // Тот же ответ на «нет такого» и «чужой»: разные ответы подсказали бы,
      // какие разговоры существуют.
      return new Response("not found", { status: 404 });
    }
  }

  const url = process.env.POSTGRES_URL ?? "";
  if (!url) {
    return new Response("no database", { status: 503 });
  }

  // 🔒 ОТДЕЛЬНОЕ СОЕДИНЕНИЕ НА СЛУШАТЕЛЯ — ТРЕБОВАНИЕ POSTGRES, А НЕ ВЫБОР.
  // Соединение, занятое `LISTEN`, не может обслуживать запросы; взяв его из
  // общего пула, мы вынули бы у приложения рабочую руку на всё время, пока
  // открыта вкладка.
  const client = postgres(url, { max: 1 });

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: string) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          closed = true;
        }
      };

      // Первое событие отправляется сразу: браузер считает поток открытым только
      // после первых байт, и без этого «подключено» наступало бы с задержкой.
      send(": open\n\n");

      let unlisten: (() => Promise<unknown>) | null = null;
      try {
        const sub = await client.listen(CHAT_CHANNEL, (payload) => {
          // Фильтруем здесь: канал в базе один на приложение. Канал на разговор
          // означал бы тысячи каналов и столько же соединений.
          let event: { c?: string; u?: string };
          try {
            event = JSON.parse(payload) as { c?: string; u?: string };
          } catch {
            return;
          }

          // 🔒 ЧУЖОЕ ОТБРАСЫВАЕТСЯ ПО ХОЗЯИНУ, И ЭТО РЕШАЕТСЯ БЕЗ ЗАПРОСА К БАЗЕ.
          // Хозяин приехал в самом сигнале; спрашивать базу на каждое чужое
          // уведомление значило бы платить запросом за каждое сообщение каждого
          // человека на сервере.
          if (!event.u || event.u !== session.user.id || !event.c) {
            return;
          }

          // Список разговоров принадлежит человеку — событие о нём идёт всегда,
          // даже когда открыт другой разговор или ни одного.
          send(`event: chats\ndata: ${event.c}\n\n`);

          // Сообщения пересылаются только для открытого разговора: остальные
          // вкладке сейчас не нужны, а их содержимое — лишний повод для запроса.
          if (chatId && event.c === chatId) {
            send(`data: ${event.c}\n\n`);
          }
        });
        unlisten = sub.unlisten;
      } catch {
        send(": listen failed\n\n");
      }

      const beat = setInterval(() => {
        send(": ping\n\n");
      }, KEEPALIVE_MS);

      const stop = async () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(beat);
        try {
          await unlisten?.();
        } catch {
          // соединение всё равно закрывается ниже
        }
        try {
          await client.end();
        } catch {
          // уже закрыто
        }
        try {
          controller.close();
        } catch {
          // уже закрыт
        }
      };

      // 🛑 УБОРКА ОБЯЗАТЕЛЬНА. Вкладку закрывают, а слушатель и его соединение
      // остались бы жить: через день таких «мёртвых» соединений набирается
      // столько, что Postgres перестаёт принимать новые — и виновата будет
      // выглядеть база.
      request.signal.addEventListener("abort", stop);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
