import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { decidirInicioDeSesion } from "@/core/auth/acceso";
import { ACTUALIZAR_CADA_S, DURACION_SESION_S } from "@/core/auth/duracion-sesion";
import { nombreCookieSesion, sirvePorHttps, tokenDeSesionAbierta } from "@/core/auth/cookie-sesion";
import { nombreCookieInvitacion } from "@/core/auth/invitacion";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    // Sin `allowDangerousEmailAccountLinking` (E8, ADR-024): Auth.js NO vincula una cuenta de Google a un User que ya existe por tener el mismo email. Un User que ya existe y no
    // tiene Google (un precargado) entra solo si una invitación vincula su cuenta en el callback `signIn` (ver `decidirInicioDeSesion`); un email nuevo lo crea Auth.js sin conflicto.
    Google,
  ],
  // Sesión en base de datos (no JWT): coherente con el adapter de Prisma y
  // con que acá SÍ hay tabla de sesión real, a diferencia de Apps Script
  // (ver plan: "no hay tabla de sesiones, tokens ni JWT" era la limitación
  // que motivó reemplazar el modelo de auth entero).
  // Vence a las 12 horas sin actividad (ver duracion-sesion.ts); por defecto Auth.js la dejaba 30 días.
  session: { strategy: "database", maxAge: DURACION_SESION_S, updateAge: ACTUALIZAR_CADA_S },
  // En producción con https la cookie de sesión es `__Host-` (ver core/auth/cookie-sesion.ts): sin Domain, Path=/ y Secure forzados.
  cookies: {
    sessionToken: {
      name: nombreCookieSesion(process.env),
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: sirvePorHttps(process.env) },
    },
  },
  callbacks: {
    // Gate de acceso: rechaza el login ANTES de que el adapter cree
    // User/Account, para que una cuenta de Google fuera de la empresa (y
    // no dada de alta a mano) ni siquiera llegue a tener sesión. Detalle
    // de las reglas en inicioDeSesionPermitido (incluye no dejar vincular una cuenta de Google ajena a una sesión abierta).
    async signIn({ user, profile, account }) {
      if (!user.email || !profile?.email) return false;
      const hd = typeof profile.hd === "string" ? profile.hd : undefined;
      const cookieStore = await cookies();
      const tokenAbierto = tokenDeSesionAbierta((n) => cookieStore.get(n)?.value);
      const tokenDeInvitacion = cookieStore.get(nombreCookieInvitacion(process.env))?.value;
      // E8 (ADR-024): además del gate, decide si el usuario existente puede vincular su cuenta de Google (con una invitación) o si la cuenta es otra.
      return decidirInicioDeSesion({
        emailUsuario: user.email,
        emailPerfil: profile.email,
        emailVerificado: profile.email_verified === true,
        hd,
        tokenDeSesionAbierta: tokenAbierto,
        tokenDeInvitacion,
        cuenta: account ? { ...account, providerAccountId: account.providerAccountId } : null,
      });
    },
    // Kill-switch en vivo: con estrategia 'database', esto corre en CADA
    // request con sesión (auth() lo llama), no solo al loguearse — así que
    // desactivar User.activoGlobal corta el acceso en la request
    // siguiente, no recién quien la próxima vez que esa persona intente
    // volver a loguearse. No seteamos session.user.id: getUsuarioActual
    // (única puerta de lectura de sesión del proyecto) ya trata eso como
    // "sin sesión" (`if (!session?.user?.id...) return null`).
    async session({ session, user }) {
      if (session.user && user.activoGlobal) {
        session.user.id = user.id;
      }
      return session;
    },
  },
});
