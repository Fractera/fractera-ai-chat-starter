-- Канал разговора живёт в РОДНОЙ таблице, а не в слое рядом (97-4, 2026-09-03).
--
-- 🔒 Закон владельца: единственный источник данных о сообщениях — хранилище
-- чата; отдельных промежуточных слоёв из-за Telegram не заводим. Таблица
-- соответствий «канал → разговор» была бы таким слоем.
--
-- 🛑 `IF NOT EXISTS` НЕ УКРАШЕНИЕ: миграции исполняются на каждой сборке, и
-- сервер, где колонка уже есть, обязан пройти их молча, а не упасть.
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "channel" varchar;
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "channelChatId" varchar;
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "channelWho" varchar;

-- Поиск разговора по адресу собеседника — то, что делает КАЖДОЕ входящее
-- сообщение. Без указателя это перебор всех разговоров сервера.
CREATE INDEX IF NOT EXISTS "Chat_channel_idx" ON "Chat" ("channel", "channelChatId");
