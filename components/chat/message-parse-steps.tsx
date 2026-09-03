"use client";

import {
  CheckIcon,
  DatabaseIcon,
  ImageIcon,
  LinkIcon,
  LoaderIcon,
  MessageSquareIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "../ai-elements/chain-of-thought";
import type { ParseStepData } from "@/lib/types";

// 🔒 ШАГ 101 — каркас области размышления. НЕ reasoning: эти шаги рождает наш код (запрос к БД,
// реестр, инструмент), а не модель, поэтому ChainOfThought, а не Reasoning. Сегодня приходит
// ровно один правдивый шаг-заглушка «модель формирует ответ» — настоящий разбор запроса сюда не
// входит, это отдельная будущая работа.


// 🔒 ХАРДКОР-ВИТРИНА (2026-09-03): значки по id demo-шага из lib/fractera/demo-steps.ts —
// чтобы владелец различал типы на глаз. У model-answer своей иконки нет, статус говорит сам.
const DEMO_ICON: Record<string, typeof DatabaseIcon> = {
  "demo-db": DatabaseIcon,
  "demo-image": ImageIcon,
  "demo-link": LinkIcon,
  "demo-registry": MessageSquareIcon,
  "demo-text": MessageSquareIcon,
  "demo-tool": WrenchIcon,
};

const STATUS_ICON = { done: CheckIcon, error: XIcon, pending: LoaderIcon } as const;
const STATUS_KIND = {
  done: "complete",
  error: "active",
  pending: "active",
} as const;

// 🔒 ХАРДКОР-ВИТРИНА, ТОЧНОЕ ПОВЕДЕНИЕ ПО СЛОВУ ВЛАДЕЛЬЦА 2026-09-03: сначала
// точки ("загружается"), ЗАТЕМ подпись появляется печатающимся эффектом —
// а не сразу целиком. Два состояния, а не одно.
function StepLabel({ label, status }: { label: string; status: ParseStepData["status"] }) {
  if (status === "pending") {
    return (
      <span aria-label={label} className="demo-step-dots">
        <span />
        <span />
        <span />
      </span>
    );
  }
  return (
    <span className="demo-step-stream" key={label}>
      {label}
    </span>
  );
}

type MessageParseStepsProps = {
  steps: ParseStepData[];
  isLoading: boolean;
};

export function MessageParseSteps({ steps, isLoading }: MessageParseStepsProps) {
  if (steps.length === 0) {
    return null;
  }

  return (
    <ChainOfThought data-testid="message-parse-steps" defaultOpen={isLoading}>
      <ChainOfThoughtHeader>Ход ответа</ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {steps.map((step) => (
          <ChainOfThoughtStep
            className={step.status === "error" ? "text-destructive" : undefined}
            icon={DEMO_ICON[step.id] ?? STATUS_ICON[step.status]}
            key={step.id}
            label={<StepLabel label={step.label} status={step.status} />}
            status={STATUS_KIND[step.status]}
          />
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}
