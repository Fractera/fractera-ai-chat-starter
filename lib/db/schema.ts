import type { InferSelectModel } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  json,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const user = pgTable("User", {
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  email: varchar("email", { length: 64 }).notNull(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  image: text("image"),
  isAnonymous: boolean("isAnonymous").notNull().default(false),
  name: text("name"),
  password: varchar("password", { length: 64 }),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type User = InferSelectModel<typeof user>;

export const chat = pgTable("Chat", {
  // ── Канал, которому принадлежит разговор (97-4, 2026-09-03) ────────────────
  //
  // 🔒 ЗАКОН ВЛАДЕЛЬЦА, ДОСЛОВНО: «технические решения нужно строить только так,
  // чтобы нативная система хранения сообщений внутри чата была единственным
  // источником данных, чтобы никаких отдельных промежуточных слоёв хранения в
  // связи с Telegram не возникало».
  //
  // Отсюда КОЛОНКИ ЗДЕСЬ, а не таблица соответствий «канал → разговор» рядом.
  // Отдельная таблица была бы ровно тем промежуточным слоем: вторая правда о
  // том же разговоре, которая расходится с первой молча. Колонка в родной
  // таблице — не второй слой, это и есть родное хранилище.
  //
  // 🛑 И ПОЧЕМУ НЕЛЬЗЯ ОБОЙТИСЬ ЗАГОЛОВКОМ. Разобрать «Telegram · @roma_armstrong»
  // и достать оттуда получателя невозможно: Telegram шлёт по ЧИСЛОВОМУ chat_id,
  // а в заголовке стоит имя пользователя — человек его меняет, число нет; имени
  // может не быть вовсе, и тогда там тоже число, неотличимое от имени. Заголовок
  // написан ДЛЯ ЧЕЛОВЕКА: начни машина его разбирать — его нельзя ни
  // переименовать, ни перевести.
  //
  // Пусто у обычного разговора в браузере — это норма, а не пропуск: у него нет
  // канала, он и есть чат.
  channel: varchar("channel"),
  // Адрес собеседника ВНУТРИ канала. Для Telegram — `chat_id`, всегда строкой:
  // число там 64-битное и в JavaScript теряет точность.
  channelChatId: varchar("channelChatId"),
  // Как этого собеседника зовут в канале — для заголовка и подписи в ленте.
  channelWho: varchar("channelWho"),
  // 🛑 КАКИМ БОТОМ ВЕДЁТСЯ РАЗГОВОР — ЭТО АДРЕСАЦИЯ ОТВЕТА, А НЕ УКРАШЕНИЕ.
  // ✗ найдено вопросом владельца о подписи: один человек, написавший ДВУМ
  // ботам, получает от Telegram два разных номера и два разговора. Отправка при
  // этом звала службу без указания бота, и та брала первого — ответ во второй
  // разговор уходил бы через чужого бота, который этого собеседника не знает.
  channelBot: varchar("channelBot"),
  // Имя бота для заголовка: `Telegram · @человек · @бот`. Идентификатор вечен и
  // адресует; имя человек читает и меняет в @BotFather — потому хранятся оба.
  channelBotName: varchar("channelBotName"),
  createdAt: timestamp("createdAt").notNull(),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  title: text("title").notNull(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id),
  visibility: varchar("visibility", { enum: ["public", "private"] })
    .notNull()
    .default("private"),
});

export type Chat = InferSelectModel<typeof chat>;

export const message = pgTable("Message_v2", {
  attachments: json("attachments").notNull(),
  chatId: uuid("chatId")
    .notNull()
    .references(() => chat.id),
  createdAt: timestamp("createdAt").notNull(),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  parts: json("parts").notNull(),
  role: varchar("role").notNull(),
});

export type DBMessage = InferSelectModel<typeof message>;

export const vote = pgTable(
  "Vote_v2",
  {
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id),
    isUpvoted: boolean("isUpvoted").notNull(),
    messageId: uuid("messageId")
      .notNull()
      .references(() => message.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chatId, table.messageId] }),
  })
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  "Document",
  {
    content: text("content"),
    createdAt: timestamp("createdAt").notNull(),
    id: uuid("id").notNull().defaultRandom(),
    kind: varchar("text", { enum: ["text", "code", "image", "sheet"] })
      .notNull()
      .default("text"),
    title: text("title").notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id, table.createdAt] }),
  })
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  "Suggestion",
  {
    createdAt: timestamp("createdAt").notNull(),
    description: text("description"),
    documentCreatedAt: timestamp("documentCreatedAt").notNull(),
    documentId: uuid("documentId").notNull(),
    id: uuid("id").notNull().defaultRandom(),
    isResolved: boolean("isResolved").notNull().default(false),
    originalText: text("originalText").notNull(),
    suggestedText: text("suggestedText").notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
    pk: primaryKey({ columns: [table.id] }),
  })
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const stream = pgTable(
  "Stream",
  {
    chatId: uuid("chatId").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    id: uuid("id").notNull().defaultRandom(),
  },
  (table) => ({
    chatRef: foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
    pk: primaryKey({ columns: [table.id] }),
  })
);

export type Stream = InferSelectModel<typeof stream>;
