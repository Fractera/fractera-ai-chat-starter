#!/bin/bash
# Сброс контекста агента и смена модели (шаг 121; двуязычие — 130).
#
# 🔒 СБРОС КОНТЕКСТА = НОВАЯ СЕССИЯ. У полноэкранного агента нет способа очистить
# собственный контекст изнутри: `/clear` — команда ввода терминала, а сообщения из
# Telegram приходят готовой репликой, а не нажатиями клавиш. Поэтому сброс — это
# перезапуск канала, и он же единственный момент, когда можно сменить модель.
#
# 🔒 ПЕРЕЗАПУСК ОТВЯЗЫВАЕТСЯ ОТ СВОЕГО РОДИТЕЛЯ. Скрипт вызывает сам агент; не
# отвяжись перезапуск — pm2 убил бы процесс, который его и просил, на середине.
#
# 🔒 ТЕКСТ ГОТОВЫЙ, А НЕ ПОРОЖДЁННЫЙ, И ЯЗЫК БЕРЁТСЯ ИЗ ФАЙЛА. Сообщение уходит в
# тот момент, когда сессия вот-вот перестанет существовать: попросить кого-то
# сочинить его уже не у кого. Умолчание — русский; `en` в `/opt/fractera/agent-lang`
# переключает. Тот же словарь и то же умолчание, что у сторожа канала.
#
# Использование:  agent-reset.sh [<модель>]
#   без аргумента — сброс на текущей модели
#   с аргументом  — записать модель и перезапуститься на ней
set -u
export PATH=/usr/local/bin:/usr/bin:/bin
MODEL_FILE=/opt/fractera/agent-model
LANG_FILE=/opt/fractera/agent-lang

LANG_CODE=ru
if [ -s "$LANG_FILE" ]; then
  V=$(tr -d '[:space:]' < "$LANG_FILE" | tr '[:upper:]' '[:lower:]')
  case "$V" in ru|en) LANG_CODE="$V" ;; esac
fi

if [ $# -ge 1 ] && [ -n "$1" ]; then
  printf '%s' "$1" > "$MODEL_FILE"
  if [ "$LANG_CODE" = "en" ]; then
    NOTE="♻️ Context cleared, model switched to $1 — starting a fresh session."
  else
    NOTE="♻️ Контекст сброшен, модель переключена на $1 — начинаю новую сессию."
  fi
else
  if [ "$LANG_CODE" = "en" ]; then
    NOTE="♻️ Context cleared — starting a fresh session."
  else
    NOTE="♻️ Контекст сброшен — начинаю новую сессию."
  fi
fi

# 🔒 ПРЕДУПРЕДИТЬ ДО, А НЕ ПОСЛЕ: после перезапуска сказать будет некому — сессия,
# которая это делает, перестанет существовать.
T=$(grep -o 'TELEGRAM_BOT_TOKEN=.*' /root/.claude/channels/telegram/.env 2>/dev/null | cut -d= -f2- | tr -d '\r\n')
if [ -n "${T:-}" ]; then
  for ID in $(python3 -c "import json;print(' '.join(map(str,json.load(open('/root/.claude/channels/telegram/access.json')).get('allowFrom',[]))))" 2>/dev/null); do
    curl -s -m 10 -X POST "https://api.telegram.org/bot$T/sendMessage" \
      -H 'content-type: application/json' \
      -d "{\"chat_id\":\"$ID\",\"text\":\"$NOTE\"}" > /dev/null
  done
fi

setsid nohup bash -c 'sleep 2; pm2 restart fractera-agent-channel' > /dev/null 2>&1 < /dev/null &
if [ "$LANG_CODE" = "en" ]; then
  echo "Channel restart scheduled. The new session comes up in a few seconds."
else
  echo "Перезапуск канала назначен. Новая сессия поднимется через несколько секунд."
fi
