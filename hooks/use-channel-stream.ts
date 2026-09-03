"use client";

import { useEffect } from "react";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { ChatMessage } from "@/lib/types";

// ВКЛАДКА УЗНАЁТ О ЧУЖОМ СООБЩЕНИИ, НЕ ПЕРЕЗАГРУЖАЯСЬ (100-1, 2026-09-03).
//
// 🔒 ЗАКАЗ ВЛАДЕЛЬЦА ДОСЛОВНО: «когда я пишу в Telegram, я ожидаю, что это
// практически сразу же появится в чате».
//
// 🛑 ПОЧЕМУ ЛЕНТА НЕ ОБНОВЛЯЛАСЬ САМА, ЕСЛИ ЭТО НЕ БЫЛО СЛОМАНО. Лента — это
// состояние React в браузере: оно наполняется один раз при открытии страницы и
// дальше меняется ТОЛЬКО от действий самого человека. Сообщение, положенное в
// базу другой службой, объявить о себе не может — некому. Значит нужен не
// «починить», а построить: канал, по которому сервер говорит вкладке.
//
// 🔒 ПРИХОДИТ НОМЕР РАЗГОВОРА, А НЕ САМО СООБЩЕНИЕ, И ЭТО НАМЕРЕННО. Вкладка
// перечитывает разговор из ЕДИНСТВЕННОГО хранилища — базы чата. Присылай мы
// текст в событии, он стал бы вторым источником: разошёлся бы с базой в первый
// же день, когда сообщение где-то поправят.

/**
 * Слушать события своего разговора и дописывать пришедшее в ленту.
 *
 * Ничего не делает, пока разговор не создан (`enabled: false`): у нового чата
 * ещё нет ни строки в базе, ни того, о чём уведомлять.
 */
export function useChannelStream({
  chatId,
  enabled,
  setMessages,
}: {
  chatId: string;
  enabled: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
}) {
  useEffect(() => {
    if (!(enabled && chatId)) {
      return;
    }

    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const source = new EventSource(
      `${base}/api/channels/events?chatId=${encodeURIComponent(chatId)}`
    );

    let stopped = false;

    const pull = async () => {
      try {
        const r = await fetch(`${base}/api/messages?chatId=${encodeURIComponent(chatId)}`, {
          cache: "no-store",
        });
        if (!r.ok) {
          return;
        }
        const d = (await r.json()) as { messages?: ChatMessage[] };
        if (stopped || !Array.isArray(d.messages)) {
          return;
        }
        // 🔒 ДОПИСЫВАЕМ ТОЛЬКО НОВОЕ, А НЕ ЗАМЕНЯЕМ ЛЕНТУ ЦЕЛИКОМ. Замена сбила
        // бы наполовину напечатанный ответ модели: он живёт в состоянии
        // браузера и в базу попадает только законченным.
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          const extra = d.messages?.filter((m) => !known.has(m.id)) ?? [];
          return extra.length > 0 ? [...prev, ...extra] : prev;
        });
      } catch {
        // Сеть моргнула — событие придёт снова, и вкладка догонит.
      }
    };

    source.onmessage = () => {
      pull();
    };

    // 🔒 ОШИБКУ НЕ ГЛУШИМ И НЕ ЛЕЧИМ РУКАМИ: `EventSource` сам переподключается
    // с нарастающей паузой. Своя логика переподключения дала бы вторую очередь
    // попыток поверх встроенной.

    return () => {
      stopped = true;
      source.close();
    };
  }, [chatId, enabled, setMessages]);
}
