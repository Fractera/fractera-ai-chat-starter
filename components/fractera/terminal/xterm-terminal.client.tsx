"use client";

import { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { useEffect, useImperativeHandle, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

// ОБЁРТКА xterm.js — ПЕРЕНЕСЕНА ИЗ `e1e7ff0^`, А НЕ НАПИСАНА ЗАНОВО (шаг 114-4).
//
// Источник: `ai-workspace`, `bridges/app/components/ai-elements/xterm-terminal.client.tsx`
// на ревизии перед удалением шагом 500. Здесь она короче: платформ пять больше
// нет, а сокет открывает не она — им владеет панель, потому что панель же
// добывает билет и переключает режимы. Компонент только рисует и отдаёт наружу
// две способности: писать в stdin и забрать фокус.
//
// 🔒 РАЗМЕР СООБЩАЕТСЯ СЕРВЕРУ, А НЕ ПОДРАЗУМЕВАЕТСЯ. PTY заводится на 500
// колонок, чтобы ссылка входа не завернулась до первого замера; настоящий
// размер уезжает сразу после открытия и на каждое изменение окна. Без этого
// интерфейс CLI рисуется по чужой ширине и выглядит сломанным.

export type XtermHandle = {
  focus: () => void;
  write: (data: string) => void;
};

type Props = {
  /** Куда писать нажатия. */
  onData: (data: string) => void;
  /** Куда сообщать новый размер. */
  onResize: (size: { cols: number; rows: number }) => void;
  ref?: React.Ref<XtermHandle>;
};

export function XtermTerminal({ onData, onResize, ref }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  // Обработчики держим в ref: пересоздавать терминал из-за новой функции
  // означало бы терять содержимое ленты при каждом рендере панели.
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  onDataRef.current = onData;
  onResizeRef.current = onResize;

  useImperativeHandle(ref, () => ({
    focus: () => termRef.current?.focus(),
    write: (data: string) => termRef.current?.write(data),
  }));

  useEffect(() => {
    const host = containerRef.current;
    if (!host) {
      return;
    }

    let disposed = false;
    let term: Terminal | null = null;
    let observer: ResizeObserver | null = null;

    // 🔒 xterm ГРУЗИТСЯ ДИНАМИЧЕСКИ: он трогает `document` на уровне модуля,
    // и статический импорт утащил бы его в серверную сборку страницы.
    (async () => {
      const { Terminal: Xterm } = await import("@xterm/xterm");
      if (disposed) {
        return;
      }

      term = new Xterm({
        convertEol: true,
        cursorBlink: true,
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 13,
        scrollback: 5000,
        theme: { background: "#0b0b0c", foreground: "#e6e6e6" },
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      termRef.current = term;

      const push = () => {
        try {
          fit.fit();
        } catch {
          /* контейнер ещё нулевой высоты — следующий вызов застанет его живым */
        }
        onResizeRef.current({ cols: term?.cols ?? 80, rows: term?.rows ?? 24 });
      };

      push();
      term.focus();
      term.onData((d) => onDataRef.current(d));

      observer = new ResizeObserver(push);
      observer.observe(host);
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
      termRef.current = null;
      term?.dispose();
    };
  }, []);

  return <div className="h-full w-full" ref={containerRef} />;
}
