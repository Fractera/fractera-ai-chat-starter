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
//
// 🛑 АДРЕСА СОБИРАЮТСЯ ИЗ ЗАГОЛОВКОВ NGINX, А НЕ ИЗ `request.url`. ✗ оплачено
// трижды за день: за прокси внутренний адрес выглядит как `localhost:3600`, и
// любая построенная из него ссылка ведёт в никуда с чужой машины.

function publicOrigin(request: NextRequest): string {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : new URL(request.url).origin;
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

  // 🔒 СТРАНИЦА-ЗАГЛУШКА ЖИВЁТ БЕЗ СЕССИИ — иначе она отправляла бы к входу
  // того, кто на неё же и вернулся после выхода, и человек ходил бы по кругу.
  if (pathname === "/welcome") {
    return NextResponse.next();
  }

  // 🛑 СПРАШИВАЕМ СЛУЖБУ ДАЖЕ БЕЗ ЕДИНОЙ КУКИ — ЭТО ПРО РЕЖИМ БЕЗ ДОМЕНА.
  // Здесь стояло `if (cookie)`: без кук привратник никого не спрашивал и сразу уводил на
  // заглушку. В защищённом режиме разницы нет — служба и так ответила бы `401`. Но свежий
  // сервер живёт на голом IP, и там служба входа отдаёт `demo@local` с ролью архитектора
  // ВСЕМ: панель и сайт в онбординге работают, а чат единственный отвечал бы «войдите»,
  // при том что входить ещё некуда. Цена — один запрос по петле.
  const cookie = request.headers.get("cookie") ?? "";
  let signedIn = false;
  {
    try {
      const authService =
        process.env.AUTH_SERVICE_URL ||
        process.env.NEXT_PUBLIC_AUTH_URL ||
        "http://localhost:3001";
      const res = await fetch(`${authService}/api/session`, {
        cache: "no-store",
        headers: cookie ? { cookie } : undefined,
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
    // 🔒 СНАЧАЛА ЗАГЛУШКА, ПОТОМ ВХОД (правка владельца 2026-09-02). Прямая
    // переадресация к службе выглядела как поломка: человек нажимал «выйти» и
    // немедленно оказывался на чужой форме входа, не поняв, что вышел. Заглушка
    // объясняет, где он и что делать, и уводит дальше по нажатию.
    //
    // 🔒 СТАНДАРТ ССЫЛКИ ВЫХОДА ПРИ ЭТОМ НЕ ТРОНУТ: он общий с панелью, и второй
    // стандарт ради одного случая — это ровно то, чего мы избегаем.
    return NextResponse.redirect(`${publicOrigin(request)}/welcome`);
  }

  // Вошедшему незачем видеть формы входа шаблона и заглушку: единственная точка
  // входа — служба, и её страницы живут по другому адресу.
  if (["/login", "/register", "/welcome"].includes(pathname)) {
    return NextResponse.redirect(`${publicOrigin(request)}/`);
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
    "/welcome",

    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
