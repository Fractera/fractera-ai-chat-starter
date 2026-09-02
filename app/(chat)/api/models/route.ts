import { getAllGatewayModels, getCapabilities, isDemo } from "@/lib/ai/models";

// 🔒 ЭТА ДВЕРЬ НЕ КЭШИРУЕТСЯ, И ЭТО ОПЛАЧЕНО ДЕФЕКТОМ 2026-09-02.
//
// Шаблон ставил здесь `public, max-age=86400`: у него список приезжал из
// шлюза Vercel и менялся сам по себе, раз в сутки — этого хватало. У нас
// список рождается ИЗ КОДА (`lib/ai/models.ts`) и меняется вместе с деплоем,
// а сутки кэша в браузере переживают любую нашу правку.
//
// ✗ Чем оплачено: ответ со списком моделей ШЛЮЗА (deepseek, kimi, grok) лёг в
// браузер владельца до того, как мы заменили модели на свои. После деплоя
// сервер отвечал верно, браузер — старым списком, и `gpt-5.4-mini` в нём не
// было вовсе. Скрепка вложений читает отсюда признак `vision`; ключа нет →
// `hasVision` = false → кнопка серая и не нажимается. Микрофон эту дверь не
// спрашивает — потому и работал. Отказ был МОЛЧАЛИВЫЙ: ни ошибки, ни лога.
export async function GET() {
  const headers = {
    "Cache-Control": "no-store",
  };

  const curatedCapabilities = await getCapabilities();

  if (isDemo) {
    const models = await getAllGatewayModels();
    const capabilities = Object.fromEntries(
      models.map((m) => [m.id, curatedCapabilities[m.id] ?? m.capabilities])
    );

    return Response.json({ capabilities, models }, { headers });
  }

  return Response.json(curatedCapabilities, { headers });
}
