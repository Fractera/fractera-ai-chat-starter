#!/bin/bash
#
# install.sh — установка Telegram-автоматизации на сервер (шаг 135, 2026-09-05).
#
# 🔒 УСТАНОВЩИК ЖИВЁТ РЯДОМ С ТЕМ, ЧТО СТАВИТ, И ЭТО ПРЯМОЕ ТРЕБОВАНИЕ ВЛАДЕЛЬЦА:
# один локальный репозиторий — одно зеркало одной папки на сервере, всё один к
# одному. До этого шага установка была размазана по `lib/bootstrap.sh` чужого
# репозитория пятью шагами (`chat_deps`, `chat_build`, `start_chat`,
# `chat_agent_cli` и запись конфигурации), и любая правка порта, процесса или
# запуска агента означала поход в FES.
#
# 🔒 ЧТО ОСТАЛОСЬ В `bootstrap.sh` И ПОЧЕМУ ИМЕННО ЭТО. Там рождается сервер:
# он один знает адрес репозитория, пароль базы и `AUTH_SECRET`. Поэтому там
# остались ровно клон, запись `.env.local` и вызов этого файла. Всё остальное —
# здесь.
#
# 🛑 ЭТОТ ФАЙЛ ИСПОЛНЯЕТСЯ НА БОЕВОЙ МАШИНЕ ПОД ROOT. Он не удаляет ничего вне
# `/opt/fractera/telegrambot` и не трогает соседние службы.
#
# ✗ ОПЛАЧЕНО ШАГОМ 133: процесс `fractera-agent-channel` — сам агент — не
# создавался НИ ОДНИМ установщиком. Два файла умели его перезапустить, а первого
# запуска не было нигде: на чистом сервере бот в Telegram не ответил бы вовсе,
# и выглядело бы это как поломка канала, а не как пропущенный шаг установки.

set -u

HOME_DIR=/opt/fractera/telegrambot
NOTES_DIR=/opt/fractera/agent-notes

cd "$HOME_DIR" || { echo "install: нет $HOME_DIR"; exit 1; }

say() { echo "[telegrambot] $*"; }

# ── зависимости и сборка ─────────────────────────────────────────────────────
#
# 🔒 МИГРАЦИИ БАЗЫ ИДУТ ВНУТРИ `pnpm build` (`tsx lib/db/migrate && next build`),
# отдельного шага посева нет и заводить его не надо.
say "зависимости"
pnpm install --frozen-lockfile || { echo "install: pnpm install упал"; exit 1; }

say "сборка"
pnpm build || { echo "install: сборка упала"; exit 1; }

# ── папка записей агента ─────────────────────────────────────────────────────
#
# 🔒 ОНА ВНЕ `$HOME_DIR` НАМЕРЕННО: `bootstrap.sh` делает `rm -rf` рабочей папки
# при каждой установке. Всё, что агент записал, лежало бы внутри и стиралось бы
# вместе с ней. Здесь — переживает.
say "папка записей агента: $NOTES_DIR"
mkdir -p "$NOTES_DIR"

# ── процесс порта 3600 ───────────────────────────────────────────────────────
#
# 🛑 ПОРТ ЗАДАЁТСЯ ОКРУЖЕНИЕМ ПРОЦЕССА, А НЕ ФАЙЛОМ — оплачено развёртыванием
# 2026-09-03. `PORT=3600` в `.env.local` НЕ действует: свой сервер читает порт из
# окружения, а .env-файл попадает в приложение, а не в процесс. Служба поднималась
# на 3000, натыкалась на гостевой сайт и уходила в вечный рестарт с EADDRINUSE —
# «запущена» и мертва одновременно.
say "процесс fractera-telegrambot (порт 3600)"
pm2 delete fractera-telegrambot > /dev/null 2>&1
PORT=3600 pm2 start pnpm --name fractera-telegrambot -- start || say "ВНИМАНИЕ: порт 3600 не поднялся"

# ── CLI агента ───────────────────────────────────────────────────────────────
#
# 🔒 ЧУЖОЙ ПАКЕТ СТАВИТСЯ ОТДЕЛЬНО. Вкладка терминала приезжает с нашим кодом и
# появится сама; сам `claude` без этой строки не появится ниоткуда, и вкладка
# честно скажет, чего не хватает.
say "CLI агента"
npm install -g @anthropic-ai/claude-code > /dev/null 2>&1
command -v claude > /dev/null 2>&1 || say "ВНИМАНИЕ: claude не установлен — канал не поднимется"

# ── плагин каналов Telegram ──────────────────────────────────────────────────
#
# 🔒 БЕЗ ПЛАГИНА КАНАЛ НЕ СУЩЕСТВУЕТ — И ДО ЭТОГО ШАГА ЕГО НЕ СТАВИЛ НИКТО.
# ✗ Измерено 2026-09-05: `grep` по всему `bootstrap.sh` не находит ни
# `claude-plugins-official`, ни `channels/telegram`, ни `enabledPlugins`. Плагин
# жил на одной машине, поставленный руками; следующий сервер родился бы с тремя
# работающими процессами и молчащим ботом — отказ, неотличимый от поломки.
#
# 🔒 `-y` ОБЯЗАТЕЛЕН, И ЭТО НЕ УДОБСТВО. Установка спрашивает подтверждение, а мы
# исполняемся без терминала: без флага команда встала бы, как встал агент на
# вопросе о доверии часом раньше. Тот же закон, тот же день, третий случай.
#
# 🛑 `fakechat` НЕ СТАВИТСЯ И НЕ ВКЛЮЧАЕТСЯ. Решение владельца 2026-09-05:
# «delete it». Чужой плагин, который никто осознанно не включал; ✗ его отказ
# ломал первый поиск инструментов, и агент топтался в Bash вместо вызова intake.
say "рынок плагинов"
claude plugin marketplace add anthropics/claude-plugins-official > /dev/null 2>&1 \
  && say "+ claude-plugins-official" || say "  рынок уже добавлен"

say "плагин telegram"
claude plugin install telegram@claude-plugins-official -y --scope user > /dev/null 2>&1 \
  && say "+ telegram установлен" || say "  telegram уже установлен"

# 🔒 ВКЛЮЧЕНИЕ ПРОВЕРЯЕТСЯ ОТДЕЛЬНО ОТ УСТАНОВКИ: поставленный и выключенный
# плагин выглядит одинаково в `plugin list`, а канала не даёт.
python3 - <<'PYEOF' || say "ВНИМАНИЕ: enabledPlugins не проставлен"
import json, os
p = "/root/.claude/settings.json"
s = json.load(open(p)) if os.path.exists(p) else {}
ep = s.setdefault("enabledPlugins", {})
ep["telegram@claude-plugins-official"] = True
ep.pop("fakechat@claude-plugins-official", None)
s.setdefault("extraKnownMarketplaces", {}).setdefault(
    "claude-plugins-official",
    {"source": {"source": "github", "repo": "anthropics/claude-plugins-official"}},
)
json.dump(s, open(p, "w"), indent=2, ensure_ascii=False)
print("[telegrambot] + telegram включён, fakechat снят")
PYEOF

# ── чего установщик ДАТЬ НЕ МОЖЕТ, и это говорится вслух ─────────────────────
#
# 🛑 ДВЕ ВЕЩИ ОСТАЮТСЯ ЗА ЧЕЛОВЕКОМ ПО ПРИРОДЕ, А НЕ ПО НЕДОДЕЛКЕ: вход в Claude
# по подписке (это личный аккаунт владельца) и токен бота с allowlist (его
# секрет). Молчащий бот без них неотличим от поломки — поэтому установщик
# обязан назвать их сам, а не оставить человека гадать.
MISSING=""
[ -f /root/.claude/.credentials.json ] || MISSING="${MISSING}вход по подписке (вкладка «Терминал» → режим входа) · "
[ -f /root/.claude/channels/telegram/.env ] || MISSING="${MISSING}токен бота (привязка в Telegram) · "
if [ -n "$MISSING" ]; then
  say "🛑 БОТ ОТВЕЧАТЬ НЕ БУДЕТ, ПОКА НЕ СДЕЛАНО РУКАМИ: ${MISSING%· }"
else
  say "вход и токен на месте"
fi

# ── процесс агента канала ────────────────────────────────────────────────────
#
# 🔒 ЭТО ПЕРВОЕ МЕСТО В ПРОЕКТЕ, ГДЕ ОН ВООБЩЕ ЗАПУСКАЕТСЯ. `agent-reset.sh` и
# `channel-watch.js` его перезапускают — но перезапускать было нечего.
# 🛑 ОПРАШИВАТЕЛЬ TELEGRAM ОБЯЗАН БЫТЬ РОВНО ОДИН: Telegram отдаёт каждое
# обновление одному читателю, второй поделит переписку владельца пополам МОЛЧА.
# Отсюда `pm2 delete` перед стартом, а не `pm2 restart` «на всякий случай».
# 🛑 ДОВЕРИЕ ПАПКЕ СТАВИТСЯ ДО СТАРТА, ИНАЧЕ АГЕНТ ВСТАЁТ НА МОДАЛЬНОМ ВОПРОСЕ.
# ✗ ОПЛАЧЕНО ЖИВЬЁМ 2026-09-05 ПРИ ПЕРВОМ ЖЕ ЗАПУСКЕ ЭТОГО ФАЙЛА: Claude Code
# спросил «Is this a project you trust? This folder pre-approves 4 tool
# permissions in .claude/settings.json» — и остался ждать нажатия. `pm2 list`
# показывал `online`, экран висел на вопросе, опрашиватель Telegram = 0, бот
# молчал. Нажать было некому: терминала у процесса под pm2 нет.
# 🔒 ЗАКОН ПРОЕКТА ПОДТВЕРЖДЁН ЧЕТВЁРТЫЙ РАЗ ЗА СУТКИ: КАЖДАЯ НОВАЯ СПОСОБНОСТЬ
# АГЕНТА ПРИНОСИТ СВОЙ МОДАЛЬНЫЙ ВОПРОС, и закрывать его надо настройкой в той же
# правке. Здесь способность — собственный `.claude/settings.json`: именно он и
# вызвал вопрос, которого у пустой рабочей папки не было.
say "доверие рабочей папке"
python3 - <<'PYEOF' || say "ВНИМАНИЕ: доверие не проставлено — агент встанет на вопросе"
import json, os
p = "/root/.claude.json"
c = json.load(open(p)) if os.path.exists(p) else {}
c.setdefault("projects", {}).setdefault("/opt/fractera/telegrambot", {})["hasTrustDialogAccepted"] = True
json.dump(c, open(p, "w"), indent=2, ensure_ascii=False)
print("[telegrambot] + hasTrustDialogAccepted")
PYEOF

say "процесс fractera-agent-channel"
chmod +x scripts/agent/*.sh scripts/install.sh 2>/dev/null
pm2 delete fractera-agent-channel > /dev/null 2>&1
pm2 start "$HOME_DIR/scripts/agent/claude-channel.sh" --name fractera-agent-channel \
  || say "ВНИМАНИЕ: канал агента не запустился"

# ── сторож лимита подписки ───────────────────────────────────────────────────
say "процесс fractera-limit-watch"
pm2 delete fractera-limit-watch > /dev/null 2>&1
pm2 start "$HOME_DIR/scripts/channel-watch.js" --name fractera-limit-watch \
  || say "ВНИМАНИЕ: сторож канала не запустился"

pm2 save > /dev/null 2>&1

# ── что получилось ───────────────────────────────────────────────────────────
#
# 🔒 УСТАНОВЩИК ОТЧИТЫВАЕТСЯ ИЗМЕРЕНИЕМ, А НЕ ФАКТОМ ЗАПУСКА. `pm2 start` без
# ошибки и «процесс отвечает» — разные утверждения; читающий журнал установки
# имеет право знать, какое из них здесь произнесено.
say "--- итог ---"
pm2 list 2>/dev/null | grep -E "fractera-(telegrambot|agent-channel|limit-watch)" || say "процессов не видно"
for i in $(seq 1 15); do
  curl -sf -o /dev/null "http://127.0.0.1:3600/terminal" && { say "порт 3600 отвечает"; break; }
  [ "$i" = 15 ] && say "ВНИМАНИЕ: порт 3600 не ответил за 30 с"
  sleep 2
done
say "готово"
