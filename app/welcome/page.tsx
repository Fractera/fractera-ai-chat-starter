import { headers } from "next/headers";
import { Suspense } from "react";
import { WelcomeCard, WelcomeSignIn } from "@/components/fractera/welcome";

// СТРАНИЦА-ЗАГЛУШКА ДЛЯ НЕАВТОРИЗОВАННОГО (правка владельца 2026-09-02).
//
// 🔒 ЕГО СЛОВА: «создадим вторую страницу для чата, которая будет возвращать
// однотонный экран с окном в центре и текстом „авторизуйтесь, чтобы начать чат
// с агентом с искусственным интеллектом“».
//
// 🔒 ПОЧЕМУ СТРАНИЦА, А НЕ ПРАВКА ССЫЛКИ ВЫХОДА. Стандарт адреса выхода общий с
// панелью (`/logout?redirectUrl=<сюда>`), и менять его ради одного случая
// значило бы завести второй стандарт. Не хватало не ссылки, а МЕСТА, куда
// человек возвращается: страницы, которая существует без сессии.
//
// 🛑 ДОСТУП К ЭТОЙ СТРАНИЦЕ ОТКРЫТ НАМЕРЕННО, и это не дыра: она не показывает
// ни разговоров, ни данных — только приглашение войти.
export default function WelcomePage() {
  return (
    <WelcomeCard>
      {/* 🔒 КНОПКА ВНУТРИ `Suspense`, И ЭТО НЕ УКРАШЕНИЕ: она читает заголовки
          запроса, а у сборки включён `cacheComponents` — без границы ожидания
          такое чтение делает динамической всю страницу и роняет сборку. */}
      <Suspense fallback={null}>
        <SignInLink />
      </Suspense>
    </WelcomeCard>
  );
}

async function SignInLink() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";

  // Публичный адрес службы — первым: внутренний `localhost:3001` верен для
  // запроса сервер-серверу и бессмыслен в адресной строке человека.
  const authUrl = process.env.NEXT_PUBLIC_AUTH_URL || process.env.AUTH_SERVICE_URL || "";
  const back = host ? `${proto}://${host}/` : "";
  const href = authUrl && back
    ? `${authUrl}/login?redirectUrl=${encodeURIComponent(back)}`
    : "";

  return <WelcomeSignIn href={href} />;
}
