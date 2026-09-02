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
export async function uploadToMedia(file: File): Promise<Stored | null> {
  const { url, key } = dataService();
  if (!key) {
    return null;
  }

  const form = new FormData();
  form.append("file", file, file.name);

  try {
    const res = await fetch(`${url}/media/upload`, {
      body: form,
      headers: { "X-Data-Secret": key },
      method: "POST",
    });
    if (!res.ok) {
      return null;
    }

    const d = (await res.json()) as { id?: string; url?: string; name?: string; mime_type?: string };
    if (!d?.id) {
      return null;
    }

    // 🔒 ЧЕРЕЗ СВОЙ МАРШРУТ, А НЕ ПРЯМО В СЛОЙ ДАННЫХ: его адрес требует ключа,
    // и отдавать браузеру ссылку, которая без секрета не открывается, значит
    // показать человеку сломанную картинку.
    return {
      contentType: d.mime_type ?? file.type,
      name: d.name ?? file.name,
      pathname: `/api/fractera/media/${d.id}`,
      url: `/api/fractera/media/${d.id}`,
    };
  } catch {
    return null;
  }
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
