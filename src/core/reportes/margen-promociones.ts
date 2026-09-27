import { prisma } from "@/lib/db";
import { redondearMoneda } from "@/core/movimientos/transiciones";
import { construirIndiceRecetas, construirMapaProductos, type Db } from "./comun";
import { calcularMargenRealDelPeriodo, type ItemParaMargenReal } from "./margen-real";

/**
 * Reporte de margen real de las promos ARMABLES (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 12): por cada promo de
 * carta, cuánto entró de verdad (prorrateado, D3) contra lo que hubiera entrado si cada componente se hubiera vendido SUELTO
 * a precio de carta — y el margen Real de las dos formas, con el MISMO costo real (una promo no cambia lo que cuesta hacerla,
 * solo lo que se cobra por ella).
 *
 * Fuente: `MovimientoStock` de proceso VENTA cuya `Operacion.promoCuentaId` no es nulo (una línea por COMPONENTE, igual
 * criterio que `descuentos-clientes.ts` para `clienteId`) — el precio COBRADO ya prorrateado está en `precioTotal` (sin
 * tocar acá: nada de esta Task cambió su significado). El precio A LISTA de cada componente es `CuentaItem.
 * precioCartaUnitario` (paso 6): como no hay una columna propia en `MovimientoStock` para esto (a diferencia de
 * `precioListaUnitario`, que es del descuento de cliente, un concepto distinto — D2: los dos conviven, el descuento se aplica
 * DESPUÉS de prorratear), se lee de `CuentaItem` uniendo por `operacionId` (1 a 1: `registrar-venta.ts` crea una Operacion
 * por línea neta, ver su docstring).
 *
 * Se agrupa por `PromoCarta` (el TIPO de promo, ej. "Menú del día"), no por instancia (`PromoCuenta`, cada venta armada
 * puntual): un local vende la misma promo muchas veces, y lo que importa acá es cómo le va a esa promo en el período, igual
 * criterio que Período/Costos agrupan por producto y no por línea de venta. `costoPorItem` de `margen-real.ts` (paso 2, UNA
 * sola pasada para TODOS los componentes de TODAS las promos) es lo que hace posible este agrupamiento sin volver a costear
 * nada: el costo real de cada componente es el MISMO sea cual sea el precio con el que se lo empareje (cobrado o a lista),
 * así que se ahorra la doble pasada que sí necesita `descuentos-clientes.ts` (ahí hacen falta dos llamados porque, además de
 * la resta de precios, necesita los totales propios de cada pasada).
 *
 * El título mostrado es el de `PromoCarta.titulo` ACTUAL (no el snapshot congelado en cada `PromoCuenta.titulo`): mismo
 * criterio que un producto renombrado en Período/Costos, que muestra el nombre de HOY del catálogo, no el de cuando se
 * vendió. Una promo que se dio de baja (`activa: false`) sigue apareciendo si vendió algo en el rango, marcada como tal —
 * no se pierde el historial de lo que ya se cobró.
 */

export interface FilaMargenPromocion {
  promoCartaId: string;
  titulo: string;
  /** La `PromoCarta` sigue activa HOY (no en el momento de la venta) — una dada de baja sigue en el reporte si vendió algo. */
  activa: boolean;
  /** Instancias distintas de `PromoCuenta` vendidas en el rango (una por cada vez que se armó y se cobró esta promo). */
  cantidadInstancias: number;
  /** Líneas de componente netas (una por producto+precio de cada instancia — ver el docstring del módulo). */
  cantidadComponentes: number;
  ingresoALista: number;
  ingresoCobrado: number;
  /** `ingresoALista - ingresoCobrado`, exacto (aritmética de precios, no depende de ningún costo): lo que el cliente se
   *  ahorró por llevar el combo en vez de pedir cada cosa suelta. */
  ahorroCliente: number;
  ahorroClientePct: number | null;
  /** Margen Real sobre lo COBRADO (lo que de verdad entró prorrateado) — `null` si ninguna venta se pudo costear. */
  margenReal: number | null;
  margenRealPct: number | null;
  /** Margen Real que hubiera dado la MISMA venta si cada componente se hubiese cobrado a precio de carta (mismo costo real):
   *  para ver si el precio de la promo deja un margen sano o le come demasiado a la venta suelta equivalente. */
  margenRealSueltoEquivalente: number | null;
  margenRealSueltoEquivalentePct: number | null;
  /** Algún componente de esta promo se costeó con el historial de compras (no se guardó al vender). */
  margenRealReconstruido: boolean;
  /** `false` si algún componente de esta promo quedó afuera del margen Real — el número no cubre el 100% de lo vendido. */
  margenRealCompleto: boolean;
}

export interface ReporteMargenPromociones {
  desde: Date;
  hasta: Date;
  cantidadInstancias: number;
  ingresoALista: number;
  ingresoCobrado: number;
  ahorroCliente: number;
  promos: FilaMargenPromocion[];
  aviso: string;
}

const AVISO =
  'Margen Real: costo congelado al momento de cada venta, o reconstruido con el historial de compras cuando no se guardó (igual criterio que Período/Promociones/Descuentos por cliente); "parcial" si algún componente de esa promo no se pudo costear así — no cambia los importes de arriba, que son de precio, no de costo. "A lista" es lo que hubiera entrado vendiendo cada componente SUELTO a precio de carta, con el MISMO costo real: la diferencia contra lo cobrado es el ahorro que le dio la promo al cliente (D3), no un error de cobro.';

function reporteVacio(desde: Date, hasta: Date): ReporteMargenPromociones {
  return { desde, hasta, cantidadInstancias: 0, ingresoALista: 0, ingresoCobrado: 0, ahorroCliente: 0, promos: [], aviso: AVISO };
}

interface AcumuladoPromo {
  titulo: string;
  instancias: Set<string>;
  cantidadComponentes: number;
  ingresoALista: number;
  ingresoCobrado: number;
  /** Solo de los componentes que SÍ se pudieron costear — base para el margen Real (misma idea que `ingresoConCostoReal`). */
  ingresoAListaConCosto: number;
  ingresoCobradoConCosto: number;
  costoRealTotal: number;
  reconstruido: boolean;
  completo: boolean;
}

export async function obtenerReporteMargenPromociones(sucursalId: string, desde: Date, hasta: Date, db: Db = prisma): Promise<ReporteMargenPromociones> {
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
    acc.cantidadComponentes += 1;
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
