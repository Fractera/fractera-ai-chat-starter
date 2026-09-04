import "server-only";

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { agentWorkspace } from "@/lib/fractera/claude-agent";

// ЧТО ПОДКЛЮЧЕНО К АГЕНТУ — НАВЫКИ И MCP (113-4, 2026-09-04).
//
// 🔒 СПИСОК ПОРОЖДАЕТСЯ ИЗ ПАПКИ, А НЕ ПЕРЕЧИСЛЯЕТСЯ. Тот же закон, что у
// каталога инструментов и каталога блоков проекта: список, написанный руками,
// расходится с диском МОЛЧА, и разбудить некому. В этом корпусе он оплачен
// пять раз за четыре дня — числом инструментов, числом навыков, числом разделов.
//
// 🔒 АДРЕС НАВЫКОВ НЕ НАШ ВЫБОР, А ТРЕБОВАНИЕ SDK. Дословно из документации:
// skills, commands и memory «Load automatically from your project's `.claude/`
// and from `~/.claude/`, same as Claude Code». Значит папка ровно одна —
// `<рабочая папка>/.claude/skills`, — и придумывать свою нельзя: положенное в
// другое место просто не будет прочитано, без единого сообщения.
//
// 🛑 СЕГОДНЯ ПУСТО, И ЭТО ЧЕСТНОЕ СОСТОЯНИЕ, А НЕ ОТКАЗ. Владелец назвал целью
// навыки и MCP, дающие доступ к таблицам, базам и графу знаний; ни одного из них
// ещё не написано. Пустой список, который ГОВОРИТ, что он пуст, отличается от
// поломки — а молчащий не отличается (закон 28-13).

export type AgentSkill = { name: string; title: string | null };

/** Папка, куда SDK смотрит за навыками. Другой быть не может. */
export function skillsDir(): string {
  return join(agentWorkspace(), ".claude", "skills");
}

/**
 * Навыки, лежащие в рабочей папке агента.
 *
 * 🔒 ЗАГОЛОВОК БЕРЁТСЯ ИЗ САМОГО `SKILL.md`, А НЕ ИЗ ИМЕНИ ПАПКИ: имя папки —
 * это адрес, а не название, и показывать адрес вместо названия значит требовать
 * от человека читать код, чтобы понять, что подключено.
 */
export function listAgentSkills(): AgentSkill[] {
  const dir = skillsDir();
  if (!existsSync(dir)) {
    return [];
  }
  try {
    return readdirSync(dir)
      .filter((name) => {
        try {
          return statSync(join(dir, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .map((name) => ({ name, title: skillTitle(join(dir, name)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    // Папка есть, а прочитать нельзя — права или гонка с записью. Пустой список
    // честнее исключения: экран обязан отрисоваться.
    return [];
  }
}

function skillTitle(dir: string): string | null {
  try {
    const raw = readFileSync(join(dir, "SKILL.md"), "utf8");
    return (raw.match(/^name:\s*(.+)$/m) ?? [])[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export type McpServer = { name: string };

/**
 * MCP-серверы, объявленные для агента.
 *
 * 🔒 РЕЕСТР — ФАЙЛ РЯДОМ С РАБОЧЕЙ ПАПКОЙ, А НЕ КОНСТАНТА В КОДЕ. Подключить
 * сервер обязано быть возможно без пересборки чата: иначе каждый новый источник
 * данных станет развёртыванием, и владелец останется с этим наедине.
 * 🛑 СЕГОДНЯ ФАЙЛА НЕТ, И ЭТО НЕ ОТКАЗ: пустой реестр значит «ни одного не
 * подключали». Сами серверы — следующий шаг, и без них замысел владельца про
 * доступ к таблицам и графу выполнен наполовину.
 */
export function mcpRegistryPath(): string {
  return join(agentWorkspace(), "mcp-servers.json");
}

export function listMcpServers(): McpServer[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(mcpRegistryPath(), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return [];
    }
    const servers = (parsed as { mcpServers?: unknown }).mcpServers;
    if (typeof servers !== "object" || servers === null) {
      return [];
    }
    return Object.keys(servers as Record<string, unknown>)
      .sort()
      .map((name) => ({ name }));
  } catch {
    return [];
  }
}
