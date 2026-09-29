import { prisma } from "@/lib/db";
import type { PrismaClient } from "@prisma/client";
import type { Transaccion } from "@/lib/db-tipos";

export interface BaseDelContexto {
  /** Base con la que opera el pedido. Hoy es el cliente único de la instalación; con RLS (ADR-007) pasa a ser la base de la empresa activa. */
  db: PrismaClient;
  /** Abre una transacción sobre `db`. Todo `$transaction` del negocio sale de acá, nunca de un cliente importado. */
  transaccion: Transaccion;
}

/** El único punto donde un pedido elige contra qué cliente opera (ADR-007, paso N2). */
export function baseDelContexto(): BaseDelContexto {
  return { db: prisma, transaccion: (fn, opciones) => prisma.$transaction(fn, opciones) };
}
