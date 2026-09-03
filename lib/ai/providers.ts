import { readFileSync } from "node:fs";
import { createOpenAI } from "@ai-sdk/openai";
import { customProvider } from "ai";
import { isTestEnvironment } from "../constants";
import { titleModel } from "./models";

// ПРОВАЙДЕР МОДЕЛЕЙ — НАШ КЛЮЧ OpenAI НАПРЯМУЮ (шаг 96, правка поверх шаблона).
//
// 🔒 ШЛЮЗ VERCEL У НАС ЗАПРЕЩЁН, И ДОВОД МЕХАНИЧЕСКИЙ, А НЕ ИДЕЙНЫЙ: ключ один,
// потребителей три — проект, слой данных, граф знаний, — и на экране бота стоит
// плашка, которая жёлтая, пока ключ есть не у всех. Шлюз был бы ЧЕТВЁРТЫМ путём
// ключа, о котором плашка ничего не знает, и расхождение случилось бы молча.
//
// 🔒 КЛЮЧ ЧИТАЕТСЯ ИЗ ОКРУЖЕНИЯ ОДНИМ МЕСТОМ. В гостевом приложении это
// `lib/openai-key.ts`; здесь окружение ставится при доставке, и второго чтения
// в этом репозитории нет намеренно.
//
// 🪦 ЗДЕСЬ БЫЛ `gateway.languageModel(...)`. Убран вместе со списком чужих
// моделей; переключатель моделей при этом остался — сменился только их источник.

/**
 * Ключ читается ПРИ КАЖДОМ ОБРАЩЕНИИ, из общего файла проекта.
 *
 * 🔒 ОДИН КЛЮЧ НА ВЕСЬ СЕРВЕР: чат не заводит своей копии, иначе он отвечал бы
 * старым ключом после того, как владелец сменил его на экране бота.
 * 🔒 БЕЗ КЭША И БЕЗ ПЕРЕЗАПУСКА: введённый ключ действует со следующего
 * сообщения — «сохранено» и «применено» здесь совпадают.
 */
function openAiKey(): string {
  const path = process.env.FRACTERA_SLOT_ENV || "/opt/fractera/app/.env.local";
  try {
    const raw = readFileSync(path, "utf8");
    const found = (raw.match(/^OPENAI_API_KEY=(.+)$/m) ?? [])[1];
    if (found?.trim()) {
      return found.trim();
    }
  } catch {
    // Файла нет — это чужая машина или разработка: берём окружение.
  }
  return process.env.OPENAI_API_KEY ?? "";
}

/**
 * Есть ли вообще чем говорить с моделью.
 *
 * 🔒 ПРОВЕРЯЕТСЯ ДО ВЫЗОВА, А НЕ ПОСЛЕ ЕГО ПРОВАЛА (2026-09-03). ✗ оплачено
 * владельцем в первую же минуту: без ключа чат отвечал «An error occurred» —
 * общей фразой обработчика ошибок, из которой не следует НИЧЕГО. Его слова:
 * «напиши информацию о том, что возможно у вас нет ключа OpenAI, откройте
 * настройки в левом меню».
 *
 * 🔒 ЭТО ТОТ ЖЕ ЗАКОН, ЧТО ПРИМЕНЁН В СЛУЖБЕ КАНАЛОВ В ТОТ ЖЕ ДЕНЬ: сначала
 * проверяется условие, без которого ответ невозможен, и только потом толкуется
 * то, что вернул чужой код. Разбирать чужие сообщения об отказе бесполезно — их
 * пишет не наш код и меняет с каждой версией.
 */
export function hasOpenAiKey(): boolean {
  return Boolean(openAiKey());
}

function openai() {
  return createOpenAI({ apiKey: openAiKey() });
}

export const myProvider = isTestEnvironment
  ? (() => {
      const {
        chatModel,
        titleModel: mockTitleModel,
      } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "title-model": mockTitleModel,
        },
      });
    })()
  : null;

export function getLanguageModel(modelId: string) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(modelId);
  }

  return openai()(modelId);
}

export function getTitleModel() {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }
  return openai()(titleModel.id);
}
