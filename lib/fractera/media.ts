// МЕДИАТЕКА ПРОЕКТА — ОДНО ХРАНИЛИЩЕ ФАЙЛОВ НА ВЕСЬ СЕРВЕР (шаг 96).
//
// 🔒 ТОТ ЖЕ СКЛАД, ЧТО У БОТА. Снимок чека из Telegram и картинка, брошенная в
// чат, ложатся в одно место: «все файлы проекта» обязано быть одним ответом, а
// не двумя списками в разных службах.
//
// 🔒 АДРЕС И КЛЮЧ СЛОЯ ДАННЫХ ЧИТАЮТСЯ ИЗ ФАЙЛА ПРОЕКТА, как и ключ модели.
// Своей копии секрета у чата нет: второй путь секрета расходится с первым молча.

import { readFileSync } from "node:fs";

type Stored = { contentType: string; name: string; pathname: string; url: string };

/** Запись медиатеки — та её часть, что нужна ленте сообщений. */
type MediaItem = { id: string; mime_type?: string; name?: string };

function slotEnv(key: string): string {
  const path = process.env.FRACTERA_SLOT_ENV || "/opt/fractera/app/.env.local";
  try {
    const raw = readFileSync(path, "utf8");
    return (raw.match(new RegExp(`^${key}=(.+)$`, "m")) ?? [])[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

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
