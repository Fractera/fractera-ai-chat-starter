// Прибор шага 114-2 — извлечение ссылки входа из вывода PTY.
//
// ЗАЧЕМ ОН ЕСТЬ. Унаследованная от шага 500 регулярка распознавания ссылки
// (`auth-flow-descriptors.ts` на ревизии `e1e7ff0^`) по домену совпала с живым
// CLI 2.1.260, а по ГРАНИЦЕ КОНЦА — нет. Это худший вид расхождения: модалка
// открылась бы, но с испорченной ссылкой, и человек получил бы «ссылка не
// работает» вместо «модалка не появилась».
//
// Запуск: node development-docs/instruments/114-2-auth-url-extraction.mjs
// Код выхода 0 = все девять случаев прошли.
//
// Образец ссылки снят ЖИВЬЁМ на сервере 2026-09-04:
//   timeout 25 script -qec "claude auth login" /dev/null
// state здесь — из той настоящей выдачи, он одноразовый и давно недействителен.

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g");
const CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");

const url =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code+user%3Amcp_servers+user%3Afile_upload&code_challenge=BG1wjx0lu-vCirt2QnOFxOb94_cmXrO0AhjET15_EJc&code_challenge_method=S256&state=dwr1kEo8rMR95bfk2g2t0h1nEtT5pZXwTFZAVFuOCYs";

export const DETECT =
  /https:\/\/claude\.com\/cai\/oauth\/authorize.*?&state=[A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9]/;

// Дверь 1 — OSC-8. CLI печатает ссылку гиперссылкой, и escape ограничивает её
// С ОБЕИХ СТОРОН: гадать, где она кончается, не нужно вовсе.
const OSC8 = new RegExp(
  `${ESC}\\]8;;(https://[^${BEL}${ESC}]*)(?:${BEL}|${ESC}\\\\)`
);

export function extractAuthUrl(buf) {
  const byLink = buf.match(OSC8);
  if (byLink && DETECT.test(byLink[1])) {
    return { how: "OSC-8", url: byLink[1] };
  }

  // Дверь 2 — видимый текст, если OSC порвался на границе чанков.
  // Переводы строк удаляются БЕЗ подстановки пробела: заворот PTY склеивается
  // обратно, а настоящий пробел остаётся границей слова. Прежний код ставил
  // на месте перевода пробел и потом удалял ВСЕ пробелы — из-за этого проза
  // после ссылки прилипала к state.
  const visible = buf
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(/\r\n|\r|\n/g, "");
  const m = visible.match(DETECT);
  if (!m) {
    return null;
  }

  // Хвост совпадения обрезается по СОСЕДУ В БУФЕРЕ, а не по содержимому
  // совпадения: класс [A-Za-z0-9_-] после state= съедает и «https» второй
  // копии, и «Pastecode» следующей строки — искать дубль ВНУТРИ совпадения
  // уже поздно. Прежний сторож `u.indexOf("https://", 8)` именно поэтому
  // не срабатывал.
  const start = m.index;
  let end = start + m[0].length;
  const second = visible.indexOf("https://", start + 8);
  if (second !== -1 && second < end) {
    end = second;
  }
  return { how: "текст", url: visible.slice(start, end) };
}

// ─── прогон ──────────────────────────────────────────────────────────────────

function check(name, input, expect) {
  const r = extractAuthUrl(input);
  const got = r ? r.url : null;
  const ok = expect === null ? got === null : got === expect;
  console.log(
    (ok ? "  ok  " : "  ✗   ") +
      name +
      (r ? ` [${r.how}]` : "") +
      (ok
        ? ""
        : "\n        получено: " +
          (got === null ? "нет совпадения" : got.slice(-55)))
  );
  return ok;
}

const live =
  "If the browser didn't open, visit: " +
  ESC +
  "]8;;" +
  url +
  ESC +
  "\\" +
  url +
  ESC +
  "]8;;" +
  ESC +
  "\\\r\nPaste code here if prompted > ";

let all = true;
console.log("ПОЗИТИВНЫЕ:");
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

console.log("НЕГАТИВНЫЕ:");
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

console.log(all ? "\nИТОГ: все девять прошли" : "\nИТОГ: ЕСТЬ ПРОВАЛЫ");
process.exit(all ? 0 : 1);
