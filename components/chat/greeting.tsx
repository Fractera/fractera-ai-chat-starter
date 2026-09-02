"use client";

import { motion } from "framer-motion";
import { useUiLang } from "@/components/fractera/use-ui-lang";

// ПРИВЕТСТВИЕ ПЕРЕД ПЕРВЫМ СООБЩЕНИЕМ (наша правка поверх шаблона, шаг 96).
//
// 🔒 ДВА ЯЗЫКА, И СЛОВАРЬ ЗДЕСЬ ЖЕ — ЭТО ЗАКОННОЕ ИСКЛЮЧЕНИЕ ИЗ НАШЕГО ПРАВИЛА.
// Правило «словарь серверный, островку отдают готовые строки» защищает от того,
// чтобы 82 языка × сотни ключей уезжали в браузер. Здесь две строки на два
// языка; тянуть их пропсами через провайдер и три компонента шаблона значило бы
// править чужое дерево ради экономии, которой нет.
//
// 🔒 ЯЗЫК БЕРЁТСЯ У СТРАНИЦЫ (`<html lang>`), А НЕ У БРАУЗЕРА: язык решает
// сервер, и разметка — то место, где его решение уже записано.
//
// 🪦 ЗДЕСЬ СТОЯЛО «What can I help with?» ОДНИМ ЯЗЫКОМ — текст шаблона.

const WORDS = {
  en: {
    title: "What are we building?",
    lead: "Ask about this project, its data, or what the bot understood.",
  },
  ru: {
    title: "Что строим?",
    lead: "Спросите о проекте, его данных или о том, что бот понял из сообщения.",
  },
} as const;

export const Greeting = () => {
  const lang = useUiLang();
  const w = WORDS[lang];

  return (
    <div className="flex flex-col items-center px-4" key="overview">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="text-center font-semibold text-2xl tracking-tight text-foreground md:text-3xl"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.35, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {w.title}
      </motion.div>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="mt-3 text-center text-muted-foreground/80 text-sm"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.5, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {w.lead}
      </motion.div>
    </div>
  );
};
