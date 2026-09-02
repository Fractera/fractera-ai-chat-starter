import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { fracteraRoles } from "@/lib/fractera/session";
import { ALLOWED_MEDIA_TYPES } from "@/lib/fractera/attachments";
import { uploadToMedia } from "@/lib/fractera/media";

// ВЛОЖЕНИЯ ЕДУТ В МЕДИАТЕКУ ПРОЕКТА, А НЕ В VERCEL BLOB (шаг 96).
//
// 🔒 ФАЙЛЫ ЖИВУТ НА СЕРВЕРЕ ВЛАДЕЛЬЦА. Шаблон клал их в стороннее хранилище по
// токену; у нас есть свой склад — медиатека слоя данных `:3300`, та же, куда
// попадают снимки из Telegram. Второе хранилище означало бы, что «все файлы
// проекта» перестало быть одним местом.
//
// 🔒 ЧЕТЫРЕ РОДА ВМЕСТО ДВУХ (правка владельца 2026-09-02): картинка, звук,
// видео, документ. Шаблон принимал только JPEG и PNG — то есть голосовое
// сообщение он отвергал молча, ещё до того, как мы научились его записывать.
//
// 🛑 ПОТОЛОК РАЗМЕРА НАЗВАН И СОГЛАСОВАН СО СЛОЕМ ДАННЫХ: у него 200 МБ, у
// nginx столько же. Число меньше здесь — законно (звук и картинки столько не
// весят), число БОЛЬШЕ было бы ложью: файл всё равно не доехал бы.

const MAX_BYTES = 25 * 1024 * 1024;

// 🔒 СПИСОК РОДОВ — ОБЩИЙ С ДВЕРЬЮ ОТПРАВКИ СООБЩЕНИЯ (`lib/fractera/attachments`).
const ALLOWED: readonly string[] = ALLOWED_MEDIA_TYPES;

const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= MAX_BYTES, {
      message: "Файл больше 25 МБ",
    })
    .refine((file) => ALLOWED.some((t) => file.type.startsWith(t.split("/")[0] + "/") && ALLOWED.includes(file.type)), {
      message: "Такой род файла не принимается",
    }),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Тот же замок, что у сообщений: чат целиком принадлежит архитектору.
  const roles = await fracteraRoles();
  if (!roles.includes("architect")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (request.body === null) {
    return new Response("Request body is empty", { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const validated = FileSchema.safeParse({ file });
    if (!validated.success) {
      return NextResponse.json(
        { error: validated.error.issues.map((i) => i.message).join(", ") },
        { status: 400 },
      );
    }

    const stored = await uploadToMedia(file);

    // 🔒 ФОРМА ОТВЕТА — ТА ЖЕ, ЧТО У ШАБЛОНА (`url`, `pathname`,
    // `contentType`): её ждут поле ввода и лента сообщений, и менять её значило
    // бы править обе стороны ради переезда хранилища.
    return NextResponse.json(stored);
  } catch (error) {
    // 🔒 ПРИЧИНА ОТКАЗА ЕДЕТ ЧЕЛОВЕКУ, А НЕ ОСТАЁТСЯ В ЛОГЕ.
    // ✗ Оплачено 2026-09-02: здесь стояло глухое «Upload failed» на любой
    // исход, и настоящая причина — чат читал ответ склада не в той форме —
    // не была видна ни в браузере, ни на экране. Отладка началась с чтения
    // чужого кода вместо чтения сообщения об ошибке.
    const reason = error instanceof Error ? error.message : "Upload failed";
    console.error("[chat] загрузка вложения не удалась:", reason);
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}
