// @api automation strategy mode: read here, write through the architect door
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  currentAutomationMode,
  isAutomationMode,
} from "@/lib/fractera/automation-mode";
import { publicSiteUrl } from "@/lib/fractera/auth-url";
import { fracteraRoles } from "@/lib/fractera/session";

// ДВЕРЬ РЕЖИМА АВТОМАТИЗАЦИИ (112-1, 2026-09-04).
//
// 🔒 ЧИТАЕТ САМА, ПИШЕТ ЧУЖИМИ РУКАМИ, И АСИММЕТРИЯ НАМЕРЕННА. Чтение файла
// ничего не портит и экономит поход к соседу; запись в файл, у которого уже есть
// атомарный писатель на стороне слота, завела бы ТРЕТЬЕГО писателя одного файла
// (панель · слой архитектора · мы). Разошлись бы они молча и в худший момент —
// когда два человека сохраняют настройки одновременно.
//
// 🔒 ЗАМОК — АРХИТЕКТОР, КАК У СОСЕДНЕЙ ДВЕРИ КЛЮЧА. Это настройка проекта, а не
// предпочтение зрителя: её видят все, кто откроет чат.
//
// 🔒 КУКА ПЕРЕСЫЛАЕТСЯ, А НЕ ЗАВОДИТСЯ ОБЩИЙ СЕКРЕТ. Служба входа ставит куку на
// весь домен второго уровня, поэтому дверь слота узнаёт того же человека, который
// сейчас в чате, — тот же конвейер, которым чат спрашивает `:3001` о сессии.
// Общий секрет между службами был бы вторым путём доверия, о котором знают двое.

type Body = { mode?: unknown };

/** Адрес слота, куда звонить за записью. Пусто — соседа отсюда не видно. */
async function slotUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return publicSiteUrl(host, proto);
}

export async function GET() {
  const roles = await fracteraRoles();
  if (!roles.includes("architect")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({ mode: currentAutomationMode() });
}

export async function POST(request: Request) {
  const roles = await fracteraRoles();
  if (!roles.includes("architect")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const mode = body?.mode;

  // 🔒 ЗНАЧЕНИЕ ПРОВЕРЯЕТСЯ ЗДЕСЬ, И ИЗМЕРЕНИЕ ПОКАЗАЛО, ЧТО ЭТО НЕ ПЕРЕСТРАХОВКА.
  // Дверь `PLATFORM-CONFIG` на той стороне зовёт схему ради предупреждения в лог и
  // пишет на диск сырой объект: живой замер 2026-09-04 дал `200 {"ok":true}` на
  // `{"automationMode":"nope"}`, и «nope» лёг в файл. Без этой строки мусор доехал
  // бы до диска и отсюда. Читатель его игнорирует — но дырой в двери это быть не
  // перестаёт.
  if (!isAutomationMode(mode)) {
    return NextResponse.json({ error: "bad-mode" }, { status: 400 });
  }

  const url = await slotUrl();
  if (!url) {
    return NextResponse.json({ error: "no-slot-url" }, { status: 503 });
  }

  const jar = await cookies();
  const cookie = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  try {
    // 🔒 ЗАПЛАТА, А НЕ СНИМОК: в этом файле живут режим разработки, выключатели
    // возможностей и состояние переезда. Снимок целиком затирал бы их при каждом
    // переключении режима — и затирал бы чужую правку из другого процесса.
    const r = await fetch(`${url}/api/architect/platform-config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ patch: { automationMode: mode } }),
      cache: "no-store",
    });
    if (!r.ok) {
      return NextResponse.json({ error: "door-failed", status: r.status }, { status: 502 });
    }
    const d = (await r.json().catch(() => ({}))) as { ok?: boolean };
    if (!d.ok) {
      return NextResponse.json({ error: "door-refused" }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ error: "door-unreachable" }, { status: 502 });
  }

  // 🛑 «СОХРАНЕНО» ЗДЕСЬ НЕ ЗНАЧИТ «ПОВЕДЕНИЕ ИЗМЕНИЛОСЬ», И ЭТО ЧЕСТНО НАЗВАНО:
  // сегодня за режимом нет поведения ни в одном положении. Ответ говорит только
  // то, что произошло на самом деле, — значение записано.
  return NextResponse.json({ ok: true, mode, applies: false });
}
