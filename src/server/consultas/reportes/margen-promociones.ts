import "server-only";
import { redondearMoneda } from "@/core/moneda";
import { construirIndiceRecetas, construirMapaProductos } from "@/server/lecturas/reportes/comun";
import type { Db } from "@/lib/db-tipos";
import { calcularMargenRealDelPeriodo } from "@/server/consultas/reportes/margen-real";
import type { ItemParaMargenReal } from "@/core/reportes/public";
import type { FilaMargenPromocion, ReporteMargenPromociones, AcumuladoPromo } from "@/core/reportes/public";

const AVISO =
  'Margen Real: costo congelado al momento de cada venta, o reconstruido con el historial de compras cuando no se guardó (igual criterio que Período/Promociones/Descuentos por cliente); "parcial" si algún componente de esa promo no se pudo costear así — no cambia los importes de arriba, que son de precio, no de costo. "A lista" es lo que hubiera entrado vendiendo cada componente SUELTO a precio de carta, con el MISMO costo real: la diferencia contra lo cobrado es el ahorro que le dio la promo al cliente (D3), no un error de cobro.';

function reporteVacio(desde: Date, hasta: Date): ReporteMargenPromociones {
  return { desde, hasta, cantidadInstancias: 0, ingresoALista: 0, ingresoCobrado: 0, ahorroCliente: 0, promos: [], aviso: AVISO };
}

export async function obtenerReporteMargenPromociones(sucursalId: string, desde: Date, hasta: Date, db: Db): Promise<ReporteMargenPromociones> {
  const filas = await db.movimientoStock.findMany({
    where: { proceso: "VENTA", operacion: { sucursalId, fecha: { gte: desde, lte: hasta }, anuladaEn: null, promoCuentaId: { not: null } } },
    select: {
      productoId: true,
      cantidad: true,
      precioTotal: true,
      costoUnitarioVenta: true,
      operacionId: true,
      operacion: { select: { fecha: true, promoCuentaId: true, promoCuenta: { select: { promoCartaId: true } } } },
    },
  });
  if (!filas.length) return reporteVacio(desde, hasta);

  const operacionIds = filas.map((f) => f.operacionId);
  const [productos, indiceRecetas, componentes, promosCarta] = await Promise.all([
    construirMapaProductos(sucursalId, db),
    construirIndiceRecetas(db, sucursalId),
    db.cuentaItem.findMany({ where: { operacionId: { in: operacionIds } }, select: { operacionId: true, precioCartaUnitario: true } }),
    db.promoCarta.findMany({ where: { id: { in: [...new Set(filas.map((f) => f.operacion.promoCuenta!.promoCartaId))] } }, select: { id: true, titulo: true, activa: true } }),
  ]);
  const precioCartaPorOperacion = new Map(componentes.map((c) => [c.operacionId, c.precioCartaUnitario !== null ? Number(c.precioCartaUnitario) : null]));
  const promoCartaPorId = new Map(promosCarta.map((p) => [p.id, p]));

  // Costeo REAL de cada componente, en UNA sola pasada para TODAS las promos del rango (ver el docstring del módulo): el
  // costo de cada línea es el mismo sea cual sea el precio con el que se lo empareje después (cobrado o a lista).
  const items: ItemParaMargenReal[] = filas.map((f) => ({
    proceso: "VENTA" as const,
    anulada: false,
    productoId: f.productoId,
    cantidad: Math.abs(Number(f.cantidad)),
    precioTotal: Number(f.precioTotal),
    costoUnitarioVenta: f.costoUnitarioVenta !== null ? Number(f.costoUnitarioVenta) : null,
    fecha: f.operacion.fecha,
  }));
  const { costoPorItem } = await calcularMargenRealDelPeriodo(sucursalId, items, db, productos, indiceRecetas);

  const porPromo = new Map<string, AcumuladoPromo>();
  // Un componente es UNA operación aunque su stock propio salga de dos lotes (dos filas VENTA, O.40 (1)): se cuenta la primera fila de cada operación.
  const operacionesContadas = new Set<string>();
  filas.forEach((f, i) => {
    const promoCartaId = f.operacion.promoCuenta!.promoCartaId;
    const acc = porPromo.get(promoCartaId) ?? {
      titulo: promoCartaPorId.get(promoCartaId)?.titulo ?? "(promo dada de baja)",
      instancias: new Set<string>(),
      cantidadComponentes: 0,
      ingresoALista: 0,
      ingresoCobrado: 0,
      ingresoAListaConCosto: 0,
      ingresoCobradoConCosto: 0,
      costoRealTotal: 0,
      reconstruido: false,
      completo: true,
    };
    porPromo.set(promoCartaId, acc);

    const cantidad = items[i].cantidad;
    const precioCobrado = items[i].precioTotal;
    const precioCartaUnitario = precioCartaPorOperacion.get(f.operacionId) ?? null;
    // Defensivo: un componente de promo siempre trae `precioCartaUnitario` congelado (agregarItems lo escribe siempre) — sin
    // él, se cae al precio cobrado (ni ahorro ni resta de margen, en vez de inventar un número).
    const precioAListaTotal = precioCartaUnitario !== null ? cantidad * precioCartaUnitario : precioCobrado;

    acc.instancias.add(f.operacion.promoCuentaId!);
    if (!operacionesContadas.has(f.operacionId)) {
      operacionesContadas.add(f.operacionId);
      acc.cantidadComponentes += 1;
    }
    acc.ingresoALista += precioAListaTotal;
    acc.ingresoCobrado += precioCobrado;

    const costo = costoPorItem[i];
    if (costo !== null) {
      acc.costoRealTotal += costo;
      acc.ingresoAListaConCosto += precioAListaTotal;
      acc.ingresoCobradoConCosto += precioCobrado;
      if (items[i].costoUnitarioVenta === null) acc.reconstruido = true;
    } else {
      acc.completo = false;
    }
  });

  const promos: FilaMargenPromocion[] = [...porPromo.entries()].map(([promoCartaId, acc]) => {
    const ingresoALista = redondearMoneda(acc.ingresoALista);
    const ingresoCobrado = redondearMoneda(acc.ingresoCobrado);
    const ahorroCliente = redondearMoneda(acc.ingresoALista - acc.ingresoCobrado);
    const hayCostoReal = acc.ingresoCobradoConCosto > 0;
    const margenReal = hayCostoReal ? redondearMoneda(acc.ingresoCobradoConCosto - acc.costoRealTotal) : null;
    const margenRealSueltoEquivalente = hayCostoReal ? redondearMoneda(acc.ingresoAListaConCosto - acc.costoRealTotal) : null;
    return {
      promoCartaId,
      titulo: acc.titulo,
      activa: promoCartaPorId.get(promoCartaId)?.activa ?? false,
      cantidadInstancias: acc.instancias.size,
      cantidadComponentes: acc.cantidadComponentes,
      ingresoALista,
      ingresoCobrado,
      ahorroCliente,
      ahorroClientePct: ingresoALista > 0 ? Math.round((ahorroCliente / ingresoALista) * 1000) / 10 : null,
      margenReal,
      margenRealPct: margenReal !== null && acc.ingresoCobradoConCosto > 0 ? Math.round((margenReal / acc.ingresoCobradoConCosto) * 1000) / 10 : null,
      margenRealSueltoEquivalente,
      margenRealSueltoEquivalentePct: margenRealSueltoEquivalente !== null && acc.ingresoAListaConCosto > 0 ? Math.round((margenRealSueltoEquivalente / acc.ingresoAListaConCosto) * 1000) / 10 : null,
      margenRealReconstruido: acc.reconstruido,
      margenRealCompleto: acc.completo,
    };
  });

  const ingresoALista = redondearMoneda(promos.reduce((s, p) => s + p.ingresoALista, 0));
  const ingresoCobrado = redondearMoneda(promos.reduce((s, p) => s + p.ingresoCobrado, 0));
  return {
    desde,
    hasta,
    cantidadInstancias: promos.reduce((s, p) => s + p.cantidadInstancias, 0),
    ingresoALista,
    ingresoCobrado,
    ahorroCliente: redondearMoneda(ingresoALista - ingresoCobrado),
    promos: promos.sort((a, b) => b.ingresoCobrado - a.ingresoCobrado),
    aviso: AVISO,
  };
}