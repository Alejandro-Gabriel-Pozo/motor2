import { prisma } from "@/lib/db";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { OpcionesTransaccion, Transaccion } from "@/lib/db-tipos";
import { datosDelRolDeEjecucion, verificarRolDeEjecucion, type DatosDelRol } from "./rol-de-ejecucion";

export interface BaseDelContexto {
  /** Base con la que opera el pedido. En el contexto de un usuario es la de su empresa activa (`dbDeEmpresa`): cada operación fija `app.empresa_id` en su transacción. */
  db: PrismaClient;
  /** Abre una transacción sobre `db`. Todo `$transaction` del negocio sale de acá, nunca de un cliente importado. */
  transaccion: Transaccion;
}

/** Base SIN empresa: para lo global (crons de índices y cotización, tablas sin `empresaId`). Lo que es de una empresa va por `baseDeEmpresa`. */
export function baseDelContexto(): BaseDelContexto {
  return { db: prisma, transaccion: (fn, opciones) => prisma.$transaction(fn, opciones) };
}

/**
 * Cliente cuyas operaciones corren con `app.empresa_id` = `empresaId` (ADR-007, A5): cada una se envuelve en una transacción
 * `[set_config('app.empresa_id', $1, true), operación]`. El `true` la hace LOCAL a la transacción: nada queda en la conexión, así que es
 * seguro con un pool o con pgbouncer en modo transacción (un `SET` de sesión se filtraría a otro pedido). El default de las columnas
 * `empresaId` (`app_empresa_actual()`) y, desde la Migración 2, las políticas RLS leen ese valor.
 *
 * Solo para operaciones sueltas: NO abrir `$transaction` sobre este cliente (usar `transaccionDeEmpresa`), porque el `set_config` va en una
 * transacción aparte y no alcanzaría a la interactiva. El cast a `PrismaClient` es solo de tipo: la extensión cambia el comportamiento,
 * no la forma del cliente.
 */
export function dbDeEmpresa(empresaId: string): PrismaClient {
  const conEmpresa = prisma.$extends({
    query: {
      async $allOperations({ args, query }) {
        const [, resultado] = await prisma.$transaction([prisma.$executeRaw`SELECT set_config('app.empresa_id', ${empresaId}, true)`, query(args)]);
        return resultado;
      },
    },
  });
  return conEmpresa as unknown as PrismaClient;
}

/**
 * Cliente cuyas operaciones corren con `app.usuario_id` = `usuarioId`: lo único que habilita la política `lectura_propia_usuario` de `UsuarioEmpresa`
 * (leer las pertenencias PROPIAS en cualquier empresa). Es para las lecturas que ocurren antes de tener empresa (login, resolución del contexto); todo
 * lo demás va con `dbDeEmpresa`. Mismo mecanismo que `dbDeEmpresa`: valor local a la transacción.
 */
export function dbDeUsuario(usuarioId: string): PrismaClient {
  const conUsuario = prisma.$extends({
    query: {
      async $allOperations({ args, query }) {
        const [, resultado] = await prisma.$transaction([prisma.$executeRaw`SELECT set_config('app.usuario_id', ${usuarioId}, true)`, query(args)]);
        return resultado;
      },
    },
  });
  return conUsuario as unknown as PrismaClient;
}

/** Transacción interactiva con `app.empresa_id` fijado (local a ella) ANTES de cualquier consulta de `fn`; el `tx` que recibe ya está bajo esa empresa. */
export function transaccionDeEmpresa<T>(empresaId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>, opciones?: OpcionesTransaccion): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${empresaId}, true)`;
    return fn(tx);
  }, opciones);
}

/** La base (`db` + `transaccion`) de una empresa: lo que `obtenerContextoUsuario` le da al negocio. */
export function baseDeEmpresa(empresaId: string): BaseDelContexto {
  return { db: dbDeEmpresa(empresaId), transaccion: (fn, opciones) => transaccionDeEmpresa(empresaId, fn, opciones) };
}

let datosDelRolDelProceso: Promise<DatosDelRol> | undefined;

/** `verificarRolDeEjecucion` sobre el cliente del proceso; lee el rol una sola vez y solo cuenta las empresas si el rol no es el sin privilegios. */
export async function verificarRolDeEjecucionDelProceso(): Promise<void> {
  datosDelRolDelProceso ??= datosDelRolDeEjecucion(prisma).catch((error) => {
    datosDelRolDelProceso = undefined;
    throw error;
  });
  await verificarRolDeEjecucion(prisma, await datosDelRolDelProceso, 0, process.env.MOTOR2_ROL_ESTRICTO === "1");
}
