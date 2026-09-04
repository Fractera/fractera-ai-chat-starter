"use client";

import {
  ArrowLeftIcon,
  KeyRoundIcon,
  SparklesIcon,
  TerminalIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthFlowModal } from "@/components/fractera/terminal/auth-flow-modal.client";
import {
  type XtermHandle,
  XtermTerminal,
} from "@/components/fractera/terminal/xterm-terminal.client";
import { Button } from "@/components/ui/button";
import { extractAuthUrl } from "@/lib/fractera/terminal-auth.mjs";
import { cn } from "@/lib/utils";

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

type Mode = "claude-code" | "claude-login" | "system";

type Status = "closed" | "connected" | "connecting" | "idle";

const MODES: {
  hint: string;
  icon: typeof TerminalIcon;
  id: Mode;
  label: string;
}[] = [
  {
    hint: "Голая оболочка в рабочей папке агента",
    icon: TerminalIcon,
    id: "system",
    label: "Оболочка",
  },
  {
    hint: "Запустить claude auth login и войти своей подпиской",
    icon: KeyRoundIcon,
    id: "claude-login",
    label: "Вход по подписке",
  },
  {
    hint: "Запустить Claude Code",
    icon: SparklesIcon,
    id: "claude-code",
    label: "Claude Code",
  },
];

/**
 * Кнопка режима отдельным компонентом, а не стрелкой в пропсе: правило
 * `noJsxPropsBind` действует не из вкусовщины — новая функция на каждый рендер
 * ломает мемоизацию у всего, что ниже. Заодно тут видно, что «активный» — это
 * подсветка, а не состояние соединения.
 */
function ModeButton({
  active,
  mode,
  onPick,
}: {
  active: boolean;
  mode: (typeof MODES)[number];
  onPick: (id: Mode) => void;
}) {
  const handleClick = useCallback(() => {
    onPick(mode.id);
  }, [mode.id, onPick]);

  const Icon = mode.icon;
  return (
    <Button
      className={cn(active && "bg-white/10")}
      onClick={handleClick}
      size="sm"
      title={mode.hint}
      variant="ghost"
    >
      <Icon size={14} />
      {mode.label}
    </Button>
  );
}

export function TerminalPanel() {
  const [mode, setMode] = useState<Mode>("system");
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

  useEffect(() => {
    connect("system");
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

  const handleMode = useCallback(
    (next: Mode) => {
      setMode(next);
      connect(next);
    },
    [connect]
  );

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

        <div className="flex flex-wrap gap-1">
          {MODES.map((m) => (
            <ModeButton
              active={mode === m.id}
              key={m.id}
              mode={m}
              onPick={handleMode}
            />
          ))}
        </div>

        <span className="ml-auto font-mono text-[11px] text-white/50">
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
