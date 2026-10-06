import { redondearMoneda } from "@/core/moneda";
import { tieneStockReal } from "@/core/movimientos/public";
import { obtenerCostoActualPorMP, redondearCantidad, type Db } from "./comun";
import { whereDisponibleEn } from "@/core/catalogo/public-servidor";

export interface FilaValuacionInventario {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  insumoNombre: string | null;
  unidadStockNombre: string;
  saldo: number;
  costoUnitario: number | null;
  valor: number | null;
  proveedorNombre: string | null;
  sinCosto: boolean;
}

export interface ReporteValuacionInventario {
  filas: FilaValuacionInventario[];
  totalValorizado: number;
  cantidadSinCosto: number;
}

/**
 * Nuevo reporte (no existe en Apps Script): cuánto vale hoy el stock de esta
 * sucursal, valorizado al mismo costo de reposición que ya usa Costos y
 * márgenes (`obtenerCostoActualPorMP` — precio de la compra local más
 * reciente). No es un método de costeo nuevo (PMP/FIFO): reutiliza la misma
 * filosofía de negocio ya documentada, solo que agregada por producto en
 * vez de por receta.
 *
 * Mismo criterio que `calcularCostosYMargenes`: un producto con saldo > 0
 * pero sin ninguna compra registrada queda `sinCosto` y afuera del total —
 * no se inventa un valor a partir de nada.
 */
export async function calcularValuacionInventario(sucursalId: string, db: Db): Promise<ReporteValuacionInventario> {
  const productos = await db.producto.findMany({
    where: whereDisponibleEn(sucursalId),
    include: { unidadStock: true, insumo: true },
  });
  const elegibles = productos.filter((p) => tieneStockReal(p.tipo, p.seProduce));
  const productoPorId = new Map(elegibles.map((p) => [p.id, p]));

  const [saldos, costos] = await Promise.all([
    db.movimientoStock.groupBy({
      by: ["productoId"],
      where: { producto: whereDisponibleEn(sucursalId), seccion: { sucursalId } },
      _sum: { cantidad: true },
    }),
    obtenerCostoActualPorMP(sucursalId, db),
  ]);

  const filas: FilaValuacionInventario[] = [];
  let totalValorizado = 0;
  let cantidadSinCosto = 0;

  for (const s of saldos) {
    const producto = productoPorId.get(s.productoId);
    if (!producto) continue; // no elegible (ni MP ni PV "Se produce") o inactivo

    const saldo = redondearCantidad(Number(s._sum.cantidad ?? 0));
    if (saldo <= 0) continue; // sin stock hoy, no aporta valor

    const costo = costos.get(s.productoId);
    const sinCosto = !costo;
    const valor = costo ? redondearMoneda(saldo * costo.precioPorUnidadStock) : null;

    if (sinCosto) cantidadSinCosto++;
    else totalValorizado += valor!;

    filas.push({
      productoId: producto.id,
      productoCodigo: producto.codigo,
      productoNombre: producto.nombre,
      insumoNombre: producto.insumo?.nombre ?? null,
      unidadStockNombre: producto.unidadStock.nombre,
      saldo,
      costoUnitario: costo ? redondearMoneda(costo.precioPorUnidadStock) : null,
      valor,
      proveedorNombre: costo?.proveedorNombre ?? null,
      sinCosto,
    });
  }

  filas.sort((a, b) => (b.valor ?? -1) - (a.valor ?? -1) || a.productoNombre.localeCompare(b.productoNombre));

  return { filas, totalValorizado: redondearMoneda(totalValorizado), cantidadSinCosto };
}
