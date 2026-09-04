"use client";

import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// МОДАЛКА АКТИВАЦИИ ПОДПИСКИ — ПЕРЕНЕСЕНА ИЗ `e1e7ff0^` (шаг 114-4).
//
// Источник: `bridges/app/_components/coding-workspace/auth-flow-modal.client.tsx`.
// Из трёх потоков оригинала (`terminal-paste`, `url-relay`, `device-code`) здесь
// остался ОДИН — `terminal-paste`, потому что заказан один Claude Code, а два
// других обслуживали Codex и Kimi. Ветки, которую некому исполнить, в коде быть
// не должно: она не проверяется и устаревает молча.
//
// 🔒 ПОЧЕМУ ЭТО ВООБЩЕ РАБОТАЕТ. `claude auth login` печатает ссылку и ждёт код
// в свой stdin. Человек открывает ссылку у себя в браузере, входит СВОЕЙ
// подпиской, получает код и вставляет его сюда; код уходит в stdin того же PTY —
// то есть CLI получает его так, будто набрали руками. Наш код в обмене не
// участвует и ключей не видит.
//
// 🛑 ОКНО ЗАКРЫВАЕТСЯ ПО ДЕЙСТВИЮ, А НЕ ПО ПРИЗНАКУ УСПЕХА, И ЭТО СКАЗАНО
// ВСЛУХ. У оригинала в типе было объявлено поле `detectSuccess`, которое НИГДЕ
// не использовалось — то есть обещание проверки, которой нет. Здесь такого поля
// нет вовсе: успех человек видит в самом терминале, куда возвращается окно.

type Props = {
  onClose: () => void;
  onSendCode: (code: string) => void;
  url: string;
};

export function AuthFlowModal({ onClose, onSendCode, url }: Props) {
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* буфер обмена закрыт политикой браузера — ссылка видна и выделяется */
    }
  }, [url]);

  const handleSend = useCallback(() => {
    const value = code.trim();
    if (!value) {
      return;
    }
    onSendCode(value);
    setSent(true);
    setTimeout(onClose, 1200);
  }, [code, onClose, onSendCode]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    [onClose]
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCode(e.target.value);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <Dialog onOpenChange={handleOpenChange} open>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <KeyRoundIcon className="text-primary" size={18} />
            </span>
            <div className="flex flex-col gap-0.5">
              <DialogTitle className="text-left">
                Claude Code — вход по вашей подписке
              </DialogTitle>
              <DialogDescription className="text-left text-[12px]">
                Откройте ссылку в браузере и войдите в свою учётную запись
                Anthropic. Затем вставьте выданный код в поле ниже.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[110px] shrink-0 select-text overflow-y-auto break-all rounded-lg border border-border bg-muted/50 px-3 py-2">
          <span className="font-mono text-[12px] text-foreground leading-relaxed">
            {url}
          </span>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            onClick={handleCopy}
            size="sm"
            type="button"
            variant="outline"
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            {copied ? "Скопировано" : "Скопировать ссылку"}
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={url} rel="noopener noreferrer" target="_blank">
              <ExternalLinkIcon size={14} />
              Открыть
            </a>
          </Button>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Input
            autoComplete="off"
            disabled={sent}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Вставьте код сюда"
            value={code}
          />
          <Button
            className="w-full"
            disabled={sent || code.trim().length === 0}
            onClick={handleSend}
            type="button"
          >
            {sent ? "Отправлено в терминал" : "Отправить код в терминал"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
