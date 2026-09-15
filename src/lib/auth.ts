import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { intentarBootstrapAdmin } from "@/core/auth/bootstrap";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      // Un admin puede pre-cargar el email de alguien en UsuarioSucursal
      // (agregarOActualizarUsuario/crearSucursalConAdmin) ANTES de que esa
      // persona haga login por primera vez — sin esto, Auth.js rechazaría
      // vincular esa cuenta de Google al User ya existente por seguridad
      // (protección pensada para signup público). Acá es aceptable: todos
      // los usuarios son cuentas Google del mismo negocio, dadas de alta a
      // mano por un admin — no hay signup público.
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  // Sesión en base de datos (no JWT): coherente con el adapter de Prisma y
  // con que acá SÍ hay tabla de sesión real, a diferencia de Apps Script
  // (ver plan: "no hay tabla de sesiones, tokens ni JWT" era la limitación
  // que motivó reemplazar el modelo de auth entero).
  session: { strategy: "database" },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (user.id && user.email) {
        await intentarBootstrapAdmin(user.id, user.email);
      }
    },
  },
});
