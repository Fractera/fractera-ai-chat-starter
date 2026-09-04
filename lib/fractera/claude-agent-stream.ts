import "server-only";

import type { UIMessageStreamWriter } from "ai";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import { askClaudeAgent } from "@/lib/fractera/claude-agent";

// ПЕРЕВОД ПОТОКА АГЕНТА В ЛЕНТУ ЧАТА (113-3, 2026-09-04).
//
// 🔒 ЛЕНТА ОДНА НА ОБА РЕЖИМА, И ВТОРОЙ НЕ ЗАВОДИТСЯ. Ответ Agent SDK едет теми
// же кусками `text-start / text-delta / text-end`, что и ответ AI SDK, — значит
// ту же ленту рисует тот же код, сообщения сохраняются тем же `onEnd`, и зеркало
// в Telegram работает без единой правки. Своя лента для второго режима означала
// бы второй чат внутри чата.
//
// 🔒 ЭТОТ ФАЙЛ ОТДЕЛЁН ОТ `claude-agent.ts` НАМЕРЕННО. Тот знает про SDK и не
// знает про ленту; этот знает про ленту и не знает про SDK глубже четырёх родов
// куска. Слитые вместе, они дали бы место, которое нельзя ни прочитать, ни
// заменить по частям — а заменить придётся: инструменты и навыки меняют именно
// первый файл.

// 🔒 ТИП ПИСАТЕЛЯ БЕРЁТСЯ У БИБЛИОТЕКИ, А НЕ ОПИСЫВАЕТСЯ СВОЙ.
// ✗ Оплачено сборкой на сервере 2026-09-04: свой «достаточно похожий» тип
// (`{ write: (part: {...}) => void }`) компилятор не принял — у настоящего
// писателя параметр строже, и структурная совместимость здесь не работает.
// Свой тип рядом с чужим — это ещё и вторая правда о контракте: библиотека
// поменяет свой, а наш останется прежним и разойдётся молча.
type StreamWriter = UIMessageStreamWriter<ChatMessage>;

/**
 * Текст последнего вопроса человека.
 *
 * 🛑 СЕГОДНЯ АГЕНТУ УЕЗЖАЕТ ТОЛЬКО ПОСЛЕДНЕЕ СООБЩЕНИЕ, И ЭТО НАЗВАНО, А НЕ
 * ЗАБЫТО. У SDK есть свои сессии (`Sessions` в документации), которые держат
 * нить разговора на его стороне; склеивать историю руками, не разобравшись с
 * ними, значит завести вторую память о разговоре рядом с той, что уже есть в
 * Postgres. Нить разговора для этого режима — предмет отдельного шага.
 */
export function lastUserText(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) {
    return "";
  }
  return last.parts
    .filter((p): p is { text: string; type: "text" } => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

/**
 * Прогнать вопрос через агента и вылить ответ в открытый поток ленты.
 *
 * 🔒 ШАГ РАЗБОРА НАЗЫВАЕТ ПУТЬ ПОИМЁННО. В ручном режиме в ленте стоит «Модель
 * формирует ответ»; здесь — «Claude Agent SDK». Одинаковая подпись у двух разных
 * путей сделала бы развилку невидимой ровно там, где её и надо видеть.
 */
export async function streamClaudeAgent({
  dataStream,
  markModelActive,
  prompt,
  signal,
  stopWaitingStatus,
}: {
  dataStream: StreamWriter;
  markModelActive: () => void;
  prompt: string;
  signal?: AbortSignal;
  stopWaitingStatus: () => void;
}): Promise<void> {
  const stepId = "claude-agent";
  const label = "Claude Agent SDK формирует ответ";

  dataStream.write({
    data: { id: stepId, label, status: "pending" },
    id: stepId,
    type: "data-parse-step",
  });

  if (!prompt) {
    stopWaitingStatus();
    dataStream.write({
      data: { id: stepId, label, status: "error" },
      id: stepId,
      type: "data-parse-step",
    });
    return;
  }

  // 🔒 ОДИН БЛОК ТЕКСТА НА ВЕСЬ ОТВЕТ: `text-start` открывается ЛЕНИВО, при
  // первом настоящем куске. Открой его заранее — и отказ без единого символа
  // оставил бы в ленте пустой пузырь, неотличимый от «модель промолчала».
  const textId = generateUUID();
  let opened = false;
  const open = () => {
    if (opened) {
      return;
    }
    opened = true;
    markModelActive();
    dataStream.write({ id: textId, type: "text-start" });
  };

  let failed: string | null = null;

  for await (const chunk of askClaudeAgent({ prompt, signal })) {
    if (signal?.aborted) {
      break;
    }
    if (chunk.type === "text") {
      open();
      dataStream.write({ delta: chunk.text, id: textId, type: "text-delta" });
    } else if (chunk.type === "tool") {
      // Инструментов сегодня нет; если строка сработала, список кто-то расширил,
      // и человек увидит это в ленте, а не только в логе сервера.
      open();
      dataStream.write({ delta: `\n\n_инструмент: ${chunk.name}_\n\n`, id: textId, type: "text-delta" });
    } else if (chunk.type === "retry") {
      // 🔒 ОЖИДАНИЕ ПОКАЗЫВАЕТСЯ, ПОКА ОНО ИДЁТ. Замер 2026-09-04: пауза между
      // повторами растёт до десятков секунд, и молчащий экран в это время
      // неотличим от зависшего. Статус `transient` — он не оседает в истории
      // разговора, потому что это не часть ответа.
      dataStream.write({
        data: {
          message: `Anthropic не отвечает, повтор ${chunk.attempt}${chunk.status ? ` (HTTP ${chunk.status})` : ""}…`,
          modelId: "claude-agent",
          modelName: "Claude Agent SDK",
          phase: "still-waiting",
        },
        transient: true,
        type: "data-waiting-status",
      });
    } else if (chunk.type === "error") {
      failed = chunk.message;
    }
  }

  if (failed !== null) {
    // 🛑 ОТКАЗ ПОКАЗЫВАЕТСЯ ЧЕЛОВЕКУ ТЕКСТОМ, А НЕ ТОЛЬКО ПОМЕТКОЙ ШАГА. Красная
    // плашка без слов заставляет открывать журнал сервера — то есть просить
    // владельца сделать то, чего он сделать не может.
    open();
    dataStream.write({ delta: failed, id: textId, type: "text-delta" });
  }

  if (opened) {
    dataStream.write({ id: textId, type: "text-end" });
  }

  stopWaitingStatus();
  dataStream.write({
    data: { id: stepId, label, status: failed === null ? "done" : "error" },
    id: stepId,
    type: "data-parse-step",
  });
}
