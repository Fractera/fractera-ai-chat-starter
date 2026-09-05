#!/bin/bash
# Сброс контекста агента и смена модели (шаг 121).
#
# 🔒 СБРОС КОНТЕКСТА = НОВАЯ СЕССИЯ. У полноэкранного агента нет способа очистить
# собственный контекст изнутри: `/clear` — команда ввода терминала, а сообщения из
# Telegram приходят готовой репликой, а не нажатиями клавиш. Поэтому сброс — это
# перезапуск канала, и он же единственный момент, когда можно сменить модель.
#
# 🔒 ПЕРЕЗАПУСК ОТВЯЗЫВАЕТСЯ ОТ СВОЕГО РОДИТЕЛЯ. Скрипт вызывает сам агент; не
# отвяжись перезапуск — pm2 убил бы процесс, который его и просил, на середине.
#
# Использование:  agent-reset.sh [<модель>]
#   без аргумента — сброс на текущей модели
#   с аргументом  — записать модель и перезапуститься на ней
set -u
export PATH=/usr/local/bin:/usr/bin:/bin
MODEL_FILE=/opt/fractera/agent-model
NOTE="♻️ Контекст сброшен — начинаю новую сессию."

if [ $# -ge 1 ] && [ -n "$1" ]; then
  printf '%s' "$1" > "$MODEL_FILE"
  NOTE="♻️ Контекст сброшен, модель переключена на $1 — начинаю новую сессию."
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
echo "Перезапуск канала назначен. Новая сессия поднимется через несколько секунд."
