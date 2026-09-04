import "server-only";

import { mkdirSync } from "node:fs";
import { slotEnv } from "@/lib/fractera/slot-env";

// CLAUDE AGENT SDK — ВТОРОЙ ПУТЬ ОТВЕТА (113-3, 2026-09-04).
//
// 🔒 ВСЁ, ЧТО ЗДЕСЬ НАПИСАНО, ВЗЯТО ИЗ ПЕРВОИСТОЧНИКА, А НЕ ИЗ ПАМЯТИ. Адреса:
// `code.claude.com/docs/en/agent-sdk/{overview,quickstart,typescript}`, прочитаны
// 2026-09-04. Закон чужого навыка `ai-sdk` действует и здесь: код SDK по памяти
// не пишется.
//
// 🔒 КЛЮЧ ПОДАЁТСЯ ПОЛЕМ `env`, И ЭТО НЕ УКРАШЕНИЕ. Дословно из документации:
// «The SDK reads the key from the environment of the process that runs your
// agent; it doesn't load `.env` files automatically». Наш ключ лежит в файле
// проекта, а не в окружении процесса чата, — без явной передачи агент не увидел
// бы его никогда и сказал бы «Not logged in».
//
// 🛑 `env` ЗАМЕНЯЕТ ОКРУЖЕНИЕ ЦЕЛИКОМ, А НЕ ДОПОЛНЯЕТ ЕГО — тоже дословно из
// справочника типов. Поэтому `{ ...process.env, ... }`, иначе у подпроцесса
// пропадёт `PATH`, и бинарник SDK не найдёт ни себя, ни node.
//
// 🔒 ИНСТРУМЕНТОВ У АГЕНТА НЕТ (`allowedTools: []`), И ЭТО РЕШЕНИЕ, А НЕ РОБОСТЬ.
// SDK даёт `Read`, `Edit`, `Bash` по файловой системе ТОГО процесса, где запущен,
// — то есть боевого сервера. Пока у агента нет ни навыков, ни MCP, инструменты
// дали бы любому, кто откроет чат, запуск команд на машине владельца под нашей
// ролью. **Граница рабочей папки — не песочница:** `cwd` задаёт, откуда агент
// начинает, а не куда ему запрещено ходить. Инструменты включает тот шаг, который
// даст им работу.
//
// 🔒 РАБОЧАЯ ПАПКА ЗАВОДИТСЯ СЕЙЧАС, ХОТЯ ПУСТА. `cwd` — свойство каждого вызова:
// не задай его, и агент начнёт работу в папке самого чата, то есть в исходниках
// службы. Заведённая позже, она не исправила бы уже сделанных вызовов.

/** Где агент живёт. Отдельная папка, а не дерево чата. */
export function agentWorkspace(): string {
  return process.env.FRACTERA_AGENT_WORKSPACE || "/opt/fractera/agent-workspace";
}

/**
 * Ключ Anthropic — из файла проекта, при каждом обращении.
 *
 * 🔒 ЧАТ НЕ ДЕРЖИТ СВОЕЙ КОПИИ ЧУЖОГО СЕКРЕТА — закон `slot-env.ts`. Своя копия
 * разошлась бы с оригиналом молча в тот день, когда владелец сменит ключ.
 * 🔒 БЕЗ КЭША: введённый ключ действует со следующего вопроса, и карточка на
 * экране бота обещает ровно это.
 */
export function anthropicKey(): string {
  return slotEnv("ANTHROPIC_API_KEY") || process.env.ANTHROPIC_API_KEY || "";
}

/**
 * Модель агента.
 *
 * 🔒 ИМЯ НЕ ЗАШИТО ЛИТЕРАЛОМ, И ПУСТОЕ ЗНАЧЕНИЕ ЗАКОННО: тогда модель выбирает
 * сам SDK своим умолчанием. Идентификаторы моделей берутся списком в момент
 * замера, а не из памяти агента, — через месяц список другой.
 */
export function agentModel(): string {
  return slotEnv("ANTHROPIC_MODEL") || process.env.ANTHROPIC_MODEL || "";
}

export type AgentChunk =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "done"; subtype: string }
  | { type: "error"; message: string };

/**
 * Один вопрос агенту — поток кусков, годный для ленты чата.
 *
 * 🔒 ПОТОК ПЕРЕВОДИТСЯ В НАШИ КУСКИ ЗДЕСЬ, А НЕ В МАРШРУТЕ. Маршрут знает про
 * ленту и `dataStream`; этот файл — про SDK. Смешав их, мы получили бы место,
 * которое нельзя ни прочитать, ни заменить по частям.
 *
 * 🔒 ИМПОРТ ЛЕНИВЫЙ, И ПРИЧИНА МЕХАНИЧЕСКАЯ: пакет везёт СВОЙ бинарник через
 * optional-зависимости npm. Установка вида `--omit=optional` оставит модуль без
 * бинарника, и статический импорт уронил бы весь маршрут чата — включая ручной
 * режим, который к SDK отношения не имеет. Ленивый импорт превращает это в
 * честную ошибку одного режима.
 */
export async function* askClaudeAgent({
  prompt,
  signal,
}: {
  prompt: string;
  signal?: AbortSignal;
}): AsyncGenerator<AgentChunk> {
  const key = anthropicKey();
  if (!key) {
    // 🛑 ОТКАЗ НАЗЫВАЕТ ПРИЧИНУ И АДРЕС, ГДЕ ЕЁ ЛЕЧАТ. Молчание в этом месте
    // человек читает как поломку чата, а не как ненастроенный ключ.
    yield {
      message:
        "Ключ Anthropic не задан. Введите его на экране бота: «Настройки» → карточка «Ключ Anthropic».",
      type: "error",
    };
    return;
  }

  const cwd = agentWorkspace();
  try {
    // Папка обязана существовать до вызова: SDK стартует в ней.
    mkdirSync(cwd, { recursive: true });
  } catch {
    // Нет прав или диска — это скажет сам вызов, и скажет точнее.
  }

  let query: typeof import("@anthropic-ai/claude-agent-sdk").query;
  try {
    ({ query } = await import("@anthropic-ai/claude-agent-sdk"));
  } catch (e) {
    yield {
      message: `Claude Agent SDK не установлен или остался без своего бинарника: ${String(e)}`,
      type: "error",
    };
    return;
  }

  const model = agentModel();

  try {
    for await (const message of query({
      options: {
        // 🔒 ПУСТОЙ СПИСОК — ЭТО И ЕСТЬ РЕШЕНИЕ. См. закон в шапке файла.
        allowedTools: [],
        cwd,
        env: { ...process.env, ANTHROPIC_API_KEY: key },
        ...(model ? { model } : {}),
      },
      prompt,
    })) {
      if (signal?.aborted) {
        return;
      }
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block && typeof block.text === "string") {
            yield { text: block.text, type: "text" };
          } else if ("name" in block && typeof block.name === "string") {
            // Инструментов сегодня нет, но строка оставлена: если она когда-нибудь
            // сработает, значит список инструментов кто-то расширил, и это будет
            // видно в ленте, а не только в логе.
            yield { name: block.name, type: "tool" };
          }
        }
      } else if (message.type === "result") {
        yield { subtype: message.subtype, type: "done" };
      }
    }
  } catch (e) {
    yield { message: String(e), type: "error" };
  }
}
