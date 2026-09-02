"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useUiLang } from "@/components/fractera/use-ui-lang";
import { toast } from "@/components/chat/toast";

// ГОЛОСОВОЙ ВВОД — ЗАПИСЬ В БРАУЗЕРЕ, РАСШИФРОВКА НАШИМ КЛЮЧОМ (шаг 96).
//
// 🔒 ЗАПИСЬ ОСТАЁТСЯ ВЛОЖЕНИЕМ, А НЕ ИСЧЕЗАЕТ ПОСЛЕ РАСШИФРОВКИ — прямое
// требование владельца: голосовые сообщения должны оставаться в ленте чата.
// ✗ у бота сохранялась только расшифровка, и интонация, паузы, оговорки
// терялись безвозвратно; здесь звук уезжает в медиатеку как обычный файл.
//
// 🛑 ДВА ЧЕСТНЫХ ОТКАЗА ВМЕСТО МОЛЧАНИЯ. Микрофон недоступен без защищённого
// соединения — браузер просто не отдаёт устройство, и кнопка обязана сказать
// почему. Ключа нет — дверь отвечает `409`, и это тоже говорится словами.

const WORDS = {
  en: {
    start: "Dictate a message",
    stop: "Stop recording",
    insecure: "Voice input needs a secure connection (https).",
    noKey: "Voice input needs an OpenAI key — add it in the menu below.",
    denied: "The browser did not allow the microphone.",
    failed: "Could not transcribe the recording.",
  },
  ru: {
    start: "Надиктовать сообщение",
    stop: "Остановить запись",
    insecure: "Голосовой ввод работает только по защищённому соединению (https).",
    noKey: "Для голосового ввода нужен ключ OpenAI — добавьте его в меню внизу.",
    denied: "Браузер не дал доступ к микрофону.",
    failed: "Расшифровать запись не удалось.",
  },
} as const;

export function VoiceButton({
  onText,
  onRecorded,
  disabled,
}: {
  /** Расшифрованные слова — их дописывают в поле ввода. */
  onText: (text: string) => void;
  /** Сама запись — её прикладывают к сообщению, чтобы она осталась в ленте. */
  onRecorded: (file: File) => void;
  disabled?: boolean;
}) {
  const w = WORDS[useUiLang()];
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const start = useCallback(async () => {
    // 🔒 ПРОВЕРКА ДО ЗАПРОСА УСТРОЙСТВА: без защищённого соединения браузер не
    // покажет даже вопроса о разрешении, и человек решит, что кнопка мертва.
    if (!(window.isSecureContext && navigator.mediaDevices?.getUserMedia)) {
      toast({ description: w.insecure, type: "error" });
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast({ description: w.denied, type: "error" });
      return;
    }

    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = async () => {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });

      setState("working");
      // Запись отдаём сразу: даже если расшифровка не удастся, голос человека
      // не пропадёт — он останется вложением в ленте.
      onRecorded(file);

      try {
        const form = new FormData();
        form.append("audio", file);
        const res = await fetch("/api/fractera/transcribe", { body: form, method: "POST" });
        if (res.status === 409) {
          toast({ description: w.noKey, type: "error" });
          return;
        }
        if (!res.ok) {
          toast({ description: w.failed, type: "error" });
          return;
        }
        const d = (await res.json()) as { text?: string };
        if (d.text) {
          onText(d.text);
        }
      } catch {
        toast({ description: w.failed, type: "error" });
      } finally {
        setState("idle");
      }
    };

    recorder.start();
    setState("recording");
  }, [onRecorded, onText, w]);

  return (
    <Button
      aria-label={state === "recording" ? w.stop : w.start}
      className="rounded-full"
      data-voice-state={state}
      disabled={disabled || state === "working"}
      onClick={state === "recording" ? stop : start}
      size="icon-sm"
      title={state === "recording" ? w.stop : w.start}
      type="button"
      variant={state === "recording" ? "destructive" : "ghost"}
    >
      {state === "working" ? (
        <Loader2 className="size-4 animate-spin" />
      ) : state === "recording" ? (
        <Square className="size-4" />
      ) : (
        <Mic className="size-4" />
      )}
    </Button>
  );
}
