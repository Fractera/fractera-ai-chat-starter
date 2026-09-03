import "server-only";

import { uploadToMedia } from "./media";

// ФАЙЛ ИЗ КАНАЛА ЛОЖИТСЯ В МЕДИАТЕКУ ПРОЕКТА (97-7, 2026-09-03).
//
// ✗ ЗАКАЗ ВЛАДЕЛЬЦА, ПРОВЕРИВШЕГО ЖИВОЕ ОБНОВЛЕНИЕ: «сообщение появилось в чате
// сразу, but only text, not foto». Текст доезжал, снимок — нет: дверь принимала
// только сообщения с текстом, и это было названо в её коде границей подшага.
//
// 🔒 БАЙТЫ ИДУТ ЧЕРЕЗ СЛУЖБУ, А НЕ ПРЯМО ИЗ TELEGRAM. Адрес файла у Telegram
// содержит ТОКЕН БОТА целиком — попроси мы файл сами, токен оказался бы в нашем
// коде, в логах и в истории запросов. Служба скачивает и отдаёт нам голые байты;
// токен не покидает её.
//
// 🔒 ФАЙЛ ЛОЖИТСЯ В МЕДИАТЕКУ ПРОЕКТА — ТУДА ЖЕ, КУДА КАРТИНКА ИЗ БРАУЗЕРА.
// Закон шага 96: «все файлы проекта» обязано быть ОДНИМ ответом, а не тремя
// списками в трёх службах. Это тот же закон единственного хранилища, что и у
// сообщений.

/** Адрес службы каналов. Своей копии секрета у чата нет. */
function channelsUrl(): string {
  return process.env.CHANNELS_SERVICE_URL || "http://127.0.0.1:3500";
}

/**
 * Род файла по имени, которое дала Telegram.
 *
 * 🛑 TELEGRAM НЕ ПРИСЫЛАЕТ ТИП СОДЕРЖИМОГО — ТОЛЬКО ПУТЬ ВРОДЕ
 * `photos/file_12.jpg`. Медиатека же адресует файл ИМЕНЕМ и решает по
 * расширению, чем его потом читать. Поэтому тип выводится из расширения, а не
 * берётся из заголовка, которого нет.
 *
 * 🔒 НЕИЗВЕСТНОЕ РАСШИРЕНИЕ — НЕ ОТКАЗ. Файл сохраняется как двоичный: потерять
 * присланное хуже, чем сохранить его без точного типа.
 */
function mimeOf(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    oga: "audio/ogg",
    ogg: "audio/ogg",
    pdf: "application/pdf",
    png: "image/png",
    txt: "text/plain",
    wav: "audio/wav",
    webm: "video/webm",
    webp: "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Вложение сообщения в форме, которую понимает лента чата. */
export type ChannelAttachment = {
  name: string;
  url: string;
  contentType: string;
};

/**
 * Забрать файл у службы каналов и положить в медиатеку проекта.
 *
 * 🔒 ОТКАЗ ВОЗВРАЩАЕТСЯ `null`, А НЕ БРОСАЕТСЯ ИСКЛЮЧЕНИЕМ. Сообщение с
 * непринятым файлом всё равно обязано попасть в ленту: текст подписи, время и
 * автор — уже ценность, и терять их из-за неудачной картинки нельзя.
 * ✗ ровно так в прототипе однажды пропал снимок чека вместе с сообщением.
 */
export async function pullChannelFile(
  fileId: string,
  bot?: string
): Promise<ChannelAttachment | null> {
  try {
    const suffix = bot ? `&bot=${encodeURIComponent(bot)}` : "";
    const r = await fetch(
      `${channelsUrl()}/telegram/file?id=${encodeURIComponent(fileId)}${suffix}`,
      { signal: AbortSignal.timeout(30_000) }
    );
    if (!r.ok) {
      return null;
    }
    // Имя приходит заголовком: служба берёт его из пути, который дала Telegram.
    const name = r.headers.get("x-file-name") || `${fileId}.bin`;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.byteLength === 0) {
      return null;
    }
    const type = mimeOf(name);
    const stored = await uploadToMedia(new File([bytes], name, { type }));
    return { contentType: stored.contentType, name: stored.name, url: stored.url };
  } catch {
    return null;
  }
}
