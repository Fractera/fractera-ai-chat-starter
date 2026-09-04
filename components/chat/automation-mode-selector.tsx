"use client";

import { memo, useCallback, useState } from "react";
import useSWR, { mutate } from "swr";
import { toast } from "sonner";
import { BotIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import type { AutomationMode } from "@/lib/fractera/automation-mode";

// ПЕРЕКЛЮЧАТЕЛЬ СТРАТЕГИИ АВТОМАТИЗАЦИИ В ПОЛЕ ВВОДА (112-2, 2026-09-04).
//
// 🪦 ЗДЕСЬ СТОЯЛ ВЫБОР МОДЕЛИ OpenAI, И ОН УБРАН ПРЯМЫМ СЛОВОМ ВЛАДЕЛЬЦА.
// Дословно: «внутри чата переключатель модели нецелесообразно использовать — один
// выбор ко всем агентам… переходим к персональным настройкам каждого агента, а у
// нас будет буквально для каждого элемента реестра признаков создан свой агент».
// 🔒 ПРИЧИНА АРХИТЕКТУРНАЯ, А НЕ КОСМЕТИЧЕСКАЯ: один выбор на весь конвейер
// противоречит замыслу, где у каждого агента своя модель — слабая там, где хватает,
// сильная там, где нужно. Оставленный селектор обещал бы власть, которой у него нет.
// 🛑 ЦЕНА НАЗВАНА: сменить модель посреди разговора больше нельзя, а персональные
// настройки агентов ещё не построены. В промежутке ручной режим отвечает моделью из
// `OPENAI_TEXT_MODEL` — существующей настройки, не литерала.
//
// 🔒 ВИД ВЗЯТ У ПРЕЖНЕГО СЕЛЕКТОРА ЦЕЛИКОМ — те же примитивы `ModelSelector*` из
// вендоренной библиотеки. Своя разметка «потому что теперь это другое» дала бы
// вторую реализацию одного выпадающего списка в одном поле ввода.
//
// 🛑 СЕГОДНЯ ЗА ПЕРЕКЛЮЧАТЕЛЕМ НЕТ ПОВЕДЕНИЯ НИ В ОДНОМ ПОЛОЖЕНИИ — слово
// владельца: «Пусть оно переключается но ни на что не влияет пока». Поэтому под
// списком стоит строка, которая это ГОВОРИТ. Молчаливо ничего не делающий орган
// управления читается как поломка, а не как «рано» (закон 28-13).

type ModeDescriptor = {
  id: AutomationMode;
  name: string;
  hint: string;
  icon: typeof BotIcon;
};

// 🔒 ИМЯ ПРОДУКТА — «Claude Agent SDK». Поправка владельца 2026-09-04 («Cloud
// Agent SDK incorrect») и правила бренда первоисточника: «Claude Agent»
// разрешено, «Claude Code» в названии чужого продукта — нет.
const MODES: ModeDescriptor[] = [
  {
    hint: "Навыки и MCP, алгоритмы Anthropic",
    icon: SparklesIcon,
    id: "claude",
    name: "Claude Agent SDK",
  },
  {
    hint: "Свой конвейер: дешёвые и дорогие модели по местам",
    icon: BotIcon,
    id: "openai",
    name: "AI SDK с OpenAI",
  },
];

const ENDPOINT = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/fractera/automation-mode`;

function PureAutomationModeSelector() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // 🔒 ЗНАЧЕНИЕ СПРАШИВАЕТСЯ У ДВЕРИ, А НЕ ХРАНИТСЯ В КУКЕ. Режим принадлежит
  // ПРОЕКТУ: у куки он был бы у каждого зрителя свой, и экран архитектора показал
  // бы третье. Тот же довод, по которому выбор модели куку заслуживал, а этот — нет.
  const { data } = useSWR<{ mode?: AutomationMode }>(
    ENDPOINT,
    (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json()),
    { revalidateOnFocus: false }
  );

  const current = data?.mode ?? "claude";
  const selected = MODES.find((m) => m.id === current) ?? MODES[0];

  const choose = useCallback(
    async (mode: AutomationMode) => {
      setOpen(false);
      if (mode === current || busy) {
        return;
      }
      setBusy(true);
      try {
        const r = await fetch(ENDPOINT, {
          body: JSON.stringify({ mode }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (!r.ok) {
          // 🛑 ОТКАЗ НАЗЫВАЕТСЯ ОТКАЗОМ. Молчаливый возврат к прежнему значению
          // человек читает как «кнопка не работает», а не как «не разрешено».
          toast.error(
            r.status === 403
              ? "Менять режим может только архитектор"
              : "Режим не сохранён"
          );
          return;
        }
        await mutate(ENDPOINT);
        toast.success("Режим сохранён");
      } catch {
        toast.error("Режим не сохранён");
      } finally {
        setBusy(false);
      }
    },
    [busy, current]
  );

  const SelectedIcon = selected.icon;

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger asChild>
        <Button
          className="h-7 max-w-[220px] justify-between gap-1.5 rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          data-testid="automation-mode-selector"
          disabled={busy}
          variant="ghost"
        >
          <SelectedIcon className="size-3.5" />
          <ModelSelectorName>{selected.name}</ModelSelectorName>
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent commandDefaultValue={selected.id}>
        <ModelSelectorList>
          <ModelSelectorGroup heading="Стратегия автоматизации">
            {MODES.map((mode) => {
              const Icon = mode.icon;
              return (
                <ModelSelectorItem
                  className="flex w-full transition-colors data-[selected=true]:bg-muted data-[selected=true]:text-foreground"
                  key={mode.id}
                  onSelect={() => {
                    void choose(mode.id);
                  }}
                  value={mode.id}
                >
                  <Icon className="size-3.5" />
                  <div className="flex min-w-0 flex-col">
                    <ModelSelectorName>{mode.name}</ModelSelectorName>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {mode.hint}
                    </span>
                  </div>
                </ModelSelectorItem>
              );
            })}
          </ModelSelectorGroup>
          {/* 🛑 Честная строка о том, что режим сегодня ничего не меняет. Она
              исчезнет тем же шагом, который даст режиму поведение. */}
          <div className="border-border border-t px-3 py-2 text-[11px] text-muted-foreground">
            Режим сохраняется в настройках проекта. Поведение за ним ещё не
            построено — ответ пока одинаковый в обоих положениях.
          </div>
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

export const AutomationModeSelector = memo(PureAutomationModeSelector);
