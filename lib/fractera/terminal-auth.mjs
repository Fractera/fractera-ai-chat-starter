// ИЗВЛЕЧЕНИЕ ССЫЛКИ ВХОДА ИЗ ВЫВОДА ТЕРМИНАЛА (шаг 114-4).
//
// 🔒 ФУНКЦИЯ ПЕРЕЕХАЛА СЮДА ИЗ ПРИБОРА 114-2, А НЕ НАПИСАНА ЗАНОВО, и это
// требование учёта, а не удобство: прибор с девятью случаями сторожил бы свою
// копию, а работала бы другая. Теперь прибор импортирует ЭТОТ файл.
//
// 🔒 `.mjs`, А НЕ `.ts`, ПО ТОЙ ЖЕ ПРИЧИНЕ, ЧТО У `pty-ticket.mjs`: файл читают
// две половины — клиентский островок внутри сборки Next и прибор, запускаемый
// голым `node`. TypeScript второй не исполняет.
//
// ── ЧТО ИМЕННО ПЕЧАТАЕТ CLI, ЗАМЕРЕНО НА СЕРВЕРЕ 2026-09-04 ─────────────────
//   timeout 25 script -qec "claude auth login" /dev/null
//
//   Opening browser to sign in…
//   If the browser didn't open, visit: <OSC-8>https://claude.com/cai/oauth/…&state=…
//   Paste code here if prompted >
//
// ✗ УНАСЛЕДОВАННЫЙ КОД СОВПАДАЛ ПО ДОМЕНУ И РАСХОДИЛСЯ ПО ГРАНИЦЕ КОНЦА.
// Класс `[A-Za-z0-9_-]*` после `state=` не останавливается на конце ссылки:
// прежний вариант менял перевод строки на ПРОБЕЛ и потом удалял ВСЕ пробелы,
// и к значению `state` прилипало `Pastecodehereifprompted`. Тот же класс съедал
// `https` второй копии ссылки, из-за чего сторож дубля `indexOf("https://", 8)`
// не находил ничего.
//
// 🛑 ЭТО ХУДШИЙ ВИД РАСХОЖДЕНИЯ: модалка ОТКРЫЛАСЬ БЫ, но с испорченной
// ссылкой. Человек получил бы «ссылка не работает» вместо «модалка не
// появилась» — то есть отказ, указывающий не туда.

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

const OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g");
const CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");

/** Ссылка входа Claude Code. Замерена на CLI 2.1.260. */
export const CLAUDE_LOGIN_URL =
  /https:\/\/claude\.com\/cai\/oauth\/authorize.*?&state=[A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9]/;

// Дверь 1 — OSC-8. CLI печатает ссылку гиперссылкой, и escape ограничивает её
// С ОБЕИХ СТОРОН: гадать, где она кончается, не нужно вовсе.
const OSC8 = new RegExp(
  `${ESC}\\]8;;(https://[^${BEL}${ESC}]*)(?:${BEL}|${ESC}\\\\)`
);

/** Убрать управляющие последовательности, оставив видимый текст. */
export function stripAnsi(s) {
  return s.replace(OSC, "").replace(CSI, "");
}

/**
 * Найти ссылку входа в сыром буфере PTY.
 *
 * @param {string} buf сырьё как пришло из сокета, БЕЗ предварительной чистки —
 *   иначе первая дверь останется без своего escape.
 * @param {RegExp} [detect] чем опознаём ссылку.
 * @returns {{ url: string, how: "OSC-8" | "текст" } | null}
 */
export function extractAuthUrl(buf, detect = CLAUDE_LOGIN_URL) {
  const byLink = buf.match(OSC8);
  if (byLink && detect.test(byLink[1])) {
    return { how: "OSC-8", url: byLink[1] };
  }

  // Дверь 2 — видимый текст, если OSC порвался на границе чанков.
  // Переводы строк удаляются БЕЗ подстановки пробела: заворот PTY склеивается
  // обратно, а настоящий пробел остаётся границей слова.
  const visible = stripAnsi(buf).replace(/\r\n|\r|\n/g, "");
  const m = visible.match(detect);
  if (!m) {
    return null;
  }

  // Хвост совпадения обрезается по СОСЕДУ В БУФЕРЕ, а не по содержимому
  // совпадения: искать дубль ВНУТРИ совпадения уже поздно — он туда съеден.
  const start = m.index;
  let end = start + m[0].length;
  const second = visible.indexOf("https://", start + 8);
  if (second !== -1 && second < end) {
    end = second;
  }
  return { how: "текст", url: visible.slice(start, end) };
}
