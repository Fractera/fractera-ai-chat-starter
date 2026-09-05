import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Document } from '@/lib/db/schema';
import { ChatbotError, type ErrorCode } from './errors';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    const { code, cause } = await response.json();
    throw new ChatbotError(code as ErrorCode, cause);
  }

  return response.json();
};

export async function fetchWithErrorHandlers(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    const response = await fetch(input, init);

    if (!response.ok) {
      const { code, cause } = await response.json();
      throw new ChatbotError(code as ErrorCode, cause);
    }

    return response;
  } catch (error: unknown) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new ChatbotError('offline:chat');
    }

    throw error;
  }
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getDocumentTimestampByIndex(
  documents: Document[],
  index: number,
) {
  if (!documents) { return new Date(); }
  if (index > documents.length) { return new Date(); }

  return documents[index].createdAt;
}

export function sanitizeText(text: string) {
  return text.replace('<has_function_call>', '');
}

// 🔒 ЗДЕСЬ СТОЯЛИ `convertToUIMessages` И `getTextFromMessage` — СНЯТЫ В ШАГЕ 134.
// Обе переводили строки базы в форму сообщений чат-интерфейса вендора и звались
// только из него. Интерфейс снесён, вызывающих мест не осталось; их тип
// `ChatMessage` жил в `lib/types.ts`, который тянул за собой инструменты и
// артефакты — то есть половину удалённого острова.
