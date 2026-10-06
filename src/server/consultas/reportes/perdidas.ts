import { redondearMoneda } from "@/core/moneda";
import { obtenerCostoActualPorMP } from "@/core/reportes/public-servidor";
import type { Db } from "@/lib/db-tipos";
import { redondearCantidad } from "@/core/reportes/public";
import { ZONA_UTC, inicioDelDiaDe } from "@/core/tiempo/zona-horaria";
import type { FilaPerdida, ReportePerdidas } from "@/core/reportes/public";

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
 * "Vencido") — plan "motivos de Consumo/Merma como catálogo administrable"
 * (2026-09-23): lee `motivo`/`destino` (la relación al catálogo nuevo)
 * directo desde P8 (antes, P3 a P7, priorizaba esa relación y caía a un
 * fallback del enum legacy mientras convivían las dos columnas — ya no
 * existe ninguna operación sin motivoId/destinoId, y la columna legacy ni
 * siquiera existe más). Quien consume este reporte (`tabla-perdidas.tsx`)
 * no necesita ningún Map enum→label.
 *
 * Una fila POR EVENTO (no acumulado por motivo) desde
 * docs/comparativa-ux-erpnext-dolibarr.md §8.4: el acumulado por motivo no
 * tenía fecha ni producto por fila, así que "¿qué se rompió? ¿cuándo?" no
 * tenía respuesta sin ir a mirar la base. Cada fila linkea a
 * `idOperacion` para el detalle completo (sección, resto de la
 * operación) en Trazabilidad, en vez de duplicar esos datos acá.
 */
export async function generarReportePerdidas(sucursalId: string, diasAtras: number, db: Db): Promise<ReportePerdidas> {
  const dias = diasAtras > 0 ? diasAtras : 30;
  const haceNDias = new Date();
  haceNDias.setUTCDate(haceNDias.getUTCDate() - dias);
  const desde = inicioDelDiaDe(haceNDias, ZONA_UTC);

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
          motivo: { select: { nombre: true } },
          destino: { select: { nombre: true } },
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
      motivo: m.proceso === "MERMA" ? (m.operacion.motivo?.nombre ?? "Otro") : (m.operacion.destino?.nombre ?? SIN_DESTINO),
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