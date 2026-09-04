import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { fracteraRoles } from "@/lib/fractera/session";
import { slotEnv } from "@/lib/fractera/slot-env";

// КЛЮЧ OpenAI — ОДИН НА ВЕСЬ СЕРВЕР, И ЧАТ ЕГО НЕ КОПИРУЕТ (шаг 96).
//
// 🔒 ЗАКОН ПРОЕКТА: ключ один, потребителей несколько — проект, слой данных,
// граф знаний, теперь чат. Каждый, кто заводит СВОЙ файл с ключом, добавляет
// путь, о котором остальные не знают: плашка «ключ задан» станет врать, а отказ
// второго потребителя будет молчаливым.
//
// 🪦 «ПОЭТОМУ ЧИТАЕМ И ПИШЕМ ФАЙЛ ГОСТЕВОГО ПРИЛОЖЕНИЯ» — ОТМЕНЕНО 109-3.
// Половина осталась верной: ЧИТАЕМ по-прежнему файл слота, чтобы показать маску
// без похода в соседнюю службу. ПИСАТЬ перестали: запись ушла в дверь
// `POST /platform/openai-key`, потому что запись сюда доставляла ключ ТОЛЬКО
// слоту приложения — граф знаний и слой данных о ней не знали.
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

/** Адрес и секрет слоя данных — те же, что у медиатеки: одна связь, одно место. */
function dataService(): { key: string; url: string } {
  return {
    key: process.env.DATA_SECRET || slotEnv("DATA_SECRET") || slotEnv("DATA_API_KEY"),
    url: process.env.REMOTE_DATA_URL || slotEnv("REMOTE_DATA_URL") || "http://localhost:3300",
  };
}

/**
 * Доставить ключ ВСЕМ потребителям через единственную дверь платформы.
 *
 * 🔒 СПИСКА ПОТРЕБИТЕЛЕЙ ЗДЕСЬ НЕТ НАМЕРЕННО. Он живёт в службе данных; копия,
 * заведённая тут «для надёжности», — это ровно тот третий список, расхождением
 * которых и был оплачен шаг 109.
 */
async function writeKeyThroughDoor(key: string): Promise<{ ok: boolean; reason?: string }> {
  const { url, key: secret } = dataService();
  if (!secret) return { ok: false, reason: "no-data-secret" };
  try {
    const r = await fetch(`${url}/platform/openai-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Data-Secret": secret },
      body: JSON.stringify({ key }),
      cache: "no-store",
    });
    if (!r.ok) return { ok: false, reason: `door-${r.status}` };
    const d = (await r.json()) as { ok?: boolean; failed?: string[] };
    return d.ok ? { ok: true } : { ok: false, reason: `failed:${(d.failed ?? []).join(",")}` };
  } catch {
    return { ok: false, reason: "door-unreachable" };
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

  // 🪦 ЗДЕСЬ ЧАТ ПИСАЛ ФАЙЛ СЛОТА САМ. ОТМЕНЕНО ШАГОМ 109-3 (2026-09-04), и
  // причина не в чистоте кода: он писал ТОЛЬКО слот — ни слою данных, ни графу
  // знаний ключ отсюда не доезжал. Ожидание владельца «ключ вводится в любом
  // месте и активирует всё» выполнялось на треть, и молча.
  //
  // 🔒 ТЕПЕРЬ ПИШЕТ ОДНА ДВЕРЬ `POST /platform/openai-key` службы данных: кто
  // потребляет ключ и какими именами его читает — знает она одна. Прежняя правда
  // о построчной правке не исчезла, она переехала туда вместе с писателем.
  const written = await writeKeyThroughDoor(key);
  if (!written.ok) {
    return NextResponse.json({ error: "write-failed", reason: written.reason }, { status: 500 });
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
