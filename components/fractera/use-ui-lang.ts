"use client";

import { useEffect, useState } from "react";

// ЯЗЫК ИНТЕРФЕЙСА ДЛЯ ОСТРОВКОВ — ОДНО МЕСТО НА ВЕСЬ ЧАТ (шаг 96).
//
// 🛑 РЕШАЕТ БРАУЗЕР, А НЕ СЕРВЕР, И ЭТО НЕ ПРЕДПОЧТЕНИЕ, А ОГРАНИЧЕНИЕ СБОРКИ.
// Сначала язык выбирал сервер и писал его в `<html lang>` — сборка отказала: у
// шаблона включён `cacheComponents`, и обращение к заголовкам в корневой
// раскладке делает динамическими все страницы разом.
//
// 🔒 ИСТОЧНИК ВСЁ РАВНО ОДИН — ЭТА ФУНКЦИЯ. Появится настройка языка у
// человека, она встанет здесь же и перекроет язык браузера; ни один компонент
// про это не узнает.
//
// 🔒 ПЕРВЫЙ ПРОХОД — «en», И ЭТО НАМЕРЕННО: разметка на сервере и в браузере
// обязана совпасть, иначе React ругается на расхождение. Настоящий язык
// подставляется сразу после появления разметки.

export type UiLang = "en" | "ru";

export function useUiLang(): UiLang {
  const [lang, setLang] = useState<UiLang>("en");

  useEffect(() => {
    const fromHtml = document.documentElement.lang?.toLowerCase() ?? "";
    const fromBrowser = navigator.language?.toLowerCase() ?? "";
    const chosen = fromHtml.startsWith("ru") || fromBrowser.startsWith("ru") ? "ru" : "en";
    setLang(chosen);
  }, []);

  return lang;
}
