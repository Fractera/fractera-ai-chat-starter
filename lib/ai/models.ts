// МОДЕЛИ ЧАТА — НАШИ, У НАШЕГО КЛЮЧА OpenAI (шаг 96, правка поверх шаблона).
//
// 🔒 ПЕРЕКЛЮЧАТЕЛЬ МОДЕЛЕЙ ОСТАЁТСЯ — прямое слово владельца: «несмотря на то,
// что ты убираешь шлюз, переключение моделей стоило бы оставить». Меняется не
// способность выбирать, а список: вместо чужих моделей шлюза — те, что видит
// НАШ ключ.
//
// 🔒 СПИСОК СНЯТ С ЖИВОГО КЛЮЧА 2026-09-02 (`GET /v1/models`), А НЕ ВСПОМНЕН.
// Это единственный честный источник: что доступно ключу, знает только ключ.
// Из увиденного здесь предложены четыре — от самой дешёвой до флагмана.
//
// 🛑 ЧЕГО В СПИСКЕ НЕТ И ПОЧЕМУ: у ключа видны `gpt-5.6-luna`, `-sol`, `-terra`
// и линейка `codex`. Их назначение из имени не выводится, а предложить человеку
// модель, о поведении которой мы ничего не знаем, значит пообещать неизвестное.
// Появится знание — появятся строки; список правится ВМЕСТЕ с этим объяснением.
//
// 🪦 ЗДЕСЬ БЫЛИ МОДЕЛИ ШЛЮЗА VERCEL — DeepSeek, Kimi, Grok, GPT-OSS. Убраны
// вместе со шлюзом: у нас один ключ и три потребителя, и второй путь ключа
// разошёлся бы с первым молча.

export const DEFAULT_CHAT_MODEL = "gpt-5.4-mini";

/** Модель для заголовков разговора: самая дешёвая, работы на одну строку. */
export const titleModel = {
  description: "Дешёвая модель для заголовков",
  id: "gpt-5.4-nano",
  name: "GPT-5.4 nano",
  provider: "openai",
};

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
};

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  gatewayOrder?: string[];
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
};

export const chatModels: ChatModel[] = [
  {
    description: "Самая дешёвая: короткие ответы, простые задачи",
    id: "gpt-5.4-nano",
    name: "GPT-5.4 nano",
    provider: "openai",
  },
  {
    description: "Быстрая и недорогая — та же, что разбирает сообщения бота",
    id: "gpt-5.4-mini",
    name: "GPT-5.4 mini",
    provider: "openai",
  },
  {
    description: "Полная модель линейки 5.4",
    id: "gpt-5.4",
    name: "GPT-5.4",
    provider: "openai",
  },
  {
    description: "Флагман: самая сильная из доступных ключу",
    id: "gpt-5.5",
    name: "GPT-5.5",
    provider: "openai",
  },
];

/**
 * Что умеет модель.
 *
 * 🔒 ОТВЕЧАЕМ САМИ, А НЕ СПРАШИВАЕМ ШЛЮЗ. Шаблон ходил за этим в
 * `ai-gateway.vercel.sh`; у нас шлюза нет, и запрос туда либо молчал бы, либо
 * рассказывал о чужих моделях. Все четыре предложенные модели умеют
 * инструменты и картинки — это свойство линейки, а не догадка о конкретной.
 */
export async function getCapabilities(): Promise<
  Record<string, ModelCapabilities>
> {
  return Object.fromEntries(
    chatModels.map((m) => [
      m.id,
      { reasoning: true, tools: true, vision: true } satisfies ModelCapabilities,
    ]),
  );
}

export const isDemo = process.env.IS_DEMO === "1";

export type GatewayModelWithCapabilities = ChatModel & {
  capabilities: ModelCapabilities;
};

/**
 * Полный список моделей.
 *
 * 🔒 У НАС ОН РАВЕН ПРЕДЛОЖЕННОМУ. В шаблоне это был каталог шлюза с сотнями
 * чужих моделей; список «всё, что видит ключ» показывать человеку нельзя — там
 * есть и то, что мы не умеем звать, и то, о чём ничего не знаем.
 */
export async function getAllGatewayModels(): Promise<
  GatewayModelWithCapabilities[]
> {
  return chatModels.map((m) => ({
    ...m,
    capabilities: { reasoning: true, tools: true, vision: true },
  }));
}

export function getActiveModels(): ChatModel[] {
  return chatModels;
}

export const allowedModelIds = new Set(chatModels.map((m) => m.id));

export const modelsByProvider = chatModels.reduce(
  (acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  },
  {} as Record<string, ChatModel[]>,
);

export type ModelAvailability = "healthy" | "impacted" | "unknown";

/**
 * Жива ли модель.
 *
 * 🛑 ЧЕСТНЫЙ ОТВЕТ — «НЕИЗВЕСТНО», И ОН ЛУЧШЕ ПРИДУМАННОГО «ЗДОРОВА». Шаблон
 * узнавал это у шлюза, который следит за провайдерами; у OpenAI такого прибора
 * для нас нет, а рисовать зелёный кружок без измерения значит обещать то, чего
 * мы не проверяли.
 */
export async function getModelAvailability(
  modelId: string,
): Promise<ModelAvailability> {
  return allowedModelIds.has(modelId) ? "unknown" : "unknown";
}
