// Прибор шага 114-3 — замок терминала, проверенный ОТКАЗОМ, а не только успехом.
//
// ЗАЧЕМ ОН ЕСТЬ. Мост терминала до шага 500 принимал любое соединение: ни токена,
// ни куки, ни проверки origin. Замок, добавленный вместо этого, обязан быть
// измерен — и измерен прежде всего своими отказами: замок, который не показали
// закрытым, не проверен.
//
// Запуск (из корня репозитория):  node development-docs/instruments/114-3-pty-lock.mjs
// Код выхода 0 = все случаи прошли.
//
// ЧТО ОН ПОДНИМАЕТ. Заглушку службы входа `:3001` (её контракт — `{userId, email,
// roles}`, см. `lib/fractera/session.ts`) и НАСТОЯЩИЙ `server.mjs` в режиме
// разработки на свободном порту. Проверяется тот код, который поедет на сервер,
// а не его пересказ.
//
// 🛑 ЧЕГО ОН НЕ ПРОВЕРЯЕТ: боевую сборку и `node-pty` на linux. Готовых сборок у
// node-pty под linux нет, он компилируется скриптом установки — это меряется на
// самом сервере, и прибор об этом молчит намеренно, а не по недосмотру.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { WebSocket } from "ws";

const AUTH_PORT = 3611;
const CHAT_PORT = 3610;
const BOOT_TIMEOUT_MS = 180_000;

let roles = ["architect"];
const results = [];

function check(name, ok, detail) {
  results.push({ detail, name, ok });
  process.stdout.write(
    `${ok ? "  ok  " : "  ✗   "}${name}${ok ? "" : `\n        ${detail}`}\n`
  );
}

// ── заглушка службы входа ────────────────────────────────────────────────────
const auth = createServer((req, res) => {
  if (req.url?.startsWith("/api/session")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ email: "prover@local", roles, userId: "prover" }));
    return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => auth.listen(AUTH_PORT, "127.0.0.1", r));

// ── настоящий сервер чата ────────────────────────────────────────────────────
const chat = spawn(process.execPath, ["server.mjs"], {
  env: {
    ...process.env,
    AUTH_SERVICE_URL: `http://127.0.0.1:${AUTH_PORT}`,
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "development",
    PORT: String(CHAT_PORT),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let chatLog = "";
chat.stdout.on("data", (d) => {
  chatLog += d.toString();
});
chat.stderr.on("data", (d) => {
  chatLog += d.toString();
});

function stop(code) {
  try {
    chat.kill();
  } catch {
    /* уже мёртв */
  }
  auth.close();
  process.exit(code);
}

async function waitForChat() {
  const until = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < until) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: опрос последователен по своей природе — сервер поднимается один раз, параллельные попытки грели бы процессор и только
      const r = await fetch(
        `http://127.0.0.1:${CHAT_PORT}/api/fractera/pty-ticket`,
        {
          method: "POST",
        }
      );
      if (r.status !== 0) {
        return true;
      }
    } catch {
      /* ещё не поднялся */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/** Открыть сокет, послать `init`, вернуть чем кончилось. */
function tryTerminal({ mode = "system", probe = "", ticket }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${CHAT_PORT}/pty`);
    let out = "";
    const done = (verdict) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* уже закрыт */
      }
      resolve(verdict);
    };
    const timer = setTimeout(() => done({ how: "timeout", out }), 20_000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ mode, ticket, type: "init" }));
      if (probe) {
        setTimeout(
          () => ws.send(JSON.stringify({ data: probe, type: "stdin" })),
          1500
        );
      }
    });
    ws.on("message", (d) => {
      out += d.toString();
      if (probe && out.includes("PTY-ALIVE-9F3")) {
        done({ how: "shell", out });
      }
    });
    ws.on("close", (code, reason) =>
      done({ code, how: "close", out, reason: reason.toString() })
    );
    ws.on("error", () => done({ how: "error", out }));
  });
}

async function ticketFor() {
  const r = await fetch(
    `http://127.0.0.1:${CHAT_PORT}/api/fractera/pty-ticket`,
    {
      method: "POST",
    }
  );
  const body = await r.json().catch(() => ({}));
  return { body, status: r.status };
}

// ── прогон ───────────────────────────────────────────────────────────────────

process.stdout.write(
  "поднимаю настоящий server.mjs (первая сборка Next — долго)…\n"
);
if (!(await waitForChat())) {
  process.stdout.write(
    `НЕ ПОДНЯЛСЯ за ${BOOT_TIMEOUT_MS / 1000} c\n${chatLog.slice(-3000)}\n`
  );
  stop(1);
}

process.stdout.write("\nДВЕРЬ БИЛЕТА:\n");

roles = [];
const noRole = await ticketFor();
check(
  "без роли архитектора дверь отвечает 403",
  noRole.status === 403,
  `получено ${noRole.status}`
);

roles = ["architect"];
const minted = await ticketFor();
check(
  "архитектор получает билет",
  minted.status === 200 &&
    typeof minted.body.ticket === "string" &&
    minted.body.ticket.length > 20,
  `статус ${minted.status}, тело ${JSON.stringify(minted.body).slice(0, 120)}`
);

process.stdout.write("\nЗАМОК МОСТА — НЕГАТИВНЫЕ КОНТРОЛИ:\n");

const noTicket = await tryTerminal({ ticket: undefined });
check(
  "без билета соединение закрывается 1008",
  noTicket.how === "close" && noTicket.code === 1008,
  `${noTicket.how} code=${noTicket.code} reason=${noTicket.reason}`
);

const fakeTicket = await tryTerminal({ ticket: "A".repeat(43) });
check(
  "с выдуманным билетом — 1008",
  fakeTicket.how === "close" && fakeTicket.code === 1008,
  `${fakeTicket.how} code=${fakeTicket.code} reason=${fakeTicket.reason}`
);

process.stdout.write("\nЗАМОК МОСТА — ПОЛОЖИТЕЛЬНЫЙ СЛУЧАЙ:\n");

const good = minted.body.ticket;
const live = await tryTerminal({ probe: "echo PTY-ALIVE-9F3\n", ticket: good });
check(
  "с настоящим билетом поднимается оболочка и исполняет команду",
  live.how === "shell",
  `${live.how}; вывод: ${JSON.stringify(live.out.slice(-200))}`
);

process.stdout.write("\nОДНОРАЗОВОСТЬ:\n");

const reused = await tryTerminal({ ticket: good });
check(
  "тот же билет второй раз — 1008",
  reused.how === "close" && reused.code === 1008,
  `${reused.how} code=${reused.code} reason=${reused.reason}`
);

const failed = results.filter((r) => !r.ok);
process.stdout.write(
  failed.length === 0
    ? `\nИТОГ: все ${results.length} прошли\n`
    : `\nИТОГ: ПРОВАЛОВ ${failed.length} из ${results.length}\nжурнал сервера:\n${chatLog.slice(-2000)}\n`
);
stop(failed.length === 0 ? 0 : 1);
