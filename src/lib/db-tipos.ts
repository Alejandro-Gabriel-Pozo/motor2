import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Cliente con el que se lee o escribe: el de la sesión (`ctx.db`) o el `tx` de una transacción (`ctx.transaccion(async (tx) => ...)`).
 * Es el tipo del parámetro `db` de las funciones de `core/` y `server/consultas/`: así la misma lectura sirve suelta o dentro de
 * una transacción, sin abrir una conexión propia. Solo tipos: importarlo NO trae el cliente (eso es `src/lib/db.ts`, que solo
 * pueden importar `core/auth`, `lib/auth.ts`, la resolución pública de la carta y `api/cron`).
 */
export type Db = PrismaClient | Prisma.TransactionClient;

export interface OpcionesTransaccion {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/** `ctx.transaccion`: abre una transacción sobre la base del contexto y le pasa el cliente `tx`. */
export type Transaccion = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, opciones?: OpcionesTransaccion) => Promise<T>;
