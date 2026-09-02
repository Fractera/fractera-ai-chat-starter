// РОДА ВЛОЖЕНИЙ — ОДИН СПИСОК НА ВЕСЬ ЧАТ (шаг 96).
//
// 🔒 ПЕРЕЧИСЛЕНИЕ ЖИВЁТ В ОДНОМ МЕСТЕ, ПОТОМУ ЧТО ДВЕРЕЙ ДВЕ. Файл проходит
// через ДВА замка: дверь загрузки (`/api/files/upload`) и схему отправки
// сообщения (`/api/chat`). Два списка расходятся молча — и расходились:
// дверь загрузки уже принимала четыре рода, а схема сообщения оставалась
// шаблонной, с JPEG и PNG. Файл ложился в медиатеку, показывался в поле
// ввода — и разговор отказывался его отправлять.
//
// ✗ Оплачено 2026-09-02: владелец увидел «The request couldn't be processed»
// на отправке, уже имея загруженный файл на экране.

export const ALLOWED_MEDIA_TYPES = [
  // изображения
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  // звук: сюда попадает и голосовая запись из браузера
  "audio/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  // видео
  "video/mp4",
  "video/webm",
  "video/quicktime",
  // документы
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
] as const;

export type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

/** Приставка адреса, под которой чат отдаёт файлы медиатеки. */
export const MEDIA_URL_PREFIX = "/api/fractera/media/";

/**
 * Адрес вложения годен?
 *
 * 🔒 ОТНОСИТЕЛЬНЫЙ АДРЕС МЕДИАТЕКИ — ЗАКОННЫЙ, И ЭТО НЕ ПОСЛАБЛЕНИЕ. Шаблон
 * требовал абсолютный URL, потому что файлы жили в чужом хранилище с полным
 * адресом. Наши лежат на этом же сервере, и путь `/api/fractera/media/<id>`
 * ведёт в нашу же дверь — под тем же замком, что и разговор.
 */
export function isAllowedAttachmentUrl(url: string): boolean {
  if (url.startsWith(MEDIA_URL_PREFIX)) {
    return true;
  }
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
