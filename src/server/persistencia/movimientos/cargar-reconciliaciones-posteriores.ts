import "server-only";
import type { Prisma } from "@prisma/client";
import { OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION, type ReconciliacionPosterior } from "@/core/movimientos/public";

/**
 * Lo que reconcilió el stock DESPUÉS de una operación, para decidir si deshacerla (anular una venta o una compra, cancelar un conteo) lo desharía a ciegas (D7 del plan de endurecimiento de seguridad,
 * decidida por el dueño el 2026-10-08; S-03 / O.52 para la venta, I-1 / O.178 para el conteo sin movimiento, M-2 y M-3 de la auditoría final para cancelar un conteo y anular una compra). Una sola
 * lectura para los tres, para que la regla no se pueda desparejar. `tx` obligatorio, sin reglas de negocio: qué hacer con lo encontrado lo decide el núcleo.
 *
 * «Después» se mide con `creadoEn` (el reloj de la base al escribir), nunca con `fecha`: un conteo o un ajuste se pueden fechar para atrás, y seguirían habiendo reconciliado el stock DESPUÉS.
 * `gte` y no `gt`: en el mismo milisegundo se rechaza (fallo cerrado).
 */

/** Un (producto, sección) tocado por la operación que se quiere deshacer, y desde cuándo mirar (el `creadoEn` de esa operación). */
export interface AlcanceDeReconciliacion {
  creadoEn: Date;
  pares: readonly { productoId: string; seccionId: string }[];
}

/**
 * Los (producto, sección) de los `alcances` que tuvieron, desde su `creadoEn`, una de dos cosas, sin repetidos y con los nombres para el mensaje (hasta 20):
 *
 *  1. un CONTROL o un AJUSTE vigente (un conteo físico aplicado, un ajuste manual). NO cuentan: las reversiones por anulación (son AJUSTE, pero son el propio deshacer de otra venta o compra:
 *     `OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION`), ni lo que hace un conteo CANCELADO (el original y su reversión se anulan entre sí).
 *  2. un CONTEO FÍSICO que NO escribió movimiento (I-1 de la auditoría final): diferencia 0 («el stock ya coincidía»), «Falta movimiento», «Descartar» o un pendiente ya cerrado. Igual reconcilió (o dejó
 *     asentado) el stock contra lo contado, y `registrarConteoFisico` no escribe `Operación` en esos casos, así que la lectura 1 no lo ve. Se mira la fila del propio conteo (`ConteoFisico`), no CANCELADO.
 *
 * `soloConteos` (cancelar un conteo y anular una compra, M-2 y M-3): un AJUSTE MANUAL (sin conteo) no cuenta. Es el remedio que el propio rechazo indica («corregí con un ajuste de stock») y el que
 * el mensaje de `STOCK_CONSUMIDO` (M-7) da para destrabar una compra; y un ajuste es un delta, no la lectura de lo que hay físicamente. Sí cuenta todo lo que escribió un conteo no cancelado
 * (incluido un pendiente cerrado con «ajustar» después). La anulación de una venta no lo pone: su D7 dice CONTROL o AJUSTE.
 *
 * `excluirConteoId`: el conteo que se está cancelando no es «posterior» a sí mismo: ni su fila, ni las líneas del Kardex que él escribió (su ajuste, `conteoFisicoId`).
 */
export async function cargarReconciliacionesPosteriores(
  tx: Prisma.TransactionClient,
  args: { sucursalId: string; alcances: readonly AlcanceDeReconciliacion[]; excluirConteoId?: string; soloConteos?: boolean },
): Promise<ReconciliacionPosterior[]> {
  const { sucursalId, excluirConteoId, soloConteos = false } = args;
  const alcances = args.alcances.filter((a) => a.pares.length > 0);
  if (!alcances.length) return [];

  const controlesOAjustes = await tx.movimientoStock.findMany({
    where: {
      proceso: { in: ["CONTROL", "AJUSTE"] },
      AND: [
        // Venta: cualquier CONTROL/AJUSTE vigente (un conteo no cancelado o un ajuste manual). Conteo o compra (`soloConteos`): solo lo que escribió un conteo no cancelado.
        soloConteos ? { conteoFisico: { estado: { not: "CANCELADO" } } } : { OR: [{ conteoFisicoId: null }, { conteoFisico: { estado: { not: "CANCELADO" } } }] },
        // Un `not` sobre una columna que admite NULL deja afuera los NULL: se pide explícito.
        ...(excluirConteoId ? [{ OR: [{ conteoFisicoId: null }, { conteoFisicoId: { not: excluirConteoId } }] }] : []),
        {
          OR: alcances.map((a) => ({
            OR: [...a.pares],
            operacion: { AND: [OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION, { anuladaEn: null, creadoEn: { gte: a.creadoEn } }] },
          })),
        },
      ],
    },
    select: { producto: { select: { nombre: true } }, seccion: { select: { nombre: true } } },
    distinct: ["productoId", "seccionId"],
    orderBy: [{ productoId: "asc" }, { seccionId: "asc" }],
    take: 20,
  });

  const conteosSinMovimiento = await tx.conteoFisico.findMany({
    where: {
      sucursalId,
      estado: { not: "CANCELADO" },
      ...(excluirConteoId ? { id: { not: excluirConteoId } } : {}),
      OR: alcances.map((a) => ({ OR: [...a.pares], creadoEn: { gte: a.creadoEn } })),
    },
    select: { producto: { select: { nombre: true } }, seccion: { select: { nombre: true } } },
    distinct: ["productoId", "seccionId"],
    orderBy: [{ productoId: "asc" }, { seccionId: "asc" }],
    take: 20,
  });

  const porNombre = new Map<string, ReconciliacionPosterior>();
  for (const m of [...controlesOAjustes, ...conteosSinMovimiento]) {
    porNombre.set(`${m.producto.nombre}|${m.seccion.nombre}`, { productoNombre: m.producto.nombre, seccionNombre: m.seccion.nombre });
  }
  return [...porNombre.values()].slice(0, 20);
}
