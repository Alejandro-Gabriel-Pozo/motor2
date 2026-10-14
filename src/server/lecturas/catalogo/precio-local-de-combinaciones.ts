import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { precioLocalActivoEn } from "./precio-local";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * GO-3b (ADR-032, D-4): el ÚNICO lugar que lee el precio de una COMBINACIÓN o de una TARIFA (grupo de precio) por sucursal (`PrecioLocalDeCombinacion`, ADR-009 familia `override`; lo fija
 * `test/arquitectura/precio-local-en-un-solo-lugar.test.ts`). La venta decide el precio con `preciosLocalesDeCombinacionVigentes` y la administración lee la fila anterior con
 * `filaDePrecioLocalDeCombinacion`. La capacidad `precio_local` se sigue preguntando en un solo lugar: `precioLocalActivoEn` de `precio-local.ts`.
 *
 * Archivo PROPIO al lado de `precio-local.ts` (como la grilla de las opciones, GO-2a): la carta pública alcanza `precio-local.ts` y su guardián de la lista cerrada junta los campos de todo archivo que
 * alcanza; las combinaciones no están en la carta pública todavía.
 */

/**
 * Los precios locales VIGENTES de la sucursal para estas combinaciones y estas tarifas: rige una fila solo si la sucursal tiene prendida la capacidad `precio_local` (el interruptor único de todo
 * precio propio) y la fila está habilitada. Lo que no está en los mapas se cobra al precio de la empresa. Dos consultas (sin ids, ninguna).
 */
export async function preciosLocalesDeCombinacionVigentes(
  sucursalId: string,
  db: Db,
  ids: { combinacionIds: readonly string[]; grupoDePrecioIds: readonly string[] },
  precioLocalActivo?: boolean | Promise<boolean>,
): Promise<{ porCombinacion: Map<string, number>; porGrupo: Map<string, number> }> {
  const vacio = { porCombinacion: new Map<string, number>(), porGrupo: new Map<string, number>() };
  if (ids.combinacionIds.length === 0 && ids.grupoDePrecioIds.length === 0) return vacio;
  const [capacidadActiva, filas] = await Promise.all([
    precioLocalActivo ?? precioLocalActivoEn(sucursalId, db),
    db.precioLocalDeCombinacion.findMany({
      where: { sucursalId, habilitado: true, OR: [{ combinacionId: { in: [...ids.combinacionIds] } }, { grupoDePrecioId: { in: [...ids.grupoDePrecioIds] } }] },
      select: { combinacionId: true, grupoDePrecioId: true, precio: true },
    }),
  ]);
  if (!capacidadActiva) return vacio;
  for (const f of filas) {
    if (f.combinacionId !== null) vacio.porCombinacion.set(f.combinacionId, Number(f.precio));
    else if (f.grupoDePrecioId !== null) vacio.porGrupo.set(f.grupoDePrecioId, Number(f.precio));
  }
  return vacio;
}

/** La fila del precio local de una combinación o de una tarifa en la sucursal, tal cual está (habilitada o no), o `null`. La lee el caso de uso que la edita, DENTRO de su transacción. */
export async function filaDePrecioLocalDeCombinacion(
  db: Db,
  clave: { sucursalId: string; objetivo: { combinacionId: string } | { grupoDePrecioId: string } },
): Promise<{ precio: number; habilitado: boolean } | null> {
  const fila = await db.precioLocalDeCombinacion.findFirst({ where: { sucursalId: clave.sucursalId, ...clave.objetivo }, select: { precio: true, habilitado: true } });
  return fila ? { precio: Number(fila.precio), habilitado: fila.habilitado } : null;
}
