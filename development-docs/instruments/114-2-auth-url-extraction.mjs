// Прибор шага 114-2 — извлечение ссылки входа из вывода PTY.
//
// 🔒 ПРИБОР ИМПОРТИРУЕТ БОЕВОЙ КОД, А НЕ ДЕРЖИТ СВОЮ КОПИЮ (переведён на это в
// 114-4). Реализация живёт в `lib/fractera/terminal-auth.mjs`, и оттуда же её
// читает островок терминала. Прибор со своей копией сторожил бы её, а работала
// бы другая — ровно тот класс расхождения, ради которого шаг и завёлся.
//
// ЗАЧЕМ ОН ЕСТЬ. Унаследованная от шага 500 регулярка (`auth-flow-descriptors.ts`
// на ревизии `e1e7ff0^`) по домену совпала с живым CLI 2.1.260, а по ГРАНИЦЕ
// КОНЦА — нет. Модалка открылась бы, но с испорченной ссылкой: человек получил
// бы «ссылка не работает» вместо «модалка не появилась».
//
// Запуск: node development-docs/instruments/114-2-auth-url-extraction.mjs
// Код выхода 0 = все девять случаев прошли.
//
// Образец ссылки снят ЖИВЬЁМ на сервере 2026-09-04:
//   timeout 25 script -qec "claude auth login" /dev/null
// `state` здесь из той настоящей выдачи — он одноразовый и давно недействителен.

import { extractAuthUrl } from "../../lib/fractera/terminal-auth.mjs";

const ESC = String.fromCharCode(27);

const url =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code+user%3Amcp_servers+user%3Afile_upload&code_challenge=BG1wjx0lu-vCirt2QnOFxOb94_cmXrO0AhjET15_EJc&code_challenge_method=S256&state=dwr1kEo8rMR95bfk2g2t0h1nEtT5pZXwTFZAVFuOCYs";

function check(name, input, expect) {
  const r = extractAuthUrl(input);
  const got = r ? r.url : null;
  const ok = expect === null ? got === null : got === expect;
  const how = r ? ` [${r.how}]` : "";
  const detail = ok
    ? ""
    : `\n        получено: ${got === null ? "нет совпадения" : got.slice(-55)}`;
  process.stdout.write(`${ok ? "  ok  " : "  ✗   "}${name}${how}${detail}\n`);
  return ok;
}

const live = `If the browser didn't open, visit: ${ESC}]8;;${url}${ESC}\\${url}${ESC}]8;;${ESC}\\\r\nPaste code here if prompted > `;

let all = true;
process.stdout.write("ПОЗИТИВНЫЕ:\n");
all = check("живой вывод CLI, как замерен на сервере", live, url) && all;
all =
  check(
    "порванный escape: OSC не собрался, ссылка удвоена",
    `]8;;${url}${url}]8;;\r\nPaste code here if prompted > `,
    url
  ) && all;
all =
  check(
    "перенос строки посреди ссылки (заворот PTY)",
    `${url.slice(0, 120)}\r\n${url.slice(120)} Paste code`,
    url
  ) && all;
all =
  check(
    "ссылка вплотную к прозе, без OSC вовсе",
    `visit: ${url} Paste code here if prompted > `,
    url
  ) && all;
all = check("ссылка в самом конце буфера", `visit: ${url}`, url) && all;

process.stdout.write("НЕГАТИВНЫЕ:\n");
all =
  check("страница доков", "смотрите https://claude.com/docs и всё", null) &&
  all;
all =
  check(
    "без state",
    "https://claude.com/cai/oauth/authorize?code=true&client_id=abc",
    null
  ) && all;
all =
  check(
    "чужой хост",
    "https://evil.com/cai/oauth/authorize?a=1&state=zzz",
    null
  ) && all;
all =
  check(
    "OSC-8 с посторонней ссылкой",
    `${ESC}]8;;https://example.com/x${ESC}\\`,
    null
  ) && all;

process.stdout.write(
  all ? "\nИТОГ: все девять прошли\n" : "\nИТОГ: ЕСТЬ ПРОВАЛЫ\n"
);
process.exit(all ? 0 : 1);
