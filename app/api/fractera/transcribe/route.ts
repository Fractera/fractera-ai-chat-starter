import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { fracteraRoles } from "@/lib/fractera/session";

// РАСШИФРОВКА ГОЛОСА — НАШИМ КЛЮЧОМ, БЕЗ ВТОРОГО ПУТИ (шаг 96).
//
// 🔒 ТОТ ЖЕ КЛЮЧ, ЧТО У ВСЕГО ОСТАЛЬНОГО: читается из файла проекта на каждом
// обращении. Ключа нет — отвечаем `409` и словами, а не молчаливым отказом:
// пустое поле после долгой записи человек читает как «микрофон сломался».
//
// 🔒 ГОЛОС ХРАНИТСЯ ОТДЕЛЬНО ОТ РАСШИФРОВКИ. Эта дверь только переводит звук в
// текст; сама запись уезжает в медиатеку обычным вложением и остаётся в ленте.
// ✗ у бота сохранялась ТОЛЬКО расшифровка, и всё, чем голос отличается от
// текста, терялось безвозвратно — здесь эта ошибка не повторяется.

const MAX_BYTES = 25 * 1024 * 1024;

function openAiKey(): string {
  const path = process.env.FRACTERA_SLOT_ENV || "/opt/fractera/app/.env.local";
  try {
    const raw = readFileSync(path, "utf8");
    const found = (raw.match(/^OPENAI_API_KEY=(.+)$/m) ?? [])[1];
    if (found?.trim()) {
      return found.trim();
    }
  } catch {
    // Файла нет — берём окружение процесса.
  }
  return process.env.OPENAI_API_KEY ?? "";
}

export async function POST(request: Request) {
  const roles = await fracteraRoles();
  if (!roles.includes("architect")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const key = openAiKey();
  if (!key) {
    return NextResponse.json({ error: "no-key" }, { status: 409 });
  }

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "no-audio" }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: "too-big" }, { status: 413 });
  }

  const upstream = new FormData();
  upstream.append("file", audio, audio.name || "voice.webm");
  // 🔒 ИМЯ МОДЕЛИ — НАСТРОЙКА, А НЕ ЛИТЕРАЛ, как и у текстовых моделей.
  upstream.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe");

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      body: upstream,
      headers: { Authorization: `Bearer ${key}` },
      method: "POST",
    });

    if (!res.ok) {
      // 🛑 ПРИЧИНА ОТКАЗА ПЕРЕДАЁТСЯ, А НЕ ГЛОТАЕТСЯ: «кончились деньги» и
      // «модель не та» лечатся по-разному, а выглядят одинаково.
      const text = await res.text();
      return NextResponse.json(
        { error: "upstream", detail: text.slice(0, 200) },
        { status: 502 },
      );
    }

    const d = (await res.json()) as { text?: string };
    return NextResponse.json({ text: d.text ?? "" });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
