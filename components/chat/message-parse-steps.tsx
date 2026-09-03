"use client";

import { CheckIcon, LoaderIcon, XIcon } from "lucide-react";
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

const STATUS_ICON = { done: CheckIcon, error: XIcon, pending: LoaderIcon } as const;
const STATUS_KIND = {
  done: "complete",
  error: "active",
  pending: "active",
} as const;

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
            icon={STATUS_ICON[step.status]}
            key={step.id}
            label={step.label}
            status={STATUS_KIND[step.status]}
          />
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}
