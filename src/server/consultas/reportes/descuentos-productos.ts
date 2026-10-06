import { importeDeLinea, redondearMoneda } from "@/core/moneda";
import type { Db } from "@/lib/db-tipos";
import type { FilaDescuentoProducto, ReporteDescuentosProductos } from "@/core/reportes/public";

function porcentaje(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : null;
}

export async function obtenerReporteDescuentosProductos(sucursalId: string, desde: Date, hasta: Date, db: Db): Promise<ReporteDescuentosProductos> {
  const items = await db.cuentaItem.findMany({
    where: {
      precioCartaUnitario: { not: null },
      promoCuentaId: null,
      operacionId: { not: null },
      operacion: { sucursalId, fecha: { gte: desde, lte: hasta }, anuladaEn: null },
    },
    select: {
      productoId: true,
      cantidad: true,
      precioUnitario: true,
      precioCartaUnitario: true,
      operacionId: true,
      producto: { select: { codigo: true, nombre: true } },
    },
  });

  const operacionIds = [...new Set(items.map((i) => i.operacionId!))];
  const ganoElCliente = new Set<string>();
  if (operacionIds.length) {
    const ventas = await db.movimientoStock.findMany({
      where: { proceso: "VENTA", operacionId: { in: operacionIds }, precioListaUnitario: { not: null }, operacion: { anuladaEn: null } },
      select: { operacionId: true },
    });
    for (const v of ventas) ganoElCliente.add(v.operacionId);
  }

  const porProducto = new Map<string, { codigo: string; nombre: string; unidades: number; aLista: number; cobrado: number }>();
  for (const i of items) {
    if (ganoElCliente.has(i.operacionId!)) continue;
    const cantidad = Number(i.cantidad);
    const acc = porProducto.get(i.productoId) ?? { codigo: i.producto.codigo, nombre: i.producto.nombre, unidades: 0, aLista: 0, cobrado: 0 };
    acc.unidades += cantidad;
    acc.aLista += importeDeLinea(cantidad, Number(i.precioCartaUnitario));
    acc.cobrado += importeDeLinea(cantidad, Number(i.precioUnitario));
    porProducto.set(i.productoId, acc);
  }

  const productos: FilaDescuentoProducto[] = [];
  let totalALista = 0;
  let totalCobrado = 0;
  for (const [productoId, a] of porProducto) {
    if (a.unidades === 0) continue; // todo anulado: no hubo venta neta
    const importeALista = redondearMoneda(a.aLista);
    const importeCobrado = redondearMoneda(a.cobrado);
    const ahorro = redondearMoneda(importeALista - importeCobrado);
    totalALista += importeALista;
    totalCobrado += importeCobrado;
    productos.push({
      productoId,
      codigo: a.codigo,
      producto: a.nombre,
      unidades: redondearMoneda(a.unidades),
      importeALista,
      importeCobrado,
      ahorro,
      descuentoEfectivoPct: porcentaje(ahorro, importeALista),
    });
  }

  const importeALista = redondearMoneda(totalALista);
  const importeCobrado = redondearMoneda(totalCobrado);
  const ahorro = redondearMoneda(importeALista - importeCobrado);
  return {
    desde,
    hasta,
    importeALista,
    importeCobrado,
    ahorro,
    descuentoEfectivoPct: porcentaje(ahorro, importeALista),
    productos: productos.sort((a, b) => b.ahorro - a.ahorro),
  };
}