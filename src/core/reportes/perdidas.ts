import { prisma } from "@/lib/db";
import { redondearMoneda } from "@/core/movimientos/transiciones";
import { obtenerCostoActualPorMP, redondearCantidad, type Db } from "./comun";

export interface FilaPerdidaProducto {
  nombre: string;
  valor: number;
  sinPrecio: boolean;
}
export interface FilaPerdida {
  motivo: string;
  cantidad: number;
  valor: number;
  costoIncompleto: boolean;
  productos: FilaPerdidaProducto[];
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
 * son columnas tipadas (`MotivoMerma`/`DestinoConsumo`) — se agrupa
 * directo, sin parsing.
 */
export async function generarReportePerdidas(sucursalId: string, diasAtras: number, db: Db = prisma): Promise<ReportePerdidas> {
  const dias = diasAtras > 0 ? diasAtras : 30;
  const desde = new Date();
  desde.setUTCDate(desde.getUTCDate() - dias);
  desde.setUTCHours(0, 0, 0, 0);

  const costos = await obtenerCostoActualPorMP(sucursalId, db);
  const movimientos = await db.movimientoStock.findMany({
    where: { proceso: { in: ["MERMA", "CONSUMO"] }, seccion: { sucursalId }, operacion: { fecha: { gte: desde } } },
    select: { proceso: true, cantidad: true, productoId: true, producto: { select: { nombre: true } }, operacion: { select: { motivo: true, destino: true } } },
  });

  interface Acc {
    motivo: string;
    cantidad: number;
    valor: number;
    costoIncompleto: boolean;
    productos: Map<string, { valor: number; sinPrecio: boolean }>;
  }
  const acumular = (mapa: Map<string, Acc>, clave: string, productoId: string, productoNombre: string, cantidad: number) => {
    if (!mapa.has(clave)) mapa.set(clave, { motivo: clave, cantidad: 0, valor: 0, costoIncompleto: false, productos: new Map() });
    const g = mapa.get(clave)!;
    g.cantidad += cantidad;
    const costo = costos.get(productoId);
    const prev = g.productos.get(productoNombre) ?? { valor: 0, sinPrecio: false };
    if (costo) {
      const valorLinea = cantidad * costo.precioPorUnidadStock;
      g.valor += valorLinea;
      prev.valor += valorLinea;
    } else {
      g.costoIncompleto = true; // no inventar el costo: no se suma al total, se avisa
      prev.sinPrecio = true;
    }
    g.productos.set(productoNombre, prev);
  };

  const mermas = new Map<string, Acc>();
  const consumos = new Map<string, Acc>();

  for (const m of movimientos) {
    const cantidad = Math.abs(Number(m.cantidad));
    if (cantidad <= 0) continue;
    if (m.proceso === "MERMA") {
      acumular(mermas, m.operacion.motivo ?? "OTRO", m.productoId, m.producto.nombre, cantidad);
    } else {
      acumular(consumos, m.operacion.destino ?? SIN_DESTINO, m.productoId, m.producto.nombre, cantidad);
    }
  }

  const aLista = (mapa: Map<string, Acc>): FilaPerdida[] =>
    Array.from(mapa.values())
      .map((g) => ({
        motivo: g.motivo,
        cantidad: redondearCantidad(g.cantidad),
        valor: redondearMoneda(g.valor),
        costoIncompleto: g.costoIncompleto,
        productos: Array.from(g.productos.entries())
          .map(([nombre, info]) => ({ nombre, valor: redondearMoneda(info.valor), sinPrecio: info.sinPrecio }))
          .sort((a, b) => b.valor - a.valor),
      }))
      .sort((a, b) => b.valor - a.valor);

  const listaMermas = aLista(mermas);
  const listaConsumos = aLista(consumos);

  return {
    dias,
    desde,
    mermas: listaMermas,
    consumos: listaConsumos,
    hayCostoIncompleto: listaMermas.some((g) => g.costoIncompleto) || listaConsumos.some((g) => g.costoIncompleto),
    totalMerma: redondearMoneda(listaMermas.reduce((a, g) => a + g.valor, 0)),
    totalConsumo: redondearMoneda(listaConsumos.reduce((a, g) => a + g.valor, 0)),
  };
}
