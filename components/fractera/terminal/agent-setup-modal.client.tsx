"use client";

import { CheckIcon, KeyRoundIcon, LinkIcon, SendIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// ОКНО ПОДКЛЮЧЕНИЯ АГЕНТА — ОДНА КНОПКА, ОБЕ ПОЛОВИНЫ (шаг 115).
//
// Решение владельца дословно: «в нашей кнопке которая называется вход по
// подписке Claude Code расширим функционал и вставим дополнительное поле для
// Telegram-бота… Первый вариант для меня предпочтительнее».
//
// 🔒 ПОЧЕМУ ПОЛЕ, А НЕ НАБОР В ТЕРМИНАЛЕ. Его же слово: «кликни в чёрное поле —
// это совсем не тот вариант». И довод сильнее удобства: оболочка отражает
// набранное в ленту и кладёт строку в свою историю, то есть токен, введённый
// в терминал, остаётся на экране и на диске.
//
// 🔒 ПОРЯДОК ПОЛОВИН НЕ КОСМЕТИЧЕСКИЙ: канал требует входа по подписке, а не
// наоборот. Поэтому подписка сверху, и запуск канала недоступен, пока её нет —
// кнопка, которая нажимается и молча ничего не делает, читается как поломка.

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const ENDPOINT = `${BASE}/api/fractera/agent-setup`;

type Setup = {
  subscription: { loggedIn: boolean | null; method: string | null };
  telegram: {
    allowed: number;
    masked: string;
    pending: { code: string; expiresAt: number }[];
    present: boolean;
  };
};

/**
 * Как часто спрашиваем дверь, пока окно открыто.
 *
 * 🔒 ОПРОС ЕСТЬ ЧАСТЬ ЗАМЫСЛА, А НЕ ОПТИМИЗАЦИЯ. Человек пишет боту С ТЕЛЕФОНА,
 * и в этот момент на экране компьютера не происходит ничего. Без опроса ему
 * пришлось бы догадаться закрыть и открыть окно — то есть ровно та
 * неочевидность, ради устранения которой подшаг и заведён.
 */
const POLL_MS = 3000;

/**
 * Одна строка ожидающей привязки.
 *
 * Отдельным компонентом, а не стрелкой в пропсе: правило `noJsxPropsBind`
 * действует не из вкусовщины — новая функция на каждый рендер ломает
 * мемоизацию у всего, что ниже, а окно опрашивает дверь каждые три секунды.
 */
function PairRow({
  canPair,
  code,
  onPair,
}: {
  canPair: boolean;
  code: string;
  onPair: (code: string) => void;
}) {
  const handleClick = useCallback(() => {
    onPair(code);
  }, [code, onPair]);

  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 rounded bg-background px-2 py-1.5 font-mono text-[13px]">
        {code}
      </code>
      <Button disabled={!canPair} onClick={handleClick} size="sm" type="button">
        <LinkIcon size={14} />
        Привязать
      </Button>
    </div>
  );
}

type Props = {
  /** Идёт ли в этой вкладке сессия с каналом — команду привязки принимает она. */
  channelRunning: boolean;
  onClose: () => void;
  onLaunchChannel: () => void;
  onLogin: () => void;
  /** Отправить команду привязки в терминал вкладки. */
  onPair: (code: string) => void;
};

export function AgentSetupModal({
  channelRunning,
  onClose,
  onLaunchChannel,
  onLogin,
  onPair,
}: Props) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      if (res.ok) {
        setSetup((await res.json()) as Setup);
        return;
      }
      setNote(
        res.status === 403
          ? "Подключать агента может только архитектор проекта."
          : `Дверь ответила ${res.status}.`
      );
    } catch {
      setNote("Дверь подключения недоступна.");
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const handleSave = useCallback(async () => {
    const value = token.trim();
    if (!value) {
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const res = await fetch(ENDPOINT, {
        body: JSON.stringify({ token: value }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (res.ok) {
        setSetup((await res.json()) as Setup);
        setToken("");
        // 🛑 «Сохранён» — правда о файле и не правда о работе: плагин прочитает
        // токен только при запуске канала. Говорим ровно это.
        setNote("Токен сохранён. Проверить его сможет только запуск канала.");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setNote(
        data.error === "bad-format"
          ? "Это не похоже на токен BotFather: ожидается вид 123456789:AA…"
          : `Не сохранён: ${data.error ?? res.status}`
      );
    } catch {
      setNote("Не сохранён: дверь недоступна.");
    } finally {
      setBusy(false);
    }
  }, [token]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setToken(e.target.value);
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    [onClose]
  );

  const loggedIn = setup?.subscription.loggedIn === true;
  const unknown = setup?.subscription.loggedIn === null;
  const hasToken = setup?.telegram.present === true;
  const pending = setup?.telegram.pending ?? [];
  const allowed = setup?.telegram.allowed ?? 0;

  return (
    <Dialog onOpenChange={handleOpenChange} open>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <KeyRoundIcon className="text-primary" size={18} />
            </span>
            <div className="flex flex-col gap-0.5">
              <DialogTitle className="text-left">
                Подключение агента
              </DialogTitle>
              <DialogDescription className="text-left text-[12px]">
                Подписка Claude Code и бот, из которого вы будете ему писать.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* ── 1. подписка ─────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-[13px]">
              1. Подписка Claude Code
            </span>
            <span className="text-[12px] text-muted-foreground">
              {setup === null && "проверяем…"}
              {loggedIn && `подключена · ${setup?.subscription.method ?? ""}`}
              {setup !== null && !(loggedIn || unknown) && "не подключена"}
              {unknown && "состояние неизвестно"}
            </span>
          </div>
          <Button onClick={onLogin} size="sm" type="button" variant="outline">
            {loggedIn ? "Войти заново" : "Войти по подписке"}
          </Button>
        </section>

        {/* ── 2. бот ──────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-[13px]">2. Telegram-бот</span>
            <span className="font-mono text-[12px] text-muted-foreground">
              {hasToken ? setup?.telegram.masked : "не задан"}
            </span>
          </div>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            Токен от <strong className="text-foreground">@BotFather</strong>:
            команда <code>/newbot</code>.{" "}
            <strong className="text-foreground">
              Заведите отдельного бота
            </strong>{" "}
            — рабочего уже опрашивает служба каналов, а Telegram отдаёт каждое
            сообщение только одному читателю.
          </p>
          <div className="flex gap-2">
            <Input
              autoComplete="off"
              disabled={busy}
              onChange={handleChange}
              placeholder={hasToken ? "заменить токен" : "123456789:AA…"}
              type="password"
              value={token}
            />
            <Button
              disabled={busy || token.trim().length === 0}
              onClick={handleSave}
              type="button"
            >
              <CheckIcon size={14} />
              Сохранить
            </Button>
          </div>
        </section>

        {/* ── 3. запуск ───────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <span className="font-medium text-[13px]">3. Запуск канала</span>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            Запустите канал, затем напишите боту с телефона.{" "}
            <strong className="text-foreground">
              Код привязки появится здесь сам
            </strong>{" "}
            — переписывать его никуда не нужно.
            <br />
            <strong className="text-foreground">Пока вкладка открыта</strong> —
            канал жив; закроете браузер — сессия закончится вместе с ним.
          </p>
          <Button
            disabled={!(loggedIn && hasToken)}
            onClick={onLaunchChannel}
            type="button"
            variant={channelRunning ? "outline" : "default"}
          >
            <SendIcon size={14} />
            {channelRunning
              ? "Перезапустить канал"
              : "Запустить канал Telegram"}
          </Button>
          {loggedIn && hasToken ? null : (
            <span className="text-[11px] text-muted-foreground">
              Доступно, когда подключены обе половины выше.
            </span>
          )}
        </section>

        {/* ── 4. привязка ─────────────────────────────────────────────────
            🔒 РАЗДЕЛ ПОЯВЛЯЕТСЯ САМ И САМ ЖЕ ИСЧЕЗАЕТ. Пока привязывать
            нечего, показывать нечего; пустой раздел «ожидание кода» на экране
            читался бы как незавершённая настройка. */}
        {pending.length > 0 ? (
          <section className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
            <span className="font-medium text-[13px]">
              4. Бот получил сообщение — подтвердите, что это вы
            </span>
            {pending.map((p) => (
              <PairRow
                canPair={channelRunning}
                code={p.code}
                key={p.code}
                onPair={onPair}
              />
            ))}
            {channelRunning ? null : (
              <span className="text-[11px] text-muted-foreground">
                Сначала запустите канал: команду привязки принимает та сессия, в
                которой он работает.
              </span>
            )}
          </section>
        ) : null}

        {allowed > 0 ? (
          <p className="text-[12px] text-muted-foreground">
            Привязано собеседников: <strong>{allowed}</strong>. Пишите боту — он
            отвечает.
          </p>
        ) : null}

        {note ? (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-600 dark:text-amber-300">
            {note}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
