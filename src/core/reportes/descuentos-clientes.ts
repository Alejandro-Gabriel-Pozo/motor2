import { prisma } from "@/lib/db";
import { importeDeLinea } from "@/core/moneda";
import { redondearMoneda } from "@/core/movimientos/transiciones";
import { construirIndiceRecetas, construirMapaProductos, type Db } from "./comun";
import { calcularMargenRealDelPeriodo, type ItemParaMargenReal } from "./margen-real";

/**
 * Reporte de descuentos por cliente (Task #14, docs/plan-clientes-descuento-2026-09-26.md, punto 10 — último del plan): cuánto se
 * "regaló" en el período, por cliente, y si ese descuento se comió el margen. Fuente: `MovimientoStock` de proceso VENTA con
 * `Operacion.clienteId` no nulo (asignado desde `asignarClienteACuenta`) — el precio COBRADO ya está en `precioTotal`/
 * `precioPorUnidadStock` (los mismos campos de siempre: nada de esta Task cambió su significado), y el de LISTA en
 * `precioListaUnitario` cuando el descuento hizo que difiriera (`null` en una línea de un cliente con 0% de descuento).
 *
 * Margen COBRADO vs. margen A LISTA: se costea la MISMA venta dos veces con `calcularMargenRealDelPeriodo` (src/core/reportes/
 * margen-real.ts, el motor extraído de Período en el punto 8 de este mismo plan) — una con el precio cobrado (de siempre) y otra
 * con el de lista —, así el costo real de cada línea (congelado al vender, o reconstruido con el historial de compras) es
 * IDÉNTICO en las dos cuentas y la diferencia entre ambos márgenes es, centavo a centavo, el descuento que salió del margen. Dos
 * pasadas por cliente (no una global) porque lo que importa acá es la fila POR CLIENTE, no un total de la sucursal.
 */

export interface FilaDescuentoCliente {
  clienteId: string;
  cliente: string;
  /** Líneas VENTA netas de este cliente en el rango (una por `Operacion` — ver el docstring del módulo). */
  cantidadVentas: number;
  unidadesVendidas: number;
  ingresoALista: number;
  ingresoCobrado: number;
  /** `ingresoALista - ingresoCobrado`, exacto (aritmética de precios, no depende de ningún costo). */
  totalDescontado: number;
  /** `totalDescontado / ingresoALista`, en % — `null` sin ingreso de lista (no debería pasar con `cantidadVentas > 0`). */
  descuentoEfectivoPct: number | null;
  /** Margen Real sobre lo COBRADO (lo que de verdad entró) — `null` si ninguna venta de este cliente se pudo costear. */
  margenReal: number | null;
  margenRealPct: number | null;
  /** Margen Real que hubiera dado la MISMA venta sin el descuento (a precio de lista, mismo costo real) — para ver si el
   *  descuento dejó al cliente con un margen sano o directamente sin margen. */
  margenRealALista: number | null;
  margenRealAListaPct: number | null;
  /** Alguna parte de `margenReal`/`margenRealALista` se reconstruyó con el historial de compras (no se guardó al vender). */
  margenRealReconstruido: boolean;
  /** `false` si alguna venta de este cliente quedó afuera del margen Real — el número no cubre el 100% de lo vendido. */
  margenRealCompleto: boolean;
}

export interface ReporteDescuentosClientes {
  desde: Date;
  hasta: Date;
  ingresoALista: number;
  ingresoCobrado: number;
  totalDescontado: number;
  descuentoEfectivoPct: number | null;
  clientes: FilaDescuentoCliente[];
  aviso: string;
}

const AVISO =
  'Margen Real: costo congelado al momento de cada venta, o reconstruido con el historial de compras cuando no se guardó (igual criterio que Período/Promociones); "parcial" si alguna venta de ese cliente no se pudo costear así — no cambia los importes de arriba, que son de precio, no de costo.';

/** Sin ninguna venta con cliente en el rango: reporte vacío, sin tocar el motor de margen. */
function reporteVacio(desde: Date, hasta: Date): ReporteDescuentosClientes {
  return { desde, hasta, ingresoALista: 0, ingresoCobrado: 0, totalDescontado: 0, descuentoEfectivoPct: null, clientes: [], aviso: AVISO };
}

export async function obtenerReporteDescuentosClientes(sucursalId: string, desde: Date, hasta: Date, db: Db = prisma): Promise<ReporteDescuentosClientes> {
  const filas = await db.movimientoStock.findMany({
    where: {
      proceso: "VENTA",
      operacion: { sucursalId, fecha: { gte: desde, lte: hasta }, anuladaEn: null, clienteId: { not: null } },
    },
    select: {
      productoId: true,
      cantidad: true,
      precioTotal: true,
      precioListaUnitario: true,
      costoUnitarioVenta: true,
      operacion: { select: { fecha: true, clienteId: true, cliente: { select: { nombre: true } } } },
    },
  });
  if (!filas.length) return reporteVacio(desde, hasta);

  // El catálogo y el índice de recetas se cargan UNA sola vez para todos los clientes (mismo criterio que
  // obtenerReportePorPeriodoConCatalogo): cada pasada de calcularMargenRealDelPeriodo abajo los recibe ya armados.
  const [productos, indiceRecetas] = await Promise.all([construirMapaProductos(sucursalId, db), construirIndiceRecetas(db, sucursalId)]);

  const porCliente = new Map<string, { nombre: string; filas: typeof filas }>();
  for (const f of filas) {
    const clienteId = f.operacion.clienteId!; // el `where` ya exige clienteId no nulo
    const acc = porCliente.get(clienteId) ?? { nombre: f.operacion.cliente!.nombre, filas: [] };
    acc.filas.push(f);
    porCliente.set(clienteId, acc);
  }

  const clientes: FilaDescuentoCliente[] = [];
  let ingresoALista = 0;
  let ingresoCobrado = 0;

  for (const [clienteId, { nombre, filas: filasCliente }] of porCliente) {
    const itemsCobrado: ItemParaMargenReal[] = [];
    const itemsALista: ItemParaMargenReal[] = [];
    let unidadesVendidas = 0;
    let ingresoAListaCliente = 0;
    let ingresoCobradoCliente = 0;

    for (const f of filasCliente) {
      const cantidad = Math.abs(Number(f.cantidad));
      const precioCobradoTotal = Number(f.precioTotal);
      const precioAListaTotal = f.precioListaUnitario !== null ? importeDeLinea(cantidad, Number(f.precioListaUnitario)) : precioCobradoTotal;
      const costoUnitarioVenta = f.costoUnitarioVenta !== null ? Number(f.costoUnitarioVenta) : null;
      const base = { proceso: "VENTA" as const, anulada: false, productoId: f.productoId, cantidad, costoUnitarioVenta, fecha: f.operacion.fecha };
      itemsCobrado.push({ ...base, precioTotal: precioCobradoTotal });
      itemsALista.push({ ...base, precioTotal: precioAListaTotal });
      unidadesVendidas += cantidad;
      ingresoAListaCliente += precioAListaTotal;
      ingresoCobradoCliente += precioCobradoTotal;
    }

    // Dos pasadas con los MISMOS insumos de costeo (productos/indiceRecetas ya cargados): la única diferencia entre ambas es
    // `precioTotal` de cada línea, así que el costo real que resuelve cada una es idéntico — la diferencia entre los dos
    // márgenes es, centavo a centavo, lo que el descuento le sacó al margen (ver el docstring del módulo).
    const [margenCobrado, margenALista] = await Promise.all([
      calcularMargenRealDelPeriodo(sucursalId, itemsCobrado, db, productos, indiceRecetas),
      calcularMargenRealDelPeriodo(sucursalId, itemsALista, db, productos, indiceRecetas),
    ]);

    const totalDescontadoCliente = redondearMoneda(ingresoAListaCliente - ingresoCobradoCliente);
    ingresoALista += ingresoAListaCliente;
    ingresoCobrado += ingresoCobradoCliente;

    clientes.push({
      clienteId,
      cliente: nombre,
      cantidadVentas: filasCliente.length,
      unidadesVendidas: redondearMoneda(unidadesVendidas),
      ingresoALista: redondearMoneda(ingresoAListaCliente),
      ingresoCobrado: redondearMoneda(ingresoCobradoCliente),
      totalDescontado: totalDescontadoCliente,
      descuentoEfectivoPct: ingresoAListaCliente > 0 ? Math.round((totalDescontadoCliente / ingresoAListaCliente) * 1000) / 10 : null,
      margenReal: margenCobrado.margenRealTotal,
      margenRealPct: margenCobrado.margenRealTotal !== null && margenCobrado.ingresoConCostoReal > 0 ? Math.round((margenCobrado.margenRealTotal / margenCobrado.ingresoConCostoReal) * 1000) / 10 : null,
      margenRealALista: margenALista.margenRealTotal,
      margenRealAListaPct: margenALista.margenRealTotal !== null && margenALista.ingresoConCostoReal > 0 ? Math.round((margenALista.margenRealTotal / margenALista.ingresoConCostoReal) * 1000) / 10 : null,
      margenRealReconstruido: margenCobrado.ingresoRealReconstruido > 0,
      // Cobertura sobre lo COBRADO (la magnitud "real" del período) — mismo criterio que FilaMargenProducto.margenRealCompleto
      // en periodo.ts: si lo costeado no llega al ingreso total de este cliente, alguna venta quedó afuera.
      margenRealCompleto: redondearMoneda(margenCobrado.ingresoConCostoReal) >= redondearMoneda(ingresoCobradoCliente),
    });
  }

  const totalDescontado = redondearMoneda(ingresoALista - ingresoCobrado);
  return {
    desde,
    hasta,
    ingresoALista: redondearMoneda(ingresoALista),
    ingresoCobrado: redondearMoneda(ingresoCobrado),
    totalDescontado,
    descuentoEfectivoPct: ingresoALista > 0 ? Math.round((totalDescontado / ingresoALista) * 1000) / 10 : null,
    clientes: clientes.sort((a, b) => b.totalDescontado - a.totalDescontado),
    aviso: AVISO,
  };
}
