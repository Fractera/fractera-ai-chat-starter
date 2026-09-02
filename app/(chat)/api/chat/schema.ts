import { z } from "zod";

import {
  ALLOWED_MEDIA_TYPES,
  isAllowedAttachmentUrl,
} from "@/lib/fractera/attachments";

const textPartSchema = z.object({
  text: z.string().min(1).max(2000),
  type: z.enum(["text"]),
});

// 🔒 РОДА И АДРЕС БЕРУТСЯ ИЗ ОБЩЕГО ИСТОЧНИКА, А НЕ ПОВТОРЯЮТСЯ ЗДЕСЬ.
// Шаблон держал тут свой список из двух картинок и требовал абсолютный URL —
// у него файлы жили в чужом хранилище. Наши лежат на этом же сервере, и
// второе перечисление разошлось бы с дверью загрузки молча.
// ✗ Оплачено 2026-09-02: файл загружался, показывался в поле ввода — и
// отправка отвечала «The request couldn't be processed».
const filePartSchema = z.object({
  mediaType: z.enum(ALLOWED_MEDIA_TYPES),
  name: z.string().min(1).max(100),
  type: z.enum(["file"]),
  url: z.string().refine(isAllowedAttachmentUrl, {
    message: "Адрес вложения не из медиатеки проекта",
  }),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

const userMessageSchema = z.object({
  id: z.uuid(),
  parts: z.array(partSchema),
  role: z.enum(["user"]),
});

const toolApprovalMessageSchema = z.object({
  id: z.string(),
  parts: z.array(z.record(z.string(), z.unknown())),
  role: z.enum(["user", "assistant"]),
});

export const postRequestBodySchema = z.object({
  id: z.uuid(),
  message: userMessageSchema.optional(),
  messages: z.array(toolApprovalMessageSchema).optional(),
  selectedChatModel: z.string(),
  selectedVisibilityType: z.enum(["public", "private"]),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
