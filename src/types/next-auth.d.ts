import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

// La interfaz AdapterUser vive realmente en @auth/core/adapters — next-auth/adapters
// solo la re-exporta, así que el augment tiene que apuntar al módulo de origen.
declare module "@auth/core/adapters" {
  interface AdapterUser {
    /** Kill-switch de cuenta (User.activoGlobal, prisma/schema.prisma) — leído en el callback `session` de src/lib/auth.ts. */
    activoGlobal: boolean;
  }
}
