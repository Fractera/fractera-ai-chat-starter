"use client";

import { useEffect, useState } from "react";

// ЯЗЫК ИНТЕРФЕЙСА ДЛЯ ОСТРОВКОВ — ОДНО МЕСТО НА ВЕСЬ ЧАТ (шаг 96).
//
// 🔒 РЕШЕНИЕ О ЯЗЫКЕ ПРИНИМАЕТ СЕРВЕР и записывает его в `<html lang>`; островок
// его лишь читает. Спрашивать `navigator.language` значило бы завести второй
// источник правды, который на первой же настройке языка разойдётся с первым.
//
// 🔒 ПЕРВЫЙ ПРОХОД — «en», И ЭТО НАМЕРЕННО: разметка на сервере и в браузере
// обязана совпасть, иначе React ругается на расхождение. Настоящий язык
// подставляется сразу после появления разметки.

export type UiLang = "en" | "ru";

export function useUiLang(): UiLang {
  const [lang, setLang] = useState<UiLang>("en");

  useEffect(() => {
    const l = document.documentElement.lang?.toLowerCase() ?? "";
    setLang(l.startsWith("ru") ? "ru" : "en");
  }, []);

  return lang;
}
