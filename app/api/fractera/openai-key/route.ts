import { readFile, writeFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { fracteraRoles } from "@/lib/fractera/session";

// КЛЮЧ OpenAI — ОДИН НА ВЕСЬ СЕРВЕР, И ЧАТ ЕГО НЕ КОПИРУЕТ (шаг 96).
//
// 🔒 ЗАКОН ПРОЕКТА: ключ один, потребителей несколько — проект, слой данных,
// граф знаний, теперь чат. Каждый, кто заводит СВОЙ файл с ключом, добавляет
// путь, о котором остальные не знают: плашка «ключ задан» станет врать, а отказ
// второго потребителя будет молчаливым.
//
// 🔒 ПОЭТОМУ ЧИТАЕМ И ПИШЕМ ФАЙЛ ГОСТЕВОГО ПРИЛОЖЕНИЯ — тот же `.env.local`,
// который читает сам проект. Путь приходит настройкой: на чужой машине его нет,
// и это законное состояние, а не поломка.
//
// 🔒 ЗАМОК: ТОЛЬКО АРХИТЕКТОР. Ключ — это деньги владельца; читать его маску и
// тем более записывать новый вправе тот же, кому доверен весь этот чат.
//
// 🛑 НАРУЖУ КЛЮЧ НЕ ВЫХОДИТ НИКОГДА. Отдаём только признак «есть» и первые
// символы: маска отвечает на вопрос «тот ли ключ», не отдавая сам ключ.

// 🛑 НАСТРОЕК СЕГМЕНТА ЗДЕСЬ НЕТ, И ЭТО ИЗМЕРЕНО СБОРКОЙ: у шаблона включён
// `cacheComponents`, и он несовместим ни с `runtime`, ни с `dynamic`. Дверь
// читает файл — значит и так исполняется на узле; объявлять это нечем и незачем.

function slotEnvPath(): string {
  return process.env.FRACTERA_SLOT_ENV || "/opt/fractera/app/.env.local";
}

function maskOf(key: string): string {
  return key ? `${key.slice(0, 7)}…${key.slice(-4)}` : "";
}

async function readKey(): Promise<string> {
  try {
    const raw = await readFile(slotEnvPath(), "utf8");
    return (raw.match(/^OPENAI_API_KEY=(.+)$/m) ?? [])[1]?.trim() ?? "";
  } catch {
    return process.env.OPENAI_API_KEY ?? "";
  }
}

export async function GET() {
  const roles = await fracteraRoles();
  if (!roles.includes("architect")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const key = await readKey();
  return NextResponse.json({ masked: maskOf(key), present: Boolean(key) });
}

export async function POST(request: Request) {
  const roles = await fracteraRoles();
  if (!roles.includes("architect")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { key?: string } | null;
  const key = (body?.key ?? "").trim();

  // 🔒 ФОРМА ПРОВЕРЯЕТСЯ ДО ЗАПИСИ. Ключ, не похожий на ключ, — это опечатка, и
  // записанный он ломает не эту страницу, а разбор сообщений через час.
  if (!key.startsWith("sk-") || key.length < 20) {
    return NextResponse.json({ error: "bad-format" }, { status: 400 });
  }

  try {
    const path = slotEnvPath();
    const raw = await readFile(path, "utf8").catch(() => "");
    // 🔒 ПРАВИТСЯ ОДНА НАЗВАННАЯ СТРОКА, А НЕ ФАЙЛ ЦЕЛИКОМ: рядом лежат ключи
    // доступа к серверу и состояние мастера запуска, и «записать файл целиком»
    // в этом слое не появится никогда.
    const next = /^OPENAI_API_KEY=.*$/m.test(raw)
      ? raw.replace(/^OPENAI_API_KEY=.*$/m, `OPENAI_API_KEY=${key}`)
      : `${raw.endsWith("\n") || raw === "" ? raw : `${raw}\n`}OPENAI_API_KEY=${key}\n`;
    await writeFile(path, next, "utf8");
  } catch {
    return NextResponse.json({ error: "write-failed" }, { status: 500 });
  }

  // 🛑 «СОХРАНЕНО» И «ПРИМЕНЕНО» — РАЗНЫЕ УТВЕРЖДЕНИЯ, И ЭТО СКАЗАНО ОТВЕТОМ.
  // Чат читает ключ из файла на каждом обращении и подхватит новый сразу; сам
  // проект читает окружение при старте, и до его перезапуска старый ключ ещё в
  // силе. Обещать обратное значило бы соврать о работе соседа.
  return NextResponse.json({
    applied: { chat: true, project: false },
    masked: maskOf(key),
    present: true,
  });
}
