import { compare } from "bcrypt-ts";
import NextAuth, { type DefaultSession, type Session } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { DUMMY_PASSWORD } from "@/lib/constants";
import { getUser } from "@/lib/db/queries";
import { authConfig } from "./auth.config";
import { chatUserIdFor, fracteraSession } from "@/lib/fractera/session";

export type UserType = "guest" | "regular";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
    } & DefaultSession["user"];
  }

  interface User {
    email?: string | null;
    id?: string;
    type: UserType;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
  }
}

export const {
  handlers: { GET, POST },
  auth: nextAuth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.type = user.type;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
      }

      return session;
    },
  },
  providers: [
    Credentials({
      async authorize(credentials) {
        const email = String(credentials.email ?? "");
        const password = String(credentials.password ?? "");
        const users = await getUser(email);

        if (users.length === 0) {
          await compare(password, DUMMY_PASSWORD);
          return null;
        }

        const [user] = users;

        if (!user.password) {
          await compare(password, DUMMY_PASSWORD);
          return null;
        }

        const passwordsMatch = await compare(password, user.password);

        if (!passwordsMatch) {
          return null;
        }

        return { ...user, type: "regular" };
      },
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
    }),
    // 🪦 ПРОВАЙДЕР "guest" УДАЛЁН 2026-09-02 (шаг 96). Он заводил безымянного
    // пользователя ЛЮБОМУ, кто дошёл до стандартного колбэка NextAuth
    // (`/api/auth/callback/guest`) — то есть был писателем в базу без всякой
    // авторизации, в обход трёх наших замков: те стоят на нашей двери
    // `/api/auth/guest`, в `proxy.ts` и на двери сообщений, а этот путь
    // NextAuth открывает сам.
    //
    // ✗ ИЗМЕРЕНО, А НЕ ПРЕДПОЛОЖЕНО: в базе чата за сутки накопилось 126 строк
    // вида `guest-<время>` при ОДНОМ настоящем разговоре. Своего входа у чата
    // нет по закону — значит и провайдеру взяться неоткуда.
  ],
});



// ── ЕДИНАЯ ТОЧКА ВХОДА (наша правка поверх шаблона, шаг 96) ──────────────────
//
// 🔒 auth() ТЕПЕРЬ СПРАШИВАЕТ НАШУ СЛУЖБУ ВХОДА, А НЕ СВОЙ NextAuth. Все места
// шаблона зовут auth() и ждут session.user.{id,email,type} — поэтому подменена
// именно эта функция, а не переписаны десятки её вызовов: обновление сверху
// трогает вызовы, а не подмену.
//
// 🔒 РОДНОЙ NextAuth ОСТАВЛЕН ЖИТЬ (nextAuth, handlers): его маршруты
// /api/auth/* продолжают отвечать. Снос чужого механизма ради своего — та самая
// правка, которая ссорится с каждым обновлением сверху.
//
// 🛑 ГОСТЕВОГО ВХОДА БОЛЬШЕ НЕТ ПО СМЫСЛУ: не вошедший человек сессии не
// получает вовсе — его уводит к службе входа proxy.ts.
export async function auth(): Promise<Session | null> {
  const s = await fracteraSession();
  if (!s) return null;

  const id = await chatUserIdFor(s.email);
  // 🔒 ФОРМА ОТВЕТА — ТА ЖЕ, ЧТО У ШАБЛОНА, ВКЛЮЧАЯ `expires`: вызывающие места
  // типизированы `Session`, и своя форма рядом сломала бы их все. Срок берём с
  // запасом суток: настоящий срок держит служба входа, здесь он лишь заполняет
  // обязательное поле.
  return {
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    user: { id, email: s.email, name: s.email, type: "regular" as UserType },
  } as Session;
}

