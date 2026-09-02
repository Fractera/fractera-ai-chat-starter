import { NextResponse } from "next/server";
import { fetchMedia } from "@/lib/fractera/media";
import { fracteraRoles } from "@/lib/fractera/session";

// ФАЙЛ ИЗ МЕДИАТЕКИ — ЧЕРЕЗ НАШ МАРШРУТ, А НЕ ПРЯМОЙ ССЫЛКОЙ (шаг 96).
//
// 🔒 КЛЮЧ СКЛАДА ОСТАЁТСЯ НА СЕРВЕРЕ. Слой данных отдаёт файл только с
// секретом; ссылка с секретом в разметке — это секрет, опубликованный в
// браузере каждого, кто откроет вкладку разработчика.
//
// 🔒 ЗАМОК ТОТ ЖЕ, ЧТО У ЧАТА: файлы разговора принадлежат архитектору. Иначе
// адрес файла становится дырой в обход всех остальных замков.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const roles = await fracteraRoles();
  if (!roles.includes("architect")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const res = await fetchMedia(id);
  if (!res) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  // Тело и род переносятся как есть: переупаковка испортила бы видео и звук.
  return new Response(res.body, {
    headers: {
      "Cache-Control": "private, max-age=3600",
      "Content-Type": res.headers.get("content-type") ?? "application/octet-stream",
    },
  });
}
