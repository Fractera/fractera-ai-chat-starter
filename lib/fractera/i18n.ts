import { headers } from "next/headers";

// СЛОВА ЧАТА — ДВА ЯЗЫКА (шаг 96, правка поверх шаблона).
//
// 🔒 НАШ СТАНДАРТ: строки живут в словаре, а не в разметке, и минимум — `en` и
// `ru`. Инлайн-тернар `lang === "ru" ? … : …` в коде запрещён: он расползается
// по файлам, и третий язык добавить становится нечем.
//
// 🔒 ЯЗЫК БЕРЁТСЯ ИЗ ЗАГОЛОВКА БРАУЗЕРА, А НЕ ИЗ АДРЕСА. У чата нет сегмента
// `/{lang}/`, и заводить его ради двух языков значило бы переписать маршруты
// шаблона — самую дорогую его часть. Появится настройка языка у человека —
// станет читаться она, и это будет одна правка здесь.

export type ChatLang = "en" | "ru";

export type ChatUi = {
  /** Шапка: имя чата рядом с именем компании. */
  headerSuffix: string;
  greetingTitle: string;
  greetingLead: string;
  /** Выпадающий список у имени человека. */
  signOut: string;
  signIn: string;
  theme: { toLight: string; toDark: string };
  /** Ключ модели. */
  keyTitle: string;
  keyPresent: string;
  keyAbsent: string;
  keyPlaceholder: string;
  keySave: string;
  keySaving: string;
  keySaved: string;
  keyBadFormat: string;
  keyFailed: string;
  /** Отказы. */
  architectOnly: string;
  /** Отказ, когда ключа модели нет вовсе. */
  noKeyError: string;
  guestBlocked: string;
  /** Голос и вложения. */
  voiceHint: string;
  voiceNoKey: string;
  voiceInsecure: string;
  attachHint: string;
};

const EN: ChatUi = {
  headerSuffix: "Agent Chat",
  greetingTitle: "What are we building?",
  greetingLead: "Ask about this project, its data, or what the bot understood.",
  signOut: "Sign out",
  signIn: "Sign in",
  theme: { toLight: "Light theme", toDark: "Dark theme" },
  keyTitle: "OpenAI key",
  keyPresent: "Key is set",
  keyAbsent: "No key yet",
  keyPlaceholder: "sk-…",
  keySave: "Save",
  keySaving: "Saving…",
  keySaved: "Key saved",
  keyBadFormat: "That does not look like an OpenAI key — they start with sk-",
  keyFailed: "Could not save the key",
  architectOnly: "This chat is for the architect only.",
  noKeyError:
    "I cannot answer: it looks like there is no OpenAI key. Open the settings in the left menu, choose the OpenAI setting and enter a paid key.",
  guestBlocked: "Guest access is disabled: sign in to write here.",
  voiceHint: "Dictate a message",
  voiceNoKey: "Voice input needs an OpenAI key.",
  voiceInsecure: "Voice input needs a secure connection (https).",
  attachHint: "Attach a photo, video, audio or document",
};

const RU: ChatUi = {
  headerSuffix: "Agent Chat",
  greetingTitle: "Что строим?",
  greetingLead: "Спросите о проекте, его данных или о том, что бот понял из сообщения.",
  signOut: "Выйти",
  signIn: "Войти",
  theme: { toLight: "Светлая тема", toDark: "Тёмная тема" },
  keyTitle: "Ключ OpenAI",
  keyPresent: "Ключ задан",
  keyAbsent: "Ключа пока нет",
  keyPlaceholder: "sk-…",
  keySave: "Сохранить",
  keySaving: "Сохраняю…",
  keySaved: "Ключ сохранён",
  keyBadFormat: "Это не похоже на ключ OpenAI — они начинаются с sk-",
  keyFailed: "Ключ сохранить не удалось",
  architectOnly: "Этот чат предназначен только для архитектора.",
  noKeyError:
    "Не могу ответить: похоже, у вас нет ключа OpenAI. Откройте настройки в левом меню, выберите настройку OpenAI и введите оплаченный ключ.",
  guestBlocked: "Гостевой вход отключён: чтобы писать здесь, войдите в проект.",
  voiceHint: "Надиктовать сообщение",
  voiceNoKey: "Для голосового ввода нужен ключ OpenAI.",
  voiceInsecure: "Голосовой ввод работает только по защищённому соединению (https).",
  attachHint: "Приложить фотографию, видео, звук или документ",
};

const DICT: Record<ChatLang, ChatUi> = { en: EN, ru: RU };

/** Язык страницы по заголовку браузера. Неизвестный — английский. */
export async function chatLang(): Promise<ChatLang> {
  const accept = (await headers()).get("accept-language") ?? "";
  return accept.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function chatUi(lang: ChatLang): ChatUi {
  return DICT[lang] ?? EN;
}

/** Слова для мест, где заголовков нет вовсе: дверей и отказов. */
export function chatUiOf(accept: string | null): ChatUi {
  return (accept ?? "").toLowerCase().startsWith("ru") ? RU : EN;
}
