"use client";

import {
  GlobeIcon,
  MessageSquareIcon,
  PanelLeftIcon,
  PenSquareIcon,
  SlidersHorizontalIcon,
  TerminalIcon,
  TrashIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "next-auth";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import {
  getChatHistoryPaginationKey,
  SidebarHistory,
} from "@/components/chat/sidebar-history";
import { SidebarUserNav } from "@/components/chat/sidebar-user-nav";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export function AppSidebar({
  adminHref,
  siteHref,
  showTerminal,
  user,
  signOutHref,
}: {
  user: User | undefined;
  /** Адрес выхода, собранный на сервере по стандарту панели. */
  signOutHref?: string;
  /** Адрес сайта проекта. Пусто — соседа нет, и кнопки не будет (BACKLOG 96-9). */
  siteHref?: string;
  /** Адрес панели управления. Пусто — соседа нет, и кнопки не будет. */
  adminHref?: string;
  /**
   * Показывать ли вход в терминал (шаг 114-4).
   *
   * 🔒 РЕШАЕТ СЕРВЕР, А НЕ ЯЩИК: роль спрашивается у службы входа `:3001`, и
   * клиенту она не видна. Тот же закон, что у кнопок соседних служб, — «нет
   * права, нет кнопки», — только здесь вместо адреса признак.
   *
   * 🛑 ЭТО НЕ ЗАМОК, А ВЕЖЛИВОСТЬ. Замки стоят на самой странице и на двери
   * билета; спрятанная кнопка никого не останавливает и останавливать не
   * должна — иначе следующий агент решит, что права проверяются здесь.
   */
  showTerminal?: boolean;
}) {
  const router = useRouter();
  const { setOpenMobile, toggleSidebar } = useSidebar();
  const { mutate } = useSWRConfig();
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);

  const closeMobile = useCallback(() => {
    setOpenMobile(false);
  }, [setOpenMobile]);

  const handleToggleSidebar = useCallback(() => {
    toggleSidebar();
  }, [toggleSidebar]);

  const handleNewChat = useCallback(() => {
    setOpenMobile(false);
    router.push("/");
  }, [router, setOpenMobile]);

  const handleShowDeleteAllDialog = useCallback(() => {
    setShowDeleteAllDialog(true);
  }, []);

  const handleDeleteAll = useCallback(() => {
    setShowDeleteAllDialog(false);
    router.replace("/");
    mutate(unstable_serialize(getChatHistoryPaginationKey), [], {
      revalidate: false,
    });

    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history`, {
      method: "DELETE",
    });

    toast.success("All chats deleted");
  }, [mutate, router]);

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="pb-0 pt-3">
          <SidebarMenu>
            <SidebarMenuItem className="flex flex-row items-center justify-between">
              <div className="group/logo relative flex items-center justify-center">
                <SidebarMenuButton
                  asChild
                  className="size-8 !px-0 items-center justify-center group-data-[collapsible=icon]:group-hover/logo:opacity-0"
                  tooltip="Chatbot"
                >
                  <Link href="/" onClick={closeMobile}>
                    <MessageSquareIcon className="size-4 text-sidebar-foreground/50" />
                  </Link>
                </SidebarMenuButton>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarMenuButton
                      className="pointer-events-none absolute inset-0 size-8 opacity-0 group-data-[collapsible=icon]:pointer-events-auto group-data-[collapsible=icon]:group-hover/logo:opacity-100"
                      onClick={handleToggleSidebar}
                    >
                      <PanelLeftIcon className="size-4" />
                    </SidebarMenuButton>
                  </TooltipTrigger>
                  <TooltipContent className="hidden md:block" side="right">
                    Open sidebar
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="group-data-[collapsible=icon]:hidden">
                <SidebarTrigger className="text-sidebar-foreground/60 transition-colors duration-150 hover:text-sidebar-foreground" />
              </div>
            </SidebarMenuItem>

            {/* СОСЕДНИЕ СЛУЖБЫ (BACKLOG 96-9, 2026-09-04, просьба владельца).
                Чат — одна из служб проекта, а не отдельное приложение: из него
                надо уметь выйти на сайт и в панель, как из панели — сюда.

                🔒 АДРЕС СЧИТАЕТ СЕРВЕР И ПЕРЕДАЁТ ПРОПСОМ: ящик клиентский, и
                заголовки запроса, из которых выводится хост, ему недоступны.

                🛑 НЕТ АДРЕСА — НЕТ КНОПКИ. Пустая строка это законный ответ на
                машине без соседей; ссылка в никуда хуже её отсутствия. */}
            {siteHref ? (
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Сайт проекта">
                  <a href={siteHref} rel="noopener noreferrer" target="_blank">
                    <GlobeIcon className="size-4 text-sidebar-foreground/50" />
                    <span>Сайт проекта</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}
            {adminHref ? (
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Панель управления">
                  <a href={adminHref} rel="noopener noreferrer" target="_blank">
                    <SlidersHorizontalIcon className="size-4 text-sidebar-foreground/50" />
                    <span>Панель управления</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className="pt-1">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    className="h-8 rounded-lg border border-sidebar-border text-[13px] text-sidebar-foreground/70 transition-colors duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    onClick={handleNewChat}
                    tooltip="New Chat"
                  >
                    <PenSquareIcon className="size-4" />
                    <span className="font-medium">New chat</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {showTerminal ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      className="rounded-lg text-sidebar-foreground/70 transition-colors duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                      tooltip="Терминал"
                    >
                      <Link href="/terminal" onClick={closeMobile}>
                        <TerminalIcon className="size-4" />
                        <span className="text-[13px]">Терминал</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : null}
                {user ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      className="rounded-lg text-sidebar-foreground/40 transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive"
                      onClick={handleShowDeleteAllDialog}
                      tooltip="Delete All Chats"
                    >
                      <TrashIcon className="size-4" />
                      <span className="text-[13px]">Delete all</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : null}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarHistory user={user} />
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border pt-2 pb-3">
          {user ? (
            <SidebarUserNav signOutHref={signOutHref} user={user} />
          ) : null}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <AlertDialog
        onOpenChange={setShowDeleteAllDialog}
        open={showDeleteAllDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all chats?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete all
              your chats and remove them from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAll}>
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
