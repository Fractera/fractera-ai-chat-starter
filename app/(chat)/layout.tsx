import { cookies, headers } from "next/headers";
import Script from "next/script";
import { Suspense } from "react";
import { Toaster } from "sonner";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { DataStreamProvider } from "@/components/chat/data-stream-provider";
import { ChatShell } from "@/components/chat/shell";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ActiveChatProvider } from "@/hooks/use-active-chat";
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
  const authUrl = process.env.AUTH_SERVICE_URL ?? process.env.NEXT_PUBLIC_AUTH_URL ?? "";
  const back = host ? encodeURIComponent(`${proto}://${host}/`) : "";
  const signOutHref = authUrl && back ? `${authUrl}/logout?redirectUrl=${back}` : "";
  const isCollapsed = cookieStore.get("sidebar_state")?.value !== "true";

  return (
    <SidebarProvider defaultOpen={!isCollapsed}>
      <AppSidebar signOutHref={signOutHref} user={session?.user} />
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
