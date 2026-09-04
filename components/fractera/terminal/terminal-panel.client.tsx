"use client";

import { ArrowLeftIcon, KeyRoundIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthFlowModal } from "@/components/fractera/terminal/auth-flow-modal.client";
import {
  type XtermHandle,
  XtermTerminal,
} from "@/components/fractera/terminal/xterm-terminal.client";
import { Button } from "@/components/ui/button";
import { extractAuthUrl } from "@/lib/fractera/terminal-auth.mjs";

// ПАНЕЛЬ ТЕРМИНАЛА — ВЫЖИМКА ИЗ `coding-window-shell.client.tsx` (шаг 114-4).
//
// Оригинал на `e1e7ff0^` — 1525 строк, и терминала в нём меньше десятой части:
// остальное панели развёртывания, медиатеки, домена и пользователей. Сюда
// перенесены ровно четыре его способности: сокет, чтение буфера на предмет
// ссылки входа, модалка и возврат кода в stdin.
//
// 🔒 СЫРЬЁ КОПИТСЯ БЕЗ ЧИСТКИ, И ЭТО НЕ НЕБРЕЖНОСТЬ. Основная дверь распознавания
// (`extractAuthUrl`) ищет гиперссылку OSC-8, а она И ЕСТЬ управляющая
// последовательность: почистив буфер заранее, мы отрезали бы себе лучший из двух
// путей и остались бы с угадыванием конца ссылки по тексту.

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Сколько сырья держим. Ссылка входа длиной ~450 символов, запас десятикратный. */
const BUFFER_LIMIT = 8000;

/** Пауза перед разбором: вывод PTY приезжает кусками, ссылка бывает разорвана. */
const DETECT_DELAY_MS = 300;

// ✗ ВОЗВРАТ РЕЖИМОВ ПОСЛЕ ОБОРВАННОГО TUI — ОПЛАЧЕНО ЖИВЬЁМ (114-7).
//
// ИЗМЕРЕНО НА СЕРВЕРЕ, А НЕ ВЫВЕДЕНО: полный интерфейс `claude` включает
// слежение за мышью (`?1000h ?1002h ?1003h ?1006h`), дополнительный экран
// (`?1049h`) и скобочную вставку (`?2004h`) — и НЕ выключает их, когда его
// обрывают. `claude auth login` не включает ничего: проверено 35 секундами
// ожидания кода, ноль последовательностей.
//
// 🛑 МЕХАНИЗМ ПОЛОМКИ. PTY у новой сессии свой, а терминал в браузере ТОТ ЖЕ,
// и его состояние переезжает. Поработав в режиме «Claude Code» и уйдя в другой,
// человек получал терминал со ВКЛЮЧЁННОЙ мышью: каждое движение по тачпаду
// уезжает в stdin управляющей последовательностью, оболочка печатает её как
// набранный текст — «случайные символы». Та же последовательность, попавшая в
// приглашение «Paste code here», портит код, и вход отвечает ошибкой, хотя
// человек всё сделал верно.
//
// 🔒 ЛЕЧЕНИЕ ДВУСЛОЙНОЕ, И СЛОИ РАЗНЫЕ ПО СМЫСЛУ: при закрытии сокета режимы
// возвращаются, а лента ОСТАЁТСЯ — человеку надо прочитать, чем кончилось;
// при открытии новой сессии терминал сбрасывается целиком.
// 🛑 БАЙТ ESC СОБИРАЕТСЯ КОДОМ, А НЕ ПИШЕТСЯ В ФАЙЛ. Управляющий символ в
// исходнике невидим при чтении и молча теряется при любой перекодировке — а
// потерянный, он превращает лечение в печать мусора на экран.
const ESC = String.fromCharCode(27);
const RESTORE_MODES = [
  "?1000l",
  "?1002l",
  "?1003l",
  "?1006l",
  "?1049l",
  "?2004l",
  "?25h",
]
  .map((mode) => `${ESC}[${mode}`)
  .join("");

type Mode = "claude-check" | "claude-login" | "system";

type Status = "closed" | "connected" | "connecting" | "idle";

export function TerminalPanel() {
  const [status, setStatus] = useState<Status>("idle");
  const [note, setNote] = useState("");
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  const termRef = useRef<XtermHandle>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const bufRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalOpenRef = useRef(false);
  const sizeRef = useRef({ cols: 80, rows: 24 });

  const send = useCallback((payload: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const scan = useCallback(() => {
    if (modalOpenRef.current) {
      return;
    }
    const found = extractAuthUrl(bufRef.current);
    if (found) {
      modalOpenRef.current = true;
      setAuthUrl(found.url);
    }
  }, []);

  const connect = useCallback(
    async (next: Mode) => {
      wsRef.current?.close();
      bufRef.current = "";
      setStatus("connecting");
      setNote("");
      // 🔒 НОВАЯ СЕССИЯ — ЧИСТЫЙ ТЕРМИНАЛ. PTY у неё свой, а терминал в
      // браузере тот же, и без сброса в неё переезжают режимы предыдущей.
      termRef.current?.reset();

      // 🔒 БИЛЕТ БЕРЁТСЯ ПЕРЕД КАЖДЫМ ОТКРЫТИЕМ. Он одноразовый и живёт минуту:
      // переключение режима — это новое соединение, значит и новый билет.
      let ticket = "";
      try {
        const res = await fetch(`${BASE}/api/fractera/pty-ticket`, {
          method: "POST",
        });
        if (!res.ok) {
          setStatus("closed");
          setNote(
            res.status === 403
              ? "Терминал доступен только архитектору проекта."
              : `Дверь билета ответила ${res.status}.`
          );
          return;
        }
        ticket = ((await res.json()) as { ticket?: string }).ticket ?? "";
      } catch {
        setStatus("closed");
        setNote("Дверь билета недоступна.");
        return;
      }

      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(
        `${scheme}://${window.location.host}${BASE}/pty`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        ws.send(JSON.stringify({ mode: next, ticket, type: "init" }));
        ws.send(JSON.stringify({ type: "resize", ...sizeRef.current }));
        termRef.current?.focus();
      };

      ws.onmessage = (event) => {
        const chunk =
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data);
        termRef.current?.write(chunk);
        bufRef.current = (bufRef.current + chunk).slice(-BUFFER_LIMIT);
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(scan, DETECT_DELAY_MS);
      };

      ws.onclose = (event) => {
        setStatus("closed");
        // 🔒 РЕЖИМЫ ВОЗВРАЩАЮТСЯ, ЛЕНТА ОСТАЁТСЯ. Оборванный TUI не успевает
        // выключить слежение за мышью и дополнительный экран за собой — без
        // этой строки терминал остаётся отравленным: движение по тачпаду
        // печатает мусор. Полный сброс здесь был бы хуже: он стёр бы вывод,
        // по которому человек читает, ЧЕМ кончилось.
        termRef.current?.write(RESTORE_MODES);
        // 🛑 ПРИЧИНА ЗАКРЫТИЯ ПОКАЗЫВАЕТСЯ ЧЕЛОВЕКУ. Молчаливо погасший терминал
        // неотличим от сломанного, и чинить пойдут не то.
        if (event.reason) {
          setNote(`Соединение закрыто: ${event.reason}`);
        }
      };

      ws.onerror = () => {
        setNote("Обрыв соединения с терминалом.");
      };
    },
    [scan]
  );

  // 🔒 ОТКРЫТИЕ ВКЛАДКИ ВХОДИТ ТОЛЬКО ЕСЛИ НАДО. `claude auth login` не умеет
  // спрашивать, вошли ли уже (измерено 114-8: начинает обмен безусловно), и
  // вкладка, просящая вход у давно вошедшего, читается как «вход не сохранился».
  useEffect(() => {
    connect("claude-check");
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  const handleData = useCallback(
    (data: string) => {
      send({ data, type: "stdin" });
    },
    [send]
  );

  const handleResize = useCallback(
    (size: { cols: number; rows: number }) => {
      sizeRef.current = size;
      send({ type: "resize", ...size });
    },
    [send]
  );

  // 🔒 КНОПКА ВХОДИТ ВСЕГДА, В ОТЛИЧИЕ ОТ ОТКРЫТИЯ ВКЛАДКИ. Вошедшему она нужна
  // ровно затем, зачем нажимают такую кнопку: сменить учётную запись или
  // переделать вход, который он считает испорченным.
  const handleLogin = useCallback(() => {
    connect("claude-login");
  }, [connect]);

  // 🔒 РУЧНОЙ СБРОС — НЕ ЛИШНЯЯ КНОПКА, А ПРИЗНАНИЕ ГРАНИЦЫ. Два слоя выше
  // лечат случаи, которые мы УМЕЕМ заметить: смену режима и обрыв сокета.
  // Программа внутри живого PTY способна испортить состояние терминала и не
  // умереть при этом, и заметить такое из браузера нечем. Тогда человеку нужна
  // не догадка агента, а кнопка.
  const handleReset = useCallback(() => {
    termRef.current?.reset();
    termRef.current?.focus();
  }, []);

  const handleCloseModal = useCallback(() => {
    modalOpenRef.current = false;
    setAuthUrl(null);
    // Буфер чистится вместе с окном: та же ссылка иначе откроет его снова.
    bufRef.current = "";
    termRef.current?.focus();
  }, []);

  const handleSendCode = useCallback(
    (code: string) => {
      send({ data: `${code}\n`, type: "stdin" });
    },
    [send]
  );

  return (
    <div className="flex h-dvh w-full flex-col bg-[#0b0b0c]">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-white/10 border-b px-3 py-2">
        <Button asChild size="sm" variant="ghost">
          <Link href="/">
            <ArrowLeftIcon size={14} />В чат
          </Link>
        </Button>

        {/* 🔒 ОДНА КНОПКА — РЕШЕНИЕ ВЛАДЕЛЬЦА (114-8). «Оболочка» и «Claude Code»
            убраны: вкладка существует ради одного — подключить подписку. Оболочка
            под ней та же самая, и набрать в ней `claude` по-прежнему можно. */}
        <Button
          onClick={handleLogin}
          size="sm"
          title="Запустить вход заново: claude auth login"
          variant="ghost"
        >
          <KeyRoundIcon size={14} />
          Вход по подписке Claude Code
        </Button>

        <Button
          className="ml-auto"
          onClick={handleReset}
          size="sm"
          title="Вернуть терминал в исходное состояние: мышь, экран, курсор"
          variant="ghost"
        >
          <RotateCcwIcon size={14} />
          Сбросить
        </Button>

        <span className="font-mono text-[11px] text-white/50">
          {status === "connected" && "терминал подключён"}
          {status === "connecting" && "подключение…"}
          {status === "closed" && "соединение закрыто"}
          {status === "idle" && "ожидание"}
        </span>
      </header>

      {note ? (
        <p className="shrink-0 border-white/10 border-b bg-amber-500/10 px-3 py-1.5 text-[12px] text-amber-200">
          {note}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 p-2">
        <XtermTerminal
          onData={handleData}
          onResize={handleResize}
          ref={termRef}
        />
      </div>

      {authUrl ? (
        <AuthFlowModal
          onClose={handleCloseModal}
          onSendCode={handleSendCode}
          url={authUrl}
        />
      ) : null}
    </div>
  );
}
