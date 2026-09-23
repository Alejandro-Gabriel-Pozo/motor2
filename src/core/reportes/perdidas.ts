import { prisma } from "@/lib/db";
import { redondearMoneda } from "@/core/movimientos/transiciones";
import { EQUIVALENCIA_DESTINO_CONSUMO_LEGACY, EQUIVALENCIA_MOTIVO_MERMA_LEGACY } from "@/core/movimientos/motivos-semilla";
import { obtenerCostoActualPorMP, redondearCantidad, type Db } from "./comun";

export interface FilaPerdida {
  idMovimiento: string;
  idOperacion: string;
  fecha: Date;
  motivo: string;
  producto: string;
  productoId: string;
  cantidad: number;
  valor: number;
  sinPrecio: boolean;
}
export interface ReportePerdidas {
  dias: number;
  desde: Date;
  mermas: FilaPerdida[];
  consumos: FilaPerdida[];
  hayCostoIncompleto: boolean;
  totalMerma: number;
  totalConsumo: number;
}

/** Consumo generado solo (receta de Venta/Producción) — Operacion.destino queda null porque Operacion.proceso ahí es VENTA/PRODUCCION, no CONSUMO. */
const SIN_DESTINO = "(automático por receta)";

/**
 * Port de generarReportePerdidas_ (Reportes.js:1832-1912) — valoriza cada
 * merma/consumo con el costo de reposición del insumo (mismo criterio que
 * el costeo de recetas). A diferencia del original (el motivo viajaba
 * plegado en texto libre dentro del detalle, "Proceso: Motivo — libre", y
 * había que parsearlo con una regex), acá `Operacion.motivo`/`.destino`
 * son columnas tipadas — se agrupa directo, sin parsing.
 *
 * `FilaPerdida.motivo` ya viene resuelto a su nombre legible (p. ej.
 * "Vencido", no "VENCIDO") — plan "motivos de Consumo/Merma como catálogo
 * administrable" (2026-09-23), P4: prioriza `motivoCatalogo`/
 * `destinoCatalogo` (la fila del catálogo nuevo, cuando `registrarMovimiento`
 * ya la setee — P5) y cae a `motivoLegacy`/`destinoLegacy` traducido vía
 * `EQUIVALENCIA_*_LEGACY` mientras tanto. Quien consume este reporte (
 * `tabla-perdidas.tsx`) ya no necesita su propio Map enum→label.
 *
 * Una fila POR EVENTO (no acumulado por motivo) desde
 * docs/comparativa-ux-erpnext-dolibarr.md §8.4: el acumulado por motivo no
 * tenía fecha ni producto por fila, así que "¿qué se rompió? ¿cuándo?" no
 * tenía respuesta sin ir a mirar la base. Cada fila linkea a
 * `idOperacion` para el detalle completo (sección, resto de la
 * operación) en Trazabilidad, en vez de duplicar esos datos acá.
 */
export async function generarReportePerdidas(sucursalId: string, diasAtras: number, db: Db = prisma): Promise<ReportePerdidas> {
  const dias = diasAtras > 0 ? diasAtras : 30;
  const desde = new Date();
  desde.setUTCDate(desde.getUTCDate() - dias);
  desde.setUTCHours(0, 0, 0, 0);

  const costos = await obtenerCostoActualPorMP(sucursalId, db);
  const movimientos = await db.movimientoStock.findMany({
    // El consumo automático por receta de una venta ANULADA no es una pérdida ni un consumo: la venta no ocurrió.
    where: { proceso: { in: ["MERMA", "CONSUMO"] }, seccion: { sucursalId }, operacion: { fecha: { gte: desde }, anuladaEn: null } },
    select: {
      id: true,
      operacionId: true,
      proceso: true,
      cantidad: true,
      productoId: true,
      producto: { select: { nombre: true } },
      operacion: {
        select: {
          fecha: true,
          motivoLegacy: true,
          destinoLegacy: true,
          motivoCatalogo: { select: { nombre: true } },
          destinoCatalogo: { select: { nombre: true } },
        },
      },
    },
    orderBy: { operacion: { fecha: "desc" } },
  });

  const mermas: FilaPerdida[] = [];
  const consumos: FilaPerdida[] = [];

  for (const m of movimientos) {
    const cantidad = Math.abs(Number(m.cantidad));
    if (cantidad <= 0) continue;

    const costo = costos.get(m.productoId);
    const fila: FilaPerdida = {
      idMovimiento: m.id,
      idOperacion: m.operacionId,
      fecha: m.operacion.fecha,
      motivo:
        m.proceso === "MERMA"
          ? (m.operacion.motivoCatalogo?.nombre ??
            (m.operacion.motivoLegacy ? EQUIVALENCIA_MOTIVO_MERMA_LEGACY[m.operacion.motivoLegacy] : undefined) ??
            "Otro")
          : (m.operacion.destinoCatalogo?.nombre ??
            (m.operacion.destinoLegacy ? EQUIVALENCIA_DESTINO_CONSUMO_LEGACY[m.operacion.destinoLegacy] : undefined) ??
            SIN_DESTINO),
      producto: m.producto.nombre,
      productoId: m.productoId,
      cantidad: redondearCantidad(cantidad),
      valor: costo ? redondearMoneda(cantidad * costo.precioPorUnidadStock) : 0, // no inventar el costo: no se suma al total, se avisa (sinPrecio)
      sinPrecio: !costo,
    };

    if (m.proceso === "MERMA") mermas.push(fila);
    else consumos.push(fila);
  }

  return {
    dias,
    desde,
    mermas,
    consumos,
    hayCostoIncompleto: mermas.some((f) => f.sinPrecio) || consumos.some((f) => f.sinPrecio),
    totalMerma: redondearMoneda(mermas.reduce((a, f) => a + f.valor, 0)),
    totalConsumo: redondearMoneda(consumos.reduce((a, f) => a + f.valor, 0)),
  };
}
