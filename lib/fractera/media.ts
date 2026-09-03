// МЕДИАТЕКА ПРОЕКТА — ОДНО ХРАНИЛИЩЕ ФАЙЛОВ НА ВЕСЬ СЕРВЕР (шаг 96).
//
// 🔒 ТОТ ЖЕ СКЛАД, ЧТО У БОТА. Снимок чека из Telegram и картинка, брошенная в
// чат, ложатся в одно место: «все файлы проекта» обязано быть одним ответом, а
// не двумя списками в разных службах.
//
// 🔒 АДРЕС И КЛЮЧ СЛОЯ ДАННЫХ ЧИТАЮТСЯ ИЗ ФАЙЛА ПРОЕКТА, как и ключ модели.
// Своей копии секрета у чата нет: второй путь секрета расходится с первым молча.

import { slotEnv } from "./slot-env";

type Stored = { contentType: string; name: string; pathname: string; url: string };

/** Запись медиатеки — та её часть, что нужна ленте сообщений. */
type MediaItem = { id: string; mime_type?: string; name?: string };

function dataService(): { key: string; url: string } {
  return {
    key: process.env.DATA_SECRET || slotEnv("DATA_SECRET") || slotEnv("DATA_API_KEY"),
    url: process.env.REMOTE_DATA_URL || slotEnv("REMOTE_DATA_URL") || "http://localhost:3300",
  };
}

/**
 * Положить файл в медиатеку и вернуть его публичный адрес.
 *
 * 🛑 АДРЕС БЕРЁТСЯ ИЗ ОТВЕТА СКЛАДА, А НЕ СОБИРАЕТСЯ ПО ШАБЛОНУ. Закон проекта,
 * оплаченный дважды: собранный по догадке путь однажды перестаёт совпадать с
 * настоящим, и картинка молча исчезает из ленты.
 */
export async function uploadToMedia(file: File): Promise<Stored> {
  const { url, key } = dataService();
  if (!key) {
    throw new Error("Медиатека недоступна: у службы нет ключа слоя данных");
  }

  const form = new FormData();
  form.append("file", file, file.name);

  const res = await fetch(`${url}/media/upload`, {
    body: form,
    headers: { "X-Data-Secret": key },
    method: "POST",
  });

  const d = (await res.json().catch(() => null)) as
    | { ok?: boolean; error?: string; item?: MediaItem }
    | null;

  // 🔒 СКЛАД ОТВЕЧАЕТ КОНВЕРТОМ `{ ok, item }`, А НЕ САМОЙ ЗАПИСЬЮ — ИЗМЕРЕНО
  // ЖИВЬЁМ 2026-09-02 запросом к `:3300`, а не выведено по форме соседней двери.
  // ✗ Оплачено: код читал `id` на верхнем уровне ответа, получал `undefined`
  // при КАЖДОЙ успешной загрузке и говорил человеку «Upload failed». Файл при
  // этом ложился в медиатеку — отказ был не только ложным, но и оставлял в
  // складе запись, о которой чат ничего не знал.
  if (!(res.ok && d?.ok && d.item?.id)) {
    throw new Error(d?.error ?? `Медиатека отказала: HTTP ${res.status}`);
  }

  const item = d.item;

  // 🔒 ЧЕРЕЗ СВОЙ МАРШРУТ, А НЕ ПРЯМО В СЛОЙ ДАННЫХ: его адрес требует ключа,
  // и отдавать браузеру ссылку, которая без секрета не открывается, значит
  // показать человеку сломанную картинку.
  return {
    contentType: item.mime_type ?? file.type,
    name: item.name ?? file.name,
    pathname: `/api/fractera/media/${item.id}`,
    url: `/api/fractera/media/${item.id}`,
  };
}

/** Отдать файл медиатеки браузеру: ключ остаётся на сервере. */
export async function fetchMedia(id: string): Promise<Response | null> {
  const { url, key } = dataService();
  if (!key) {
    return null;
  }
  try {
    const res = await fetch(`${url}/media/${encodeURIComponent(id)}/file`, {
      headers: { "X-Data-Secret": key },
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/**
 * Превратить вложения медиатеки в то, что модель действительно может прочесть.
 *
 * 🔒 МОДЕЛЬ НЕ ХОДИТ ПО НАШИМ АДРЕСАМ, И ЭТО НЕ НАСТРОЙКА, А УСТРОЙСТВО.
 * Адрес `/api/fractera/media/<id>` относительный и стоит под замком роли: для
 * OpenAI он не существует — ни открыть, ни авторизоваться. Поэтому картинка
 * уезжает СОДЕРЖИМЫМ (`data:`), а не ссылкой.
 *
 * 🔒 НЕ-КАРТИНКА СТАНОВИТСЯ СТРОКОЙ, А НЕ ИСЧЕЗАЕТ. Звук, видео и документ
 * модель этой линейки как файл не принимает; молча выбросить их значило бы
 * сказать ей неправду о разговоре — человек файл приложил. Голос при этом уже
 * приезжает расшифровкой в тексте, так что смысл не теряется.
 */
export async function inlineAttachmentsForModel<
  T extends { parts?: unknown[] },
>(messages: T[]): Promise<T[]> {
  return await Promise.all(
    messages.map(async (message) => {
      if (!Array.isArray(message.parts)) {
        return message;
      }

      const parts = await Promise.all(
        message.parts.map(async (part) => {
          const p = part as {
            type?: string;
            url?: string;
            mediaType?: string;
            name?: string;
          };
          if (p?.type !== "file" || typeof p.url !== "string") {
            return part;
          }
          if (!p.url.startsWith("/api/fractera/media/")) {
            return part;
          }

          const id = p.url.slice("/api/fractera/media/".length);
          const kind = (p.mediaType ?? "").split("/")[0];

          if (kind !== "image") {
            return {
              text: `[вложение: ${p.name ?? "файл"}, ${p.mediaType ?? "неизвестный род"}]`,
              type: "text",
            };
          }

          const res = await fetchMedia(id);
          if (!res) {
            return {
              text: `[вложение недоступно: ${p.name ?? id}]`,
              type: "text",
            };
          }
          const buf = Buffer.from(await res.arrayBuffer());
          return {
            ...p,
            url: `data:${p.mediaType ?? "image/png"};base64,${buf.toString("base64")}`,
          };
        }),
      );

      return { ...message, parts };
    }),
  );
}
