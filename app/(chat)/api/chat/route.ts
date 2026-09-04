import { geolocation } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { fracteraRoles } from "@/lib/fractera/session";
import { channelOfChat } from "@/lib/fractera/channels";
import {
  escapeTelegramHtml,
  mirrorAttachments,
  sendToChannel,
  textOf,
} from "@/lib/fractera/answer";
import { inlineAttachmentsForModel } from "@/lib/fractera/media";
import { chatUiOf } from "@/lib/fractera/i18n";
import { auth } from "@/app/(auth)/auth";
import {
  allowedModelIds,
  chatModels,
  DEFAULT_CHAT_MODEL,
  getCapabilities,
  getModelAvailability,
} from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel, hasOpenAiKey } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { editDocument } from "@/lib/ai/tools/edit-document";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { isProductionEnvironment } from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import type { ChatMessage, WaitingStatusData } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

const HEALTH_CHECK_DELAY_MS = 9000;

function isModelStreamActivity(chunk: { type: string }) {
  return !["start", "start-step", "finish-step", "finish", "raw"].includes(
    chunk.type
  );
}

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch {
    return null;
  }
}

export { getStreamContext };

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id, message, messages, selectedChatModel, selectedVisibilityType } =
      requestBody;

    const [botIdResult, session] = await Promise.all([
      checkBotId().catch(() => null),
      auth(),
    ]);

    if (botIdResult?.isBot) {
      return new ChatbotError("forbidden:api").toResponse();
    }

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    // 🔒 ЧАТ ТОЛЬКО ДЛЯ АРХИТЕКТОРА (правка владельца 2026-09-02): «если
    // пользователь войдёт например под правами менеджера или пользователя и
    // попытается написать сообщение — выводи ошибку».
    //
    // 🔒 ЗАМОК СТОИТ НА ДВЕРИ, А НЕ НА ЭКРАНЕ. Проверку в браузере в браузере же
    // и отключают, а адрес этой двери виден в любой вкладке разработчика — тот
    // же закон, по которому устроен защищённый слой проекта.
    //
    // 🛑 ОТКАЗ ГОВОРИТ ПРИЧИНУ НА ЯЗЫКЕ ЧЕЛОВЕКА, а не «403»: иначе экран
    // выглядит сломанным, и человек идёт чинить работающее.
    const roles = await fracteraRoles();
    if (!roles.includes("architect")) {
      const ui = chatUiOf(request.headers.get("accept-language"));
      return Response.json({ code: "forbidden:chat", message: ui.architectOnly }, { status: 403 });
    }

    // 🛑 БЕЗ КЛЮЧА МОДЕЛИ ОТВЕЧАТЬ НЕЧЕМ, И СКАЗАТЬ ОБ ЭТОМ НАДО ЗДЕСЬ
    // (правка владельца 2026-09-03). ✗ прежде запрос уходил дальше, падал уже
    // внутри вызова модели, и человек получал «An error occurred» — фразу
    // обработчика ошибок, из которой не следует ни причина, ни действие.
    //
    // 🔒 ПРОВЕРКА СТОИТ РЯДОМ С ПРОВЕРКОЙ РОЛИ ПО ОДНОЙ ПРИЧИНЕ: обе отвечают на
    // вопрос «можно ли вообще начинать», и обе обязаны называть причину словами.
    // Экран, который показывает «что-то пошло не так», отправляет человека
    // чинить работающее.
    if (!hasOpenAiKey()) {
      const ui = chatUiOf(request.headers.get("accept-language"));
      return Response.json({ code: "bad_request:chat", message: ui.noKeyError }, { status: 400 });
    }

    const chatModel = allowedModelIds.has(selectedChatModel)
      ? selectedChatModel
      : DEFAULT_CHAT_MODEL;

    // 🔒 ЛИМИТЫ СНЯТЫ ПО ПРЯМОМУ СЛОВУ ВЛАДЕЛЬЦА 2026-09-03: «Я ни разу такого ограничения не
    // ставил... убирай лимиты они нам не нужны». Это чат одного архитектора, а не публичное
    // демо — шаблонные ограничения (10 сообщений/час на пользователя, IP-лимит через Redis)
    // были унаследованы из `vercel/ai-chatbot` и никогда не были нашим решением.

    const isToolApprovalFlow = Boolean(messages);

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      messagesFromDb = await getMessagesByChatId({ id });
    } else if (message?.role === "user") {
      await saveChat({
        id,
        title: "New chat",
        userId: session.user.id,
        visibility: selectedVisibilityType,
      });
      titlePromise = generateTitleFromUserMessage({ message });
    }

    let uiMessages: ChatMessage[];

    if (isToolApprovalFlow && messages) {
      const dbMessages = convertToUIMessages(messagesFromDb);
      const approvalStates = new Map(
        messages.flatMap(
          (m) =>
            m.parts
              ?.filter(
                (p: Record<string, unknown>) =>
                  p.state === "approval-responded" ||
                  p.state === "output-denied"
              )
              .map((p: Record<string, unknown>) => [
                String(p.toolCallId ?? ""),
                p,
              ]) ?? []
        )
      );
      uiMessages = dbMessages.map((msg) => ({
        ...msg,
        parts: msg.parts.map((part) => {
          if (
            "toolCallId" in part &&
            approvalStates.has(String(part.toolCallId))
          ) {
            return { ...part, ...approvalStates.get(String(part.toolCallId)) };
          }
          return part;
        }),
      })) as ChatMessage[];
    } else {
      uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        message as ChatMessage,
      ];
    }

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      city,
      country,
      latitude,
      longitude,
    };

    if (message?.role === "user") {
      await saveMessages({
        messages: [
          {
            attachments: [],
            chatId: id,
            createdAt: new Date(),
            id: message.id,
            parts: message.parts,
            role: "user",
          },
        ],
      });

      // 🔒 ШАГ 103 — ЗЕРКАЛИРОВАНИЕ ВХОДЯЩЕГО (браузер → связанный Telegram). Решение
      // владельца 2026-09-03: «вся переписка должна отзеркаливаться в связанный Telegram, как
      // входящие так и исходящие». `channelOfChat` отвечает `null` для чата без Telegram — это и
      // есть весь фильтр «только связанные»; `sendToChannel` не бросает исключений, отказ
      // Telegram не должен ронять ответ в браузере.
      const mirrorTarget = await channelOfChat(id);
      if (mirrorTarget) {
        const mirrorText = textOf(message.parts);
        if (mirrorText) {
          // 🔒 ШАГ 104 — ПОМЕТКА ИСТОЧНИКА, ТОЛЬКО У ВХОДЯЩЕГО (владелец, 2026-09-03): «сообщения
          // которые были входящими... первое из них было исходящим и это нужно отметить...
          // Ответы... маркировать не нужно». В Telegram оба сообщения выглядят одинаково —
          // пришедшими ОТ бота, — и без пометки не отличить вопрос человека от ответа модели.
          await sendToChannel(
            mirrorTarget.channel,
            mirrorTarget.chatId,
            `<b>Web Chat Input Message:</b> ${escapeTelegramHtml(mirrorText)}`,
            mirrorTarget.bot,
            "HTML"
          );
        }
        // 🔒 ШАГ 105 — ВЛОЖЕНИЯ ЗЕРКАЛЯТСЯ ТОЖЕ (владелец, 2026-09-03: «мне нужно чтобы в Telegram
        // приходили все данные»). Раньше зеркалился только текст — снимок, брошенный в веб-чат,
        // в Telegram не долетал вовсе, даже когда рядом был текст.
        await mirrorAttachments(message.parts, mirrorTarget.channel, mirrorTarget.chatId, mirrorTarget.bot);
      }
    }

    const modelConfig = chatModels.find((m) => m.id === chatModel);
    const modelCapabilities = await getCapabilities();
    const capabilities = modelCapabilities[chatModel];
    const isReasoningModel = capabilities?.reasoning === true;
    const supportsTools = capabilities?.tools === true;

    // 🔒 ВЛОЖЕНИЕ УЕЗЖАЕТ МОДЕЛИ СОДЕРЖИМЫМ, А НЕ ССЫЛКОЙ: наш адрес медиатеки
    // относительный и стоит под замком роли — снаружи его не открыть.
    const modelMessages = await convertToModelMessages(
      await inlineAttachmentsForModel(uiMessages),
    );

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const modelName = modelConfig?.name ?? chatModel;
        let hasModelActivity = false;
        let healthCheckTimer: ReturnType<typeof setTimeout> | undefined;

        const clearHealthCheckTimer = () => {
          if (healthCheckTimer) {
            clearTimeout(healthCheckTimer);
          }
        };

        const writeWaitingStatus = (
          phase: WaitingStatusData["phase"],
          messageText: string
        ) => {
          if (hasModelActivity && phase !== "thinking") {
            return;
          }
          dataStream.write({
            data: {
              message: messageText,
              modelId: chatModel,
              modelName,
              phase,
            },
            transient: true,
            type: "data-waiting-status",
          });
        };

        writeWaitingStatus("waiting", "Waiting...");

        healthCheckTimer = setTimeout(() => {
          getModelAvailability(chatModel)
            .then((availability) => {
              if (availability === "impacted") {
                writeWaitingStatus(
                  "health",
                  `${modelName} may be slow or unavailable right now...`
                );
              } else {
                writeWaitingStatus("still-waiting", "Still waiting...");
              }
            })
            .catch(() => {
              writeWaitingStatus("still-waiting", "Still waiting...");
            });
        }, HEALTH_CHECK_DELAY_MS);

        const markModelActive = () => {
          if (hasModelActivity) {
            return;
          }
          hasModelActivity = true;
          clearHealthCheckTimer();
          writeWaitingStatus("thinking", "Thinking...");
        };

        const stopWaitingStatus = () => {
          hasModelActivity = true;
          clearHealthCheckTimer();
        };

        // 🔒 ШАГ 101 — каркас области размышления. Persistent-часть (без `transient`):
        // остаётся в `Message_v2.parts` навсегда, реконсилируется по `id`. Сегодня — один
        // правдивый шаг-заглушка; настоящие шаги разбора запроса сюда не входят.
        dataStream.write({
          data: { id: "model-answer", label: "Модель формирует ответ", status: "pending" },
          id: "model-answer",
          type: "data-parse-step",
        });

        const result = streamText({
          activeTools:
            isReasoningModel && !supportsTools
              ? []
              : [
                  "getWeather",
                  "createDocument",
                  "editDocument",
                  "updateDocument",
                  "requestSuggestions",
                ],
          instructions: systemPrompt({ requestHints, supportsTools }),
          messages: modelMessages,
          model: getLanguageModel(chatModel),
          onAbort() {
            stopWaitingStatus();
          },
          onChunk({ chunk }) {
            if (isModelStreamActivity(chunk)) {
              markModelActive();
            }
          },
          onEnd() {
            stopWaitingStatus();
            dataStream.write({
              data: { id: "model-answer", label: "Модель формирует ответ", status: "done" },
              id: "model-answer",
              type: "data-parse-step",
            });
          },
          onError() {
            stopWaitingStatus();
            dataStream.write({
              data: { id: "model-answer", label: "Модель формирует ответ", status: "error" },
              id: "model-answer",
              type: "data-parse-step",
            });
          },
          providerOptions: {
            ...(modelConfig?.reasoningEffort && {
              openai: { reasoningEffort: modelConfig.reasoningEffort },
            }),
          },
          stopWhen: isStepCount(5),
          telemetry: {
            functionId: "stream-text",
            isEnabled: isProductionEnvironment,
          },
          tools: {
            createDocument: createDocument({
              dataStream,
              modelId: chatModel,
              session,
            }),
            editDocument: editDocument({ dataStream, session }),
            getWeather,
            requestSuggestions: requestSuggestions({
              dataStream,
              modelId: chatModel,
              session,
            }),
            updateDocument: updateDocument({
              dataStream,
              modelId: chatModel,
              session,
            }),
          },
        });

        dataStream.merge(
          toUIMessageStream({
            sendReasoning: isReasoningModel,
            stream: result.stream,
          })
        );

        if (titlePromise) {
          try {
            const title = await titlePromise;
            dataStream.write({ data: title, type: "data-chat-title" });
            updateChatTitleById({ chatId: id, title });
          } catch {
            /* non-fatal */
          }
        }
      },
      generateId: generateUUID,
      onEnd: async ({ messages: finishedMessages }) => {
        if (isToolApprovalFlow) {
          await Promise.all(
            finishedMessages.map(async (finishedMsg) => {
              const existingMsg = uiMessages.find(
                (m) => m.id === finishedMsg.id
              );
              if (existingMsg) {
                await updateMessage({
                  id: finishedMsg.id,
                  parts: finishedMsg.parts,
                });
                return;
              }

              await saveMessages({
                messages: [
                  {
                    attachments: [],
                    chatId: id,
                    createdAt: new Date(),
                    id: finishedMsg.id,
                    parts: finishedMsg.parts,
                    role: finishedMsg.role,
                  },
                ],
              });
            })
          );
        } else if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              attachments: [],
              chatId: id,
              createdAt: new Date(),
              id: currentMessage.id,
              parts: currentMessage.parts,
              role: currentMessage.role,
            })),
          });

          // 🔒 ШАГ 103 — ЗЕРКАЛИРОВАНИЕ ИСХОДЯЩЕГО (браузер → связанный Telegram). Тот же
          // фильтр, что у входящего: `channelOfChat` отвечает `null` для чата без привязки.
          const mirrorTarget = await channelOfChat(id);
          if (mirrorTarget) {
            const lastAssistant = [...finishedMessages]
              .reverse()
              .find((m) => m.role === "assistant");
            const mirrorText = lastAssistant ? textOf(lastAssistant.parts) : "";
            if (mirrorText) {
              await sendToChannel(
                mirrorTarget.channel,
                mirrorTarget.chatId,
                mirrorText,
                mirrorTarget.bot
              );
            }
            // 🔒 ШАГ 105 — вложения ответа (документы/картинки от инструментов) тоже зеркалятся.
            if (lastAssistant) {
              await mirrorAttachments(
                lastAssistant.parts,
                mirrorTarget.channel,
                mirrorTarget.chatId,
                mirrorTarget.bot
              );
            }
          }
        }
      },
      onError: (error) => {
        if (
          error instanceof Error &&
          error.message?.includes(
            "AI Gateway requires a valid credit card on file to service requests"
          )
        ) {
          return "AI Gateway requires a valid credit card on file to service requests. Please visit https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card to add a card and unlock your free credits.";
        }
        return "Oops, an error occurred!";
      },
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
    });

    return createUIMessageStreamResponse({
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ chatId: id, streamId });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch {
          /* non-critical */
        }
      },
      stream,
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatbotError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
