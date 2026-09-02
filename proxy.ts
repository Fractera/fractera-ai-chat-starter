import { type NextRequest, NextResponse } from "next/server";

// ЕДИНАЯ ТОЧКА ВХОДА (наша правка поверх шаблона, шаг 96).
//
// 🔒 ТРЕБОВАНИЕ ВЛАДЕЛЬЦА ДОСЛОВНО: «где бы ни вошли — хоть админпанель, хоть
// сайт, хоть чат — всё делает переадресацию к единственной точке входа».
// Поэтому гостевой вход шаблона (`/api/auth/guest`) здесь больше не зовётся: он
// заводил бы вторую правду о человеке — чат знал бы своих, проект своих.
//
// 🔒 ПРОКСИ ЗНАЕТ ТОЛЬКО «ВОШЁЛ ИЛИ НЕТ». Личность и роли читает `auth()` на
// странице; прокси не должен знать о человеке больше, чем нужно для
// переадресации, — тот же порядок, что в гостевом приложении.
//
// 🔒 КУКА ВИДНА ЧАТУ, И ЭТО ИЗМЕРЕНО: служба входа ставит её на
// `COOKIE_DOMAIN=.aifa.dev`, то есть на весь домен второго уровня.

function authBase(): string {
  return (
    process.env.NEXT_PUBLIC_AUTH_URL ||
    process.env.AUTH_SERVICE_URL ||
    "http://localhost:3001"
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  // Родные маршруты NextAuth шаблона оставлены живыми: сносить чужой механизм
  // ради своего значит ссориться с каждым обновлением сверху.
  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const cookie = request.headers.get("cookie") ?? "";
  let signedIn = false;
  if (cookie) {
    try {
      const res = await fetch(`${authBase()}/api/session`, {
        headers: { cookie },
        cache: "no-store",
      });
      signedIn = res.ok && Boolean(((await res.json()) as { email?: string })?.email);
    } catch {
      // 🛑 СЛУЖБА ВХОДА МОЛЧИТ — ЧЕЛОВЕК НЕ УЗНАН, И ЭТО ЧЕСТНЫЙ ИСХОД. Пускать
      // «на всякий случай» нельзя: это открыло бы чат целиком в тот момент,
      // когда одна служба не отвечает.
      signedIn = false;
    }
  }

  if (!signedIn) {
    // Форма ссылки взята у сайта, а не придумана: страница `/register` службы
    // принимает `callbackUrl` и возвращает человека обратно.
    const back = new URL(request.url).toString();
    return NextResponse.redirect(
      `${authBase()}/register?callbackUrl=${encodeURIComponent(back)}&requireRole=user`,
    );
  }

  // Вошедшему незачем видеть формы входа шаблона: единственная точка входа —
  // служба, и её страницы живут по другому адресу.
  if (["/login", "/register"].includes(pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",
    "/register",

    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
