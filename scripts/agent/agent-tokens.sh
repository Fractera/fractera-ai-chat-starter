#!/bin/bash
# Расход токенов текущей сессии агента (шаг 121).
#
# 🔒 ЧИТАЕТ ЖУРНАЛ СЕССИИ, КОТОРЫЙ CLAUDE CODE ВЕДЁТ САМ, а не считает сам.
# Второй счётчик рядом с настоящим разошёлся бы с ним молча.
set -u
D=/root/.claude/projects/-opt-fractera-agent-workspace
F=$(ls -t "$D"/*.jsonl 2>/dev/null | head -1)
[ -n "${F:-}" ] || { echo "Журнала сессии ещё нет — агент не отвечал ни разу."; exit 0; }
python3 - "$F" <<'PY'
import sys, json, os, datetime
f = sys.argv[1]
tot = {}; turns = 0; first = None; last = None; model = None
for ln in open(f, encoding="utf-8", errors="replace"):
    try: r = json.loads(ln)
    except Exception: continue
    ts = r.get("timestamp")
    if ts:
        first = first or ts
        last = ts
    m = r.get("message") or {}
    if m.get("model"): model = m["model"]
    u = m.get("usage")
    if not isinstance(u, dict): continue
    turns += 1
    for k, v in u.items():
        if isinstance(v, int): tot[k] = tot.get(k, 0) + v

def h(n): return f"{n:,}".replace(",", " ")
inp   = tot.get("input_tokens", 0)
out   = tot.get("output_tokens", 0)
cw    = tot.get("cache_creation_input_tokens", 0)
cr    = tot.get("cache_read_input_tokens", 0)

print("Расход токенов в этой сессии")
print(f"  сессия:   {os.path.basename(f)[:8]}  ·  ответов: {turns}")
if model: print(f"  модель:   {model}")
if first: print(f"  начата:   {first[11:16]} UTC")
print(f"  ввод:            {h(inp)}")
print(f"  вывод:           {h(out)}")
print(f"  запись в кэш:    {h(cw)}")
print(f"  чтение из кэша:  {h(cr)}")
print(f"  ВСЕГО:           {h(inp+out+cw+cr)}")
print()
print("Чтение из кэша дешевле обычного ввода — поэтому большая цифра рядом с ним")
print("не значит большого расхода. Счёт по подписке лимитом, а не деньгами.")
PY
