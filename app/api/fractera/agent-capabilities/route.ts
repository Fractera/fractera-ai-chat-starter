// @api list skills and MCP servers wired to the Claude agent
import { NextResponse } from "next/server";
import {
  listAgentSkills,
  listMcpServers,
  mcpRegistryPath,
  skillsDir,
} from "@/lib/fractera/agent-capabilities";
import { agentWorkspace, anthropicKey } from "@/lib/fractera/claude-agent";
import { fracteraRoles } from "@/lib/fractera/session";

// ЧТО ПОДКЛЮЧЕНО К АГЕНТУ — ДВЕРЬ ДЛЯ ЭКРАНА АРХИТЕКТОРА (113-4, 2026-09-04).
//
// 🔒 СПРАШИВАЕТСЯ ТА СЛУЖБА, ЧЬЁ ПОВЕДЕНИЕ ПРОВЕРЯЕТСЯ. Навыки и MCP читает
// агент, а он живёт здесь, на `:3600`. Экран архитектора мог бы прочитать те же
// папки сам — и это был бы посредник вместо предмета: он увидел бы диск, а не то,
// что видит SDK. ✗ этот класс ошибки в проекте оплачен трижды за сутки.
//
// 🛑 ЗНАЧЕНИЕ КЛЮЧА НАРУЖУ НЕ ВЫХОДИТ. Наружу едет только признак «задан»: экран
// обязан отличать «агент готов» от «агенту нечем платить», и для этого хватает
// булева.
export async function GET() {
  const roles = await fracteraRoles();
  if (!roles.includes("architect")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    keyConfigured: Boolean(anthropicKey()),
    mcpRegistry: mcpRegistryPath(),
    mcpServers: listMcpServers(),
    skills: listAgentSkills(),
    skillsDir: skillsDir(),
    workspace: agentWorkspace(),
  });
}
