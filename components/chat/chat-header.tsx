"use client";

import { PanelLeftIcon } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { VisibilitySelector, type VisibilityType } from "./visibility-selector";

function PureChatHeader({
  chatId,
  selectedVisibilityType,
  isReadonly,
}: {
  chatId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
}) {
  const { state, toggleSidebar, isMobile } = useSidebar();

  if (state === "collapsed" && !isMobile) {
    return null;
  }

  return (
    <header className="sticky top-0 flex h-14 items-center gap-2 bg-sidebar px-3">
      <Button
        className="md:hidden"
        onClick={toggleSidebar}
        size="icon-sm"
        variant="ghost"
      >
        <PanelLeftIcon className="size-4" />
      </Button>


      {!isReadonly && (
        <VisibilitySelector
          chatId={chatId}
          selectedVisibilityType={selectedVisibilityType}
        />
      )}

      {/* 🔒 ИМЯ ВМЕСТО ЧУЖОЙ КНОПКИ (правка владельца 2026-09-02). Здесь стояла
          «Deploy with Vercel» — реклама шаблона на рабочем экране проекта.
          Имя компании берётся настройкой: у каждого развёртывания оно своё, и
          строка «Fractera» в коде была бы чужим именем на чужом сайте. */}
      <span
        className="ml-auto hidden select-none px-2 font-medium text-muted-foreground text-sm md:block"
        data-chat-brand
      >
        {process.env.NEXT_PUBLIC_COMPANY_NAME || "Fractera"} Agent Chat
      </span>
    </header>
  );
}

export const ChatHeader = memo(
  PureChatHeader,
  (prevProps, nextProps) =>
    prevProps.chatId === nextProps.chatId &&
    prevProps.selectedVisibilityType === nextProps.selectedVisibilityType &&
    prevProps.isReadonly === nextProps.isReadonly
);
