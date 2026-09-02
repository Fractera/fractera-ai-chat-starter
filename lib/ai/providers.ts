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

function openai() {
  return createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });
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
