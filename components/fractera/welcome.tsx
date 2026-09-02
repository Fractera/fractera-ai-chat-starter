"use client";

import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { useUiLang } from "@/components/fractera/use-ui-lang";

// ОКНО «АВТОРИЗУЙТЕСЬ» — ОДНОТОННЫЙ ЭКРАН, КАРТОЧКА ПО ЦЕНТРУ (правка владельца).
//
// 🔒 ЭТО НЕ МОДАЛЬНОЕ ОКНО ПРОЕКТА, И ЭТО НАМЕРЕННО. Модальное окно
// открывается ПОВЕРХ чего-то и закрывается; здесь закрывать нечего — за ним нет
// страницы, на которую человек имеет право. Карточка на пустом фоне говорит то
// же самое и не обещает возврата.
//
// 🔒 ДВА ЯЗЫКА ЧЕРЕЗ ОБЩИЙ ХУК: источник языка в чате один, и эта страница не
// заводит второго.

const WORDS = {
  en: {
    title: "Sign in to start",
    lead: "This chat with the AI agent is available after you sign in.",
    action: "Sign in",
    unavailable: "The sign-in service address is not configured yet.",
  },
  ru: {
    title: "Авторизуйтесь, чтобы начать",
    lead: "Чат с ИИ-агентом доступен после входа в проект.",
    action: "Войти",
    unavailable: "Адрес службы входа пока не настроен.",
  },
} as const;

export function WelcomeCard({ children }: { children: ReactNode }) {
  const w = WORDS[useUiLang()];

  return (
    <main
      className="flex min-h-dvh items-center justify-center bg-background p-6"
      data-welcome
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-[var(--shadow-float)]">
        <h1 className="font-semibold text-foreground text-xl">{w.title}</h1>
        <p className="mt-2 text-muted-foreground text-sm">{w.lead}</p>
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export function WelcomeSignIn({ href }: { href: string }) {
  const w = WORDS[useUiLang()];

  // 🛑 ПУСТОЙ АДРЕС — ЗАКОННОЕ СОСТОЯНИЕ, И ОНО НАЗЫВАЕТСЯ СЛОВАМИ. Кнопка,
  // ведущая в никуда, хуже её отсутствия: человек нажимает и решает, что
  // сломан вход, а не что адрес не настроен.
  if (!href) {
    return <p className="text-muted-foreground text-sm">{w.unavailable}</p>;
  }

  return (
    <a className={`${buttonVariants()} w-full`} href={href}>
      {w.action}
    </a>
  );
}
