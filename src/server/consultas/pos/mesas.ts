import "server-only";
import { armarMapaDeMesas, type MapaDeMesas } from "@/core/pos/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Lecturas del POS › Mapa de mesas para los Server Components (Task #41, Fase D8). Mismo contrato que el piloto
 * (`server/consultas/catalogo/productos.ts`): `server-only` sin `"use server"`, sin guarda de permiso adentro (la página hace
 * `requierePermisoVer` antes), `sucursalId` sale de `ctx` en el servidor, último parámetro `db: Db`, y devuelve
 * EXACTAMENTE lo que devolvía la consulta Prisma en línea que reemplaza.
 *
 * El mapa de mesas (`obtenerMapaDeMesas`) también vive acá desde la Fase 3 de pureza: la lectura es de esta capa y el armado (`armarMapaDeMesas`) es
 * puro, en `core/pos/mesas.ts`.
 */

/**
 * Límite de mesas abiertas de la sucursal (`/mesas`, «LimiteMesasAbiertas»): SOLO `{ maxMesasAbiertas }` (`null` = sin límite).
 * `findUniqueOrThrow` a propósito: la sucursal sale del contexto de la sesión, así que si no existe es un error, no «sin límite».
 */
export async function obtenerLimiteMesasAbiertas(sucursalId: string, db: Db) {
  return db.sucursal.findUniqueOrThrow({ where: { id: sucursalId }, select: { maxMesasAbiertas: true } });
}

/**
 * Todas las mesas de la sucursal, ordenadas por número, con su estado derivado — UNA sola consulta (mesas + cuenta abierta + ítems + quién la abrió). La página la
 * llama directo, después de `requierePermisoVer(…, "pos_mesas")`: no es una Server Action de lectura. `ahora` es OBLIGATORIO (O.22-a, Hito 4): lo fija la
 * pantalla en el borde.
 */
export async function obtenerMapaDeMesas(sucursalId: string, db: Db, ahora: Date): Promise<MapaDeMesas> {
  const filas = await db.mesa.findMany({
    where: { sucursalId, tipo: "SALON" }, // ADR-039: el puesto mostrador no es una mesa del mapa, ni cuenta en sus métricas ni en el «siguiente número»
    orderBy: { numero: "asc" },
    include: {
      cuentas: {
        where: { cerradaEn: null },
        include: {
          items: { select: { cantidad: true, precioUnitario: true, numeroEnvio: true } },
          abiertaPor: { select: { name: true, email: true } },
        },
      },
    },
  });

  return armarMapaDeMesas(
    filas.map((fila) => ({
      id: fila.id,
      numero: fila.numero,
      cuentas: fila.cuentas.map((cuenta) => ({
        abiertaEn: cuenta.abiertaEn,
        abiertaPor: cuenta.abiertaPor,
        items: cuenta.items.map((i) => ({ cantidad: Number(i.cantidad), precioUnitario: Number(i.precioUnitario), numeroEnvio: i.numeroEnvio })),
      })),
    })),
    ahora,
  );
}

/**
 * El puesto mostrador de la sucursal (ADR-039) y cuántas cuentas abiertas tiene, o `null` si todavía no se habilitó. Para la tarjeta «Mostrador» del mapa y la pantalla `/mesas/mostrador`; sin guarda
 * de permiso adentro (la página la pone antes). Aislada por sucursal: el mostrador de otra no se ve.
 */
export async function obtenerPuestoMostrador(sucursalId: string, db: Db): Promise<{ id: string; cuentasAbiertas: number } | null> {
  const puesto = await db.mesa.findFirst({
    where: { sucursalId, tipo: "MOSTRADOR" },
    select: { id: true, _count: { select: { cuentas: { where: { cerradaEn: null } } } } },
  });
  return puesto && { id: puesto.id, cuentasAbiertas: puesto._count.cuentas };
}
