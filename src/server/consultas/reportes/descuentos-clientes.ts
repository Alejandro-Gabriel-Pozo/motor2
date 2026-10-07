import "server-only";
import { importeDeLinea, redondearMoneda } from "@/core/moneda";
import { construirIndiceRecetas, construirMapaProductos } from "@/server/lecturas/reportes/comun";
import type { Db } from "@/lib/db-tipos";
import { reconstruirCostosDeVenta } from "@/server/consultas/reportes/costo-historico";
import { calcularMargenRealDelPeriodo } from "@/server/consultas/reportes/margen-real";
import type { ItemParaMargenReal } from "@/core/reportes/public";
import type { FilaDescuentoCliente, ReporteDescuentosClientes } from "@/core/reportes/public";

const AVISO =
  'Margen Real: costo congelado al momento de cada venta, o reconstruido con el historial de compras cuando no se guardó (igual criterio que Período/Promociones); "parcial" si alguna venta de ese cliente no se pudo costear así — no cambia los importes de arriba, que son de precio, no de costo.';

/** Sin ninguna venta con cliente en el rango: reporte vacío, sin tocar el motor de margen. */
function reporteVacio(desde: Date, hasta: Date): ReporteDescuentosClientes {
  return { desde, hasta, ingresoALista: 0, ingresoCobrado: 0, totalDescontado: 0, descuentoEfectivoPct: null, clientes: [], aviso: AVISO };
}

export async function obtenerReporteDescuentosClientes(sucursalId: string, desde: Date, hasta: Date, db: Db): Promise<ReporteDescuentosClientes> {
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

  // El costo de las ventas sin costo guardado se reconstruye UNA vez para TODOS los clientes (antes: dos lecturas del historial de compras por cada cliente, una por
  // pasada). El costo de un (producto, día) no depende de qué otras ventas se reconstruyan juntas (lo fija el test «guardián de semántica» de costo-historico).
  const costosReconstruidos = await reconstruirCostosDeVenta(
    sucursalId,
    filas.filter((f) => f.costoUnitarioVenta === null).map((f) => ({ productoId: f.productoId, fecha: f.operacion.fecha })),
    db,
    productos,
    indiceRecetas,
  );

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
      calcularMargenRealDelPeriodo(sucursalId, itemsCobrado, db, productos, indiceRecetas, costosReconstruidos),
      calcularMargenRealDelPeriodo(sucursalId, itemsALista, db, productos, indiceRecetas, costosReconstruidos),
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