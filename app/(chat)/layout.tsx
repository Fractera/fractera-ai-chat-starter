import { cookies, headers } from "next/headers";
import Script from "next/script";
import { Suspense } from "react";
import { Toaster } from "sonner";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { DataStreamProvider } from "@/components/chat/data-stream-provider";
import { ChatShell } from "@/components/chat/shell";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ActiveChatProvider } from "@/hooks/use-active-chat";
import { publicAdminUrl, publicAuthUrl, publicSiteUrl } from "@/lib/fractera/auth-url";
import { auth } from "../(auth)/auth";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js"
        strategy="lazyOnload"
      />
      <DataStreamProvider>
        <Suspense fallback={<div className="flex h-dvh bg-sidebar" />}>
          <SidebarShell>{children}</SidebarShell>
        </Suspense>
      </DataStreamProvider>
    </>
  );
}

async function SidebarShell({ children }: { children: React.ReactNode }) {
  const [session, cookieStore, h] = await Promise.all([auth(), cookies(), headers()]);

  // 🔒 АДРЕСА ВХОДА И ВЫХОДА СОБИРАЮТСЯ ЗДЕСЬ, ПО СТАНДАРТУ ПАНЕЛИ (:3002).
  // Дословно оттуда: слой авторизации живёт на другом источнике и НЕ МОЖЕТ
  // вывести наш адрес сам, поэтому обратный адрес прикладывается явно и
  // считается ИЗ ЗАГОЛОВКОВ ЗАПРОСА, а не из конфига: сервер отвечает на том
  // адресе, на котором его спросили.
  //
  // ✗ ОПЛАЧЕНО СЕГОДНЯ: адрес собирался в островке из `NEXT_PUBLIC_AUTH_URL`,
  // а эта переменная запекается на сборке — при пустом значении получалось
  // `https://localhost:3001/…`, то есть ссылка в никуда с чужой машины.
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";

  // 🛑 ССЫЛКА ДЛЯ БРАУЗЕРА БЕРЁТ ПУБЛИЧНЫЙ АДРЕС СЛУЖБЫ, А НЕ ВНУТРЕННИЙ.
  // ✗ оплачено дважды за час: `AUTH_SERVICE_URL` у нас `http://localhost:3001`
  // — он верен для запроса сервер-серверу и бессмыслен в адресной строке
  // человека.
  //
  // 🔒 ВЫВОД ЖИВЁТ В ОДНОМ МЕСТЕ (`lib/fractera/auth-url.ts`). ✗ здесь и на
  // странице приветствия он считался ПО ОТДЕЛЬНОСТИ, и владелец нашёл разницу
  // живьём: вход вёл на голый IP по http. Две сборки одного адреса расходятся
  // так, что одна половина работает, — заметить это можно, только нажав обе
  // кнопки.
  const authUrl = publicAuthUrl(host, proto);

  // 🔒 ВОЗВРАТ ПОСЛЕ ВЫХОДА — СЮДА ЖЕ, ПО СТАНДАРТУ ПАНЕЛИ. Вышедшего встречает
  // страница-заглушка `/welcome`: она существует без авторизации, и поэтому
  // менять стандарт ссылки не понадобилось.
  const back = host ? encodeURIComponent(`${proto}://${host}/`) : "";
  const signOutHref = authUrl && back ? `${authUrl}/logout?redirectUrl=${back}` : "";

  // Соседние службы для ящика (BACKLOG 96-9). Считает сервер — ящик клиентский,
  // и заголовки запроса ему недоступны.
  const siteHref = publicSiteUrl(host, proto);
  const adminHref = publicAdminUrl(host, proto);

  const isCollapsed = cookieStore.get("sidebar_state")?.value !== "true";

  return (
    <SidebarProvider defaultOpen={!isCollapsed}>
      <AppSidebar adminHref={adminHref} signOutHref={signOutHref} siteHref={siteHref} user={session?.user} />
      <SidebarInset>
        <Toaster
          position="top-center"
          theme="system"
          toastOptions={{
            className:
              "!bg-card !text-foreground !border-border/50 !shadow-[var(--shadow-float)]",
          }}
        />
        <Suspense fallback={<div className="flex h-dvh" />}>
          <ActiveChatProvider>
            <ChatShell />
          </ActiveChatProvider>
        </Suspense>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
