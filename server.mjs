import { existsSync } from "node:fs";
import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { claudeAuthState, claudeBin } from "./lib/fractera/claude-cli.mjs";
import { redeemPtyTicket } from "./lib/fractera/pty-ticket.mjs";

// СВОЙ СЕРВЕР ЧАТА — NEXT ПЛЮС МОСТ ТЕРМИНАЛА НА ТОМ ЖЕ ПОРТУ (шаг 114-3).
//
// 🔒 РАСШИРЕНИЕ `.mjs`, А НЕ `.js`, И ЭТО НЕ ВКУС: у пакета нет `"type": "module"`,
// значит `.js` исполнялся бы как CommonJS и `import` в нём был бы синтаксической
// ошибкой. Объявить весь пакет модулем ради одного файла — правка, которая
// задевает каждый скрипт вендора.
//
// 🔒 РЕШЕНИЕ ВЛАДЕЛЬЦА 2026-09-04: терминал живёт НА ТОМ ЖЕ ПОРТУ, ЧТО ЧАТ.
// Отсюда — ноль правок вне этого репозитория: nginx уже несёт `Upgrade` и
// `Connection: upgrade` на `location /` блока `chat.<домен>`, а `bootstrap.sh`
// запускает `pm2 start pnpm -- start`, то есть читает наш же `start`. Второй
// процесс на своём порту потребовал бы правки генератора nginx в `ai-workspace`
// и замороженного `lib/bootstrap.sh` в FES.
//
// 🛑 ЦЕНА НАЗВАНА ЗАРАНЕЕ, А НЕ ОБНАРУЖЕНА ПОТОМ. Чат перестал быть чистым
// `next start` — это расхождение с вендором `vercel/ai-chatbot`, и его место в
// `SOURCE.md` рядом с кодом, по закону шага 96. Прежняя команда сохранена как
// `start:next` и работает: она поднимает чат БЕЗ терминала.
//
// 🔒 ПОЧЕМУ ЗДЕСЬ WEBSOCKET, А У СОСЕДА SSE — НЕ ПРОТИВОРЕЧИЕ. В
// `app/api/channels/events/route.ts` SSE выбран осознанно, и причина названа в
// коде: поток односторонний. Терминал двусторонний и посимвольный — ровно тот
// случай, ради которого WebSocket и существует.

// ✗ УМОЛЧАНИЕ ЗДЕСЬ БЫЛО ОБРАТНЫМ, И ЭТО НАЙДЕНО ТОЛЬКО НА СЕРВЕРЕ (114-6).
// Стояло `NODE_ENV !== "production"`, то есть при НЕЗАДАННОЙ переменной Next
// поднимался в режиме РАЗРАБОТКИ. `next start` выставляет `NODE_ENV=production`
// сам; свой сервер этого не делает, а pm2 запускает нас голой командой
// `pnpm start` — без переменной. Итог: боевая сборка лежала собранной и
// НЕ ИСПОЛЬЗОВАЛАСЬ, страницы компилировались по требованию (главная — 14 секунд),
// в браузер ехал клиент горячей перезагрузки, а гидратация не доходила до конца:
// вкладка рисовалась и не оживала.
// 🛑 ОТКАЗ ВЫГЛЯДЕЛ КАК УСПЕХ ВЕЗДЕ, ГДЕ МОЖНО БЫЛО СМОТРЕТЬ: `pnpm build` дал
// `BUILD_RC=0`, служба поднялась, обе страницы ответили `200`, консоль браузера
// была чиста. Нашлось по СПИСКУ ЗАПРОСОВ — там лежал `hmr-client`.
// 🔒 Отсюда умолчание перевёрнуто: разработка объявляется ЯВНО, всё остальное
// боевое. Локальная разработка идёт через `next dev` и этого файла не касается.
const dev = process.env.NODE_ENV === "development";
const port = Number(process.env.PORT || 3600);
const hostname = process.env.HOSTNAME || "0.0.0.0";

/** Сколько терминалов держим разом: оболочка — это память и процессы. */
const MAX_SESSIONS = 4;

/** Сколько ждём `init` с билетом, прежде чем закрыть молчащее соединение. */
const INIT_DEADLINE_MS = 10_000;

const CLOSE_POLICY = 1008;

// ── что запускается по имени режима ──────────────────────────────────────────
//
// 🔒 СПИСОК ЗАКРЫТЫЙ, СВОБОДНОЙ КОМАНДЫ ПО ПРОВОДУ НЕТ. Права это не добавляет —
// у человека и так полная оболочка, — но делает читаемым, что именно предлагает
// вкладка, и не даёт следующему агенту завести «просто выполните строку».
//
// 🔒 `claude auth login` — ПОДКОМАНДА, А НЕ `/login` ВНУТРИ ИНТЕРФЕЙСА. Измерено
// на сервере 114-2: у CLI 2.1.260 есть настоящая подкоманда входа с флагами
// `--claudeai` (подписка, умолчание) и `--console`. Набирать команду в TUI
// значило бы зависеть от его раскладки.
// 🔒 РЕЖИМОВ СТАЛО ТРИ, И ДВА ИЗ НИХ — ОДНА КНОПКА (114-8, решение владельца:
// «не понадобится кнопка оболочка и не понадобится кнопка Claude Code,
// достаточно того что у нас есть кнопка вход по подписке»).
//
// ✗ ИЗМЕРЕНО ПЕРЕД ПРАВКОЙ, И ЭТО РЕШИЛО КОНСТРУКЦИЮ: `claude auth login` НЕ
// проверяет, вошли ли уже, — он начинает новый обмен OAuth безусловно. Одна
// кнопка без проверки просила бы вход при КАЖДОМ открытии вкладки у человека,
// который давно вошёл, и это читалось бы как «вход не сохранился».
//
// Отсюда разделение: `claude-check` открывает вкладку и входит ТОЛЬКО если
// надо, `claude-login` — то, что делает кнопка: вход заново, всегда.
//
// 🛑 `system` ОСТАЁТСЯ, ХОТЯ КНОПКИ У НЕГО БОЛЬШЕ НЕТ. Это запасной разбор
// неизвестного имени ниже: без него `init` с чужим значением остался бы без
// команды. И это честно называет положение вещей — под всеми режимами лежит
// одна и та же полная оболочка, а режим лишь решает, что в неё напечатать.
//
// 🪦 РЕЖИМ `claude-code` УБРАН ТЕМ ЖЕ РЕШЕНИЕМ. Способность не потеряна: в
// оболочке по-прежнему можно набрать `claude` руками — исчезла кнопка, а не
// возможность.
const MODES = {
  // 🔒 ТОКЕНА В КОМАНДЕ НЕТ, И ЭТО НЕ МЕЛОЧЬ. Плагин читает его из
  // `~/.claude/channels/telegram/.env`, куда его положила дверь `agent-setup`.
  // Подставить токен прямо сюда было бы на один файл меньше кода — и секрет
  // уехал бы в ленту терминала и в историю оболочки. Показанный на экране
  // секрет перестаёт быть секретом.
  "claude-channel": (bin) =>
    `${bin} --channels plugin:telegram@claude-plugins-official\n`,
  // `claude-check` команды не печатает: решение принимает НАШ код (см.
  // `alreadyLoggedIn` ниже), а не однострочник в оболочке.
  //
  // ✗ ПЕРВАЯ ВЕРСИЯ ПРОВЕРЯЛА ГРЕПОМ ПРЯМО В ОБОЛОЧКЕ, И ЭТО БЫЛО ВИДНО.
  // Человек открывал вкладку и первым делом читал `claude auth status
  // 2>/dev/null | grep -q '"loggedIn": *true' && echo … || claude auth login`
  // — строку, которая ему ничего не говорит и выглядит как сбой. Оболочка
  // отражает всё, что в неё печатают, и спрятать это, продолжая печатать,
  // нельзя. Значит печатать не надо.
  "claude-check": () => null,
  "claude-login": (bin) => `${bin} auth login\n`,
  system: () => null,
};

function shellPath() {
  if (process.env.PTY_SHELL) {
    return process.env.PTY_SHELL;
  }
  // 🔒 ОБОЛОЧКА ВЫБИРАЕТСЯ ИЗМЕРЕНИЕМ, А НЕ ПАМЯТЬЮ, И СПИСОК НАЧИНАЕТСЯ С
  // WINDOWS. ✗ оплачено прибором 114-3: первая версия возвращала `/bin/zsh`
  // или `/bin/bash` без проверки второго, и на машине разработчика node-pty
  // отвечал `File not found:` — с ПУСТЫМ именем файла. Отказ, не называющий
  // предмет, отправляет чинить не туда.
  //
  // 🛑 Боевая машина здесь всегда linux, и `zsh` на ней стоит (`bootstrap.sh`
  // ставит его с прежних времён). Но чат — открытый стартер: его клонируют на
  // macOS и Windows, и «у меня терминал не работает» станет первым, что мы
  // услышим.
  const candidates =
    process.platform === "win32"
      ? [process.env.ComSpec, "C:\\Windows\\System32\\cmd.exe"]
      : ["/bin/zsh", "/bin/bash", "/bin/sh"];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates.at(-1) ?? "/bin/sh";
}

function workspaceDir() {
  const named = process.env.AGENT_WORKSPACE || "/opt/fractera/agent-workspace";
  return existsSync(named) ? named : process.cwd();
}

// 🛑 `node-pty` — НАТИВНЫЙ МОДУЛЬ, И ЕГО ОТКАЗ ОБЯЗАН БЫТЬ ГРОМКИМ, А НЕ ТИХИМ.
// У версии 1.1.0 готовые сборки есть только под darwin и win32; на linux он
// компилируется скриптом установки, а pnpm 10 такие скрипты по умолчанию НЕ
// запускает — отсюда `pnpm.onlyBuiltDependencies` в `package.json`. Если модуль
// всё же не загрузился, чат обязан подняться и работать: терминал — не он.
let pty = null;
let ptyLoadError = "";
try {
  pty = (await import("node-pty")).default;
} catch (err) {
  ptyLoadError = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `[pty] МОДУЛЬ НЕ ЗАГРУЖЕН: ${ptyLoadError}\n` +
      "[pty] чат поднимется, терминал будет отказывать. Лечение: pnpm rebuild node-pty\n"
  );
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => {
  handle(req, res);
});

const wss = new WebSocketServer({ noServer: true });
let sessions = 0;

server.on("upgrade", (req, socket, head) => {
  let pathname = "";
  try {
    ({ pathname } = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`
    ));
  } catch {
    socket.destroy();
    return;
  }

  if (pathname === "/pty") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return;
  }

  // 🔒 ВСЁ ОСТАЛЬНОЕ ОТДАЁТСЯ NEXT, А НЕ РВЁТСЯ. В режиме разработки по
  // WebSocket ходит его собственный канал обновления; молча закрыв его, мы
  // сломали бы горячую перезагрузку и объяснили бы это «турбопак барахлит».
  const upgrade = app.getUpgradeHandler?.();
  if (upgrade) {
    upgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  let proc = null;
  let started = false;

  const deadline = setTimeout(() => {
    if (!started) {
      ws.close(CLOSE_POLICY, "no-init");
    }
  }, INIT_DEADLINE_MS);

  function fail(reason) {
    clearTimeout(deadline);
    ws.close(CLOSE_POLICY, reason);
  }

  function start(mode) {
    if (!pty) {
      // Громко и человеку, и в журнал: молчаливое закрытие читается как
      // «терминал не работает», а причина остаётся только у сервера.
      ws.send(
        `\r\n[терминал недоступен: node-pty не собран — ${ptyLoadError}]\r\n`
      );
      fail("pty-unavailable");
      return;
    }
    if (sessions >= MAX_SESSIONS) {
      ws.send(
        `\r\n[открыто ${sessions} терминалов из ${MAX_SESSIONS} — закройте лишние]\r\n`
      );
      fail("too-many-sessions");
      return;
    }

    const bin = claudeBin();
    const shell = shellPath();
    try {
      proc = pty.spawn(shell, [], {
        // 🔒 500 КОЛОНОК НА СТАРТЕ — ПРИЁМ ИЗ ОРИГИНАЛА, И ОН ПРО ССЫЛКУ ВХОДА.
        // Первые строки печатаются до того, как браузер пришлёт настоящий
        // размер; узкая полоса завернула бы ссылку OAuth переносом.
        cols: 500,
        cwd: workspaceDir(),
        // 🔒 ОКРУЖЕНИЕ — УЗКИЙ БЕЛЫЙ СПИСОК, А НЕ `process.env`. В окружении
        // чата живут пароль базы, секрет службы данных и ключ входа; оболочка,
        // которую человек открывает в браузере, не имеет к ним отношения.
        env: {
          HOME: process.env.HOME,
          LANG: process.env.LANG || "C.UTF-8",
          LOGNAME: process.env.LOGNAME,
          PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
          SHELL: shell,
          TERM: "xterm-256color",
          USER: process.env.USER,
        },
        name: "xterm-256color",
        rows: 24,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ws.send(`\r\n[оболочка ${shell} не запустилась: ${message}]\r\n`);
      fail("spawn-failed");
      return;
    }

    sessions += 1;
    started = true;
    clearTimeout(deadline);

    proc.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    });

    proc.onExit(() => {
      if (ws.readyState === ws.OPEN) {
        ws.close();
      }
    });

    // 🔒 ВКЛАДКА ОТКРЫЛАСЬ — РЕШАЕМ ЗДЕСЬ, А НЕ В ОБОЛОЧКЕ. Вошедшему говорим
    // это словами и оставляем его в покое; невошедшего сразу ведём во вход —
    // ровно за этим вкладка и существует. Не смогли спросить — говорим правду
    // о незнании, а не подставляем удобный ответ.
    let command = MODES[mode](bin);
    if (mode === "claude-check") {
      const state = claudeAuthState().loggedIn;
      if (state === true) {
        ws.send(
          "\r\nПодписка Claude Code подключена. " +
            "Кнопка «Вход по подписке Claude Code» — войти заново.\r\n\r\n"
        );
      } else if (state === null) {
        ws.send(
          "\r\nСостояние подписки узнать не удалось: " +
            `${bin} не ответил. Нажмите кнопку входа, чтобы войти вручную.\r\n\r\n`
        );
      } else {
        command = MODES["claude-login"](bin);
      }
    }

    if (command) {
      // Пауза — чтобы файлы запуска оболочки успели отработать: команда,
      // впечатанная раньше приглашения, теряется целиком.
      setTimeout(() => {
        try {
          proc.write(command);
        } catch {
          /* оболочка уже закрыта — сказать об этом нечему и незачем */
        }
      }, 800);
    }
  }

  ws.on("message", (raw) => {
    let msg = null;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") {
      return;
    }

    if (msg.type === "init") {
      if (started) {
        return;
      }
      // 🔒 БИЛЕТ ГАСИТСЯ ДО ЛЮБОЙ ДРУГОЙ ПРОВЕРКИ. Отказ по режиму, отданный
      // раньше отказа по билету, рассказал бы непрошеному гостю, какие режимы
      // существуют.
      const email = redeemPtyTicket(msg.ticket);
      if (!email) {
        fail("bad-ticket");
        return;
      }
      const mode =
        typeof msg.mode === "string" && msg.mode in MODES ? msg.mode : "system";
      start(mode);
      return;
    }

    if (!started || !proc) {
      return;
    }

    if (msg.type === "stdin" && typeof msg.data === "string") {
      proc.write(msg.data);
      return;
    }
    if (msg.type === "resize" && msg.cols && msg.rows) {
      proc.resize(Number(msg.cols), Number(msg.rows));
    }
  });

  ws.on("close", () => {
    clearTimeout(deadline);
    if (proc) {
      sessions = Math.max(0, sessions - 1);
      try {
        proc.kill();
      } catch {
        /* уже мёртв */
      }
      proc = null;
    }
  });

  ws.on("error", (err) => {
    process.stderr.write(`[pty] ошибка сокета: ${err.message}\n`);
  });
});

server.listen(port, hostname, () => {
  process.stdout.write(
    `чат слушает http://${hostname}:${port} · терминал ws://${hostname}:${port}/pty` +
      `${pty ? "" : " (НЕДОСТУПЕН: node-pty не собран)"}\n`
  );
});
