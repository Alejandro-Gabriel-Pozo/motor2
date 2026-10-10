import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { AccionDeSucursal } from "@/core/permisos/acciones";
import { sucursalesDondeElUsuarioPuedeVer } from "./gate";

/**
 * El ORIGEN de una copia entre sucursales (la receta propia o la carta propia de OTRA sucursal que se copia a la activa; ADR-009), con el chequeo que antes no tenía
 * (S-07 del plan de endurecimiento de seguridad, fila O.56 de `docs/pureza-integracion.md`): la RLS separa empresas, NO sucursales, así que el origen que llega por id
 * se buscaba solo bajo la empresa y un administrador de la sucursal 1 copiaba la receta y la carta de una sucursal 2 donde no tiene ni membresía. Ahora leer el origen
 * exige lo mismo que ver esa sucursal por la puerta de siempre: membresía vigente en el ORIGEN y «Ver» de `clave` allá (`sucursalesDondeElUsuarioPuedeVer`: membresía y
 * rol activos, módulo, capacidad y fila del rol, con el piso de la clave), y que el origen esté activo.
 *
 * Dos respuestas, en este orden: `NO_ENCONTRADO` («No se encontró esa sucursal.»: no existe en la empresa —la RLS esconde las ajenas—, está desactivada o el id no es un
 * texto) y `SIN_ACCESO` («No tenés acceso a esa sucursal.»: existe pero el usuario no tiene el «Ver» allá). La segunda se decide ANTES de mirar qué tiene el origen: una
 * sucursal con receta o carta y una sin nada contestan lo mismo (no hay oráculo sobre lo que guarda), y ningún mensaje nombra la sucursal.
 *
 * El caso de uso lo llama con el `db` del contexto (la decisión de acceso no va dentro de la transacción de la copia, como el gate de las otras sucursales de
 * `invitacionGestionable`).
 *
 * M.3-A5 (alcance por sucursal): esta función es el GATE del origen y no ensancha nada. Quien la llama, SOLO si devolvió `ok`, ensancha la LECTURA del contexto al origen
 * (`conAlcanceEnSucursal(…, origen, "LECTURA")`) para leer lo que se copia; la escritura de la copia es siempre de la sucursal activa. El orden lo exige
 * `ids-de-sucursal-declaran-a-que-se-atan.test.ts` (forma `MEMBRESIA_EN_ORIGEN`, ensanche `CABLEADO`).
 */

const MENSAJE_ORIGEN_NO_ENCONTRADO = "No se encontró esa sucursal.";
const MENSAJE_ORIGEN_SIN_ACCESO = "No tenés acceso a esa sucursal.";

export type OrigenDeCopia = { ok: true; nombre: string } | { ok: false; codigo: "NO_ENCONTRADO" | "SIN_ACCESO"; mensaje: string };

export async function leerOrigenDeCopia(actor: { usuarioId: string; db: PrismaClient }, sucursalOrigenId: unknown, clave: AccionDeSucursal): Promise<OrigenDeCopia> {
  const noEncontrado = { ok: false, codigo: "NO_ENCONTRADO", mensaje: MENSAJE_ORIGEN_NO_ENCONTRADO } as const;
  // Desde la red llega cualquier cosa: un id que no es texto (un objeto de filtro, por ejemplo) no se le pasa a la base.
  if (typeof sucursalOrigenId !== "string") return noEncontrado;
  const origen = await actor.db.sucursal.findUnique({ where: { id: sucursalOrigenId }, select: { nombre: true, activo: true } });
  if (!origen || !origen.activo) return noEncontrado;
  const visibles = await sucursalesDondeElUsuarioPuedeVer(actor.usuarioId, [sucursalOrigenId], clave, actor.db);
  if (!visibles.has(sucursalOrigenId)) return { ok: false, codigo: "SIN_ACCESO", mensaje: MENSAJE_ORIGEN_SIN_ACCESO };
  return { ok: true, nombre: origen.nombre };
}
