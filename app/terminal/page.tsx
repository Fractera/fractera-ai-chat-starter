import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TerminalPanel } from "@/components/fractera/terminal/terminal-panel.client";
import { fracteraSession } from "@/lib/fractera/session";

// СТРАНИЦА ТЕРМИНАЛА (шаг 114-4).
//
// 🔒 ОНА ЛЕЖИТ ВНЕ ГРУППЫ `(chat)`, И ЭТО НЕ ВКУСОВОЕ РЕШЕНИЕ. Раскладка группы
// монтирует `<ChatShell />` РЯДОМ с `children`, а сама страница разговора —
// `null`: лента рисуется раскладкой всегда. Положив терминал внутрь группы, мы
// получили бы ленту и терминал одновременно на одном экране.
//
// 🔒 ЗАМОК СТОИТ ДВАЖДЫ, И ЭТО НЕ ИЗБЫТОЧНОСТЬ. Здесь — чтобы человек без прав
// не увидел даже пустой экран терминала; в двери билета — потому что страница
// прав не выдаёт, их выдаёт билет. Убрав любую из двух проверок, получаем либо
// страницу, дразнящую неуполномоченного, либо открытый мост.
//
// ✗ ЗАМОК ЖИВЁТ ПОД `<Suspense>`, И ЭТО ОПЛАЧЕНО КОНСОЛЬЮ БРАУЗЕРА, А НЕ
// ВЫВЕДЕНО. Первая версия спрашивала сессию прямо в теле страницы, и Next при
// включённом `cacheComponents` ответил ошибкой в консоли: «Uncached data or
// `connection()` was accessed outside of `<Suspense>` … delays the ENTIRE page
// from rendering». Страница при этом рисовалась и работала — то есть дефект был
// невидим и снаружи, и в типах, и в линтере. Ровно тот же приём стоит в
// раскладке чата, где `SidebarShell` обёрнут по той же причине.
//
// 🛑 НАСТРОЕК СЕГМЕНТА ЗДЕСЬ НЕТ: у шаблона включён `cacheComponents`, и он
// несовместим с `runtime`/`dynamic`.

export default function TerminalPage() {
  return (
    <Suspense fallback={<div className="h-dvh w-full bg-[#0b0b0c]" />}>
      <TerminalGate />
    </Suspense>
  );
}

async function TerminalGate() {
  const session = await fracteraSession();
  if (!session) {
    redirect("/welcome");
  }
  if (!session.roles.includes("architect")) {
    redirect("/");
  }
  return <TerminalPanel />;
}
