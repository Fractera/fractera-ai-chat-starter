"use client";

import { ChevronUp } from "lucide-react";
import type { User } from "next-auth";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useUiLang } from "@/components/fractera/use-ui-lang";

// ИМЯ ЧЕЛОВЕКА И ЕГО МЕНЮ (наша правка поверх шаблона, шаг 96).
//
// ✗ ЧТО БЫЛО СЛОМАНО И ПОЧЕМУ — ЭТО НЕ ОПЕЧАТКА, А СЛЕДСТВИЕ ПОДМЕНЫ ВХОДА.
// Кнопка читала сессию через `useSession()` NextAuth, а личность в этом проекте
// теперь приходит от службы `:3001`. NextAuth-сессии нет вовсе — значит меню
// вечно показывало «Loading…», считало человека гостем и предлагало «Login», а
// «Sign out» гасил куку, которая ничего не решает. Снаружи это выглядело как
// сломанная кнопка; на самом деле она честно показывала пустоту.
//
// 🔒 ЛЕЧЕНИЕ — ЕДИНСТВЕННЫЙ ИСТОЧНИК: имя приходит сервером сверху (`user`), а
// выход ведёт в службу входа. Второго места, где чат «знает» человека, больше
// не существует.
//
// 🔒 КЛЮЧ OpenAI ЖИВЁТ ЗДЕСЬ ЖЕ (правка владельца): «добавь область ввести ключ
// OpenAI, которая при нажатии внутри того же самого контейнера увеличит его
// высоту и добавит новое поле». Открывается на месте, ничего не заслоняя.

function emailToHue(email: string): number {
  let hash = 0;
  for (const char of email) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

const WORDS = {
  en: {
    signOut: "Sign out",
    toLight: "Light theme",
    toDark: "Dark theme",
    keyTitle: "OpenAI key",
    keyPresent: "Key is set",
    keyAbsent: "No key yet",
    keyPlaceholder: "sk-…",
    save: "Save",
    saving: "Saving…",
    saved: "Key saved",
    badFormat: "That is not an OpenAI key — they start with sk-",
    failed: "Could not save the key",
  },
  ru: {
    signOut: "Выйти",
    toLight: "Светлая тема",
    toDark: "Тёмная тема",
    keyTitle: "Ключ OpenAI",
    keyPresent: "Ключ задан",
    keyAbsent: "Ключа пока нет",
    keyPlaceholder: "sk-…",
    save: "Сохранить",
    saving: "Сохраняю…",
    saved: "Ключ сохранён",
    badFormat: "Это не ключ OpenAI — они начинаются с sk-",
    failed: "Ключ сохранить не удалось",
  },
} as const;

type KeyState = { present: boolean; masked: string };

export function SidebarUserNav({
  user,
  signOutHref,
}: {
  user: User;
  signOutHref?: string;
}) {
  const lang = useUiLang();
  const w = WORDS[lang];
  const { setTheme, resolvedTheme } = useTheme();

  const [openKey, setOpenKey] = useState(false);
  const [keyState, setKeyState] = useState<KeyState | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  // Состояние ключа спрашивается у двери, а не хранится в браузере: правда о
  // ключе живёт на сервере, и вторая её копия здесь разошлась бы с первой.
  useEffect(() => {
    if (!openKey || keyState) {
      return;
    }
    fetch("/api/fractera/openai-key")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setKeyState(d ? { masked: d.masked ?? "", present: Boolean(d.present) } : null))
      .catch(() => setKeyState(null));
  }, [openKey, keyState]);

  const handleThemeSelect = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  const saveKey = useCallback(async () => {
    const key = value.trim();
    if (!key.startsWith("sk-")) {
      setNote(w.badFormat);
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/fractera/openai-key", {
        body: JSON.stringify({ key }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        throw new Error("failed");
      }
      const d = await res.json();
      setKeyState({ masked: d.masked ?? "", present: true });
      setValue("");
      setNote(w.saved);
    } catch {
      setNote(w.failed);
    } finally {
      setBusy(false);
    }
  }, [value, w]);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              className="h-8 px-2 rounded-lg bg-transparent text-sidebar-foreground/70 transition-colors duration-150 hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              data-testid="user-nav-button"
            >
              <div
                className="size-5 shrink-0 rounded-full ring-1 ring-sidebar-border/50"
                style={{
                  background: `linear-gradient(135deg, oklch(0.35 0.08 ${emailToHue(user.email ?? "")}), oklch(0.25 0.05 ${emailToHue(user.email ?? "") + 40}))`,
                }}
              />
              <span className="truncate text-[13px]" data-testid="user-email">
                {user?.email}
              </span>
              <ChevronUp className="ml-auto size-3.5 text-sidebar-foreground/50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-popper-anchor-width) rounded-lg border border-border/60 bg-card/95 backdrop-blur-xl shadow-[var(--shadow-float)]"
            data-testid="user-nav-menu"
            side="top"
          >
            <DropdownMenuItem
              className="cursor-pointer text-[13px]"
              data-testid="user-nav-item-theme"
              onSelect={handleThemeSelect}
            >
              {resolvedTheme === "light" ? w.toDark : w.toLight}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* 🔒 ОБЛАСТЬ КЛЮЧА РАСКРЫВАЕТСЯ ВНУТРИ ТОГО ЖЕ КОНТЕЙНЕРА — прямое
                слово владельца. `onSelect` с `preventDefault`, иначе меню
                закрылось бы на первом же нажатии и поле негде было бы заполнить. */}
            <DropdownMenuItem
              className="cursor-pointer justify-between text-[13px]"
              data-testid="user-nav-item-key"
              onSelect={(e) => {
                e.preventDefault();
                setOpenKey((v) => !v);
              }}
            >
              <span>{w.keyTitle}</span>
              <span
                className={
                  keyState?.present
                    ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-600 dark:text-emerald-400"
                    : "text-[11px] text-muted-foreground"
                }
                data-key-present={String(Boolean(keyState?.present))}
              >
                {keyState === null ? "" : keyState.present ? w.keyPresent : w.keyAbsent}
              </span>
            </DropdownMenuItem>

            {openKey ? (
              <div className="flex flex-col gap-2 px-2 pb-2">
                {keyState?.present ? (
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {keyState.masked}
                  </div>
                ) : null}
                <input
                  className="h-8 rounded-md border border-border bg-background px-2 text-[13px]"
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder={w.keyPlaceholder}
                  type="password"
                  value={value}
                />
                <button
                  className="h-8 rounded-md bg-foreground text-[13px] text-background disabled:opacity-50"
                  disabled={busy || value.trim().length === 0}
                  onClick={saveKey}
                  type="button"
                >
                  {busy ? w.saving : w.save}
                </button>
                {note ? (
                  <div className="text-[11px] text-muted-foreground">{note}</div>
                ) : null}
              </div>
            ) : null}

            <DropdownMenuSeparator />

            {/* 🔒 ВЫХОД ВЕДЁТ В СЛУЖБУ ВХОДА, А НЕ ГАСИТ МЕСТНУЮ КУКУ: сессия
                живёт на `.aifa.dev`, и погасить её может только тот, кто ставил. */}
            <DropdownMenuItem asChild data-testid="user-nav-item-auth">
              <a
                className="w-full cursor-pointer text-[13px]"
                href={signOutHref || "/"}
              >
                {w.signOut}
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
