import type { Proceso } from "@prisma/client";
import { redondearMoneda } from "@/core/moneda";
import { mediana } from "@/core/estadistica/mediana";
import { ZONA_UTC, inicioDelDiaDe } from "@/core/tiempo/zona-horaria";

// A propósito NO importa `redondearCantidad` de `./comun`: ese módulo importa
// `@/lib/db` a nivel de archivo, así que cualquier import de VALOR (no de
// tipo) desde acá arrastraría Prisma/`pg` al bundle del cliente en cuanto un
// componente "use client" importe un valor de este archivo (bug real
// encontrado en rendimiento-recetas-vistas.ts, mismo patrón — ver su
// docstring). Se duplica localmente por eso.
function redondearCantidad(n: number): number {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

/**
 * View-model puro para "Cómo se compró (MP)" / "Cómo se vendió (PV)" y el
 * filtro "Qué mostrar" del Kardex (docs/planes-demo-y-claridad-reportes-
 * 2026-09-21.md §4, docs/plan-historial-producto-mp-pv-2026-09-22.md §1.2).
 * Todo acá es puro (sin Prisma, sin fetch) — entra `EventoHistorialProducto[]`
 * (o un subconjunto estructural de sus campos, ver los tipos `EventoPara*`
 * de abajo) y sale un view-model listo para pintar. Paso 1 del plan: esto
 * NO depende todavía de que `historial-producto.ts` declare los campos
 * nuevos (`precioPorUnidadStock`, `anulada`, etc.) — los tipos locales de
 * abajo piden exactamente lo que cada función necesita, así que en el Paso
 * 2 (cuando esos campos se agreguen a `EventoHistorialProducto`) los
 * call-sites van a poder pasar el evento real sin tocar este archivo,
 * gracias al tipado estructural de TypeScript.
 */

// ---------------------------------------------------------------------------
// Filtro "Qué mostrar" del Kardex
// ---------------------------------------------------------------------------

export type QueMostrar = "todo" | "compras" | "consumos-ventas" | "ajustes-conteos";

/**
 * A qué balde del filtro "Qué mostrar" pertenece cada `Proceso` — Record
 * EXHAUSTIVO sobre el enum de Prisma, mismo criterio que `TRANSICIONES`
 * (src/core/movimientos/transiciones.ts:54): si mañana se agrega un
 * `Proceso` nuevo, el compilador obliga a clasificarlo acá, nunca cae en
 * silencio fuera de todos los filtros.
 *
 * Criterio de agrupación:
 * - **"compras"**: la relación con el proveedor — el alta (Compra) y su
 *   reverso (Devolución a Proveedor).
 * - **"ajustes-conteos"**: correcciones administrativas sin una operación
 *   de negocio detrás — conteo físico, ajuste manual, reclasificación entre
 *   secciones. Los eventos `tipo === "conteo"` (que no tienen `Proceso`,
 *   son otra tabla) van acá también — ver `filtrarEventosKardex`.
 * - **"consumos-ventas"**: el resto — el movimiento real del negocio (se
 *   vendió, se produjo, se consumió por receta, se transfirió, se mermó,
 *   hubo consignación).
 */
export const GRUPO_POR_PROCESO: Record<Proceso, Exclude<QueMostrar, "todo">> = {
  COMPRA: "compras",
  DEVOLUCION_PROVEEDOR: "compras",
  CONSUMO: "consumos-ventas",
  VENTA: "consumos-ventas",
  PRODUCCION: "consumos-ventas",
  MERMA: "consumos-ventas",
  TRANSFERENCIA: "consumos-ventas",
  TRANSFERENCIA_SALIDA_SUCURSAL: "consumos-ventas",
  TRANSFERENCIA_ENTRADA_SUCURSAL: "consumos-ventas",
  REINGRESO_TRANSFERENCIA_SUCURSAL: "consumos-ventas",
  DEVOLUCION_CONSIGNACION: "consumos-ventas",
  LIQUIDACION_CONSIGNACION: "consumos-ventas",
  DEVOLUCION_CLIENTE: "consumos-ventas",
  AJUSTE: "ajustes-conteos",
  CONTROL: "ajustes-conteos",
  RECLASIFICACION: "ajustes-conteos",
};

interface EventoParaFiltro {
  tipo: "movimiento" | "conteo";
  /** Viene de `MovimientoStock.proceso` (un `Proceso` real de Prisma), pero `EventoHistorialProducto` lo declara como `string` — el cast de abajo es seguro por eso. */
  proceso?: string;
}

/**
 * Filtro de PRESENTACIÓN — se aplica DESPUÉS de que `obtenerHistorialProducto`
 * ya calculó `saldoCorriente` acumulando TODOS los eventos del rango. Nunca
 * puede ir al `where` de la consulta a Postgres: si se sacaran los CONSUMO
 * de la consulta misma, "Solo compras" mostraría un saldo inventado (ver
 * hallazgo (c), docs/plan-historial-producto-mp-pv-2026-09-22.md §0).
 * Genérico en `T` para no perder ningún campo extra del evento (como
 * `saldoCorriente`) al filtrar.
 */
export function filtrarEventosKardex<T extends EventoParaFiltro>(eventos: T[], queMostrar: QueMostrar): T[] {
  if (queMostrar === "todo") return eventos;
  return eventos.filter((ev) => {
    const balde = ev.tipo === "conteo" ? "ajustes-conteos" : GRUPO_POR_PROCESO[ev.proceso as Proceso];
    return balde === queMostrar;
  });
}

// ---------------------------------------------------------------------------
// Variación de precio
// ---------------------------------------------------------------------------

function redondearPorcentaje(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Variación porcentual de un precio contra el anterior (decisión 3 de §4:
 * "contra la compra anterior", no contra el promedio del mes — responde la
 * pregunta real, "¿me están cobrando más que la última vez?"; respaldo
 * externo en Grocy `Last price`/ERPNext `rate` por línea, grounding §7
 * ajuste 3).
 *
 * `null` cuando no hay con qué comparar (primera compra del rango) o cuando
 * cualquiera de los dos precios es 0 (una compra cargada sin precio, caso
 * real y frecuente — ver `hayLineasSinPrecio`/`haySinPrecio` en
 * `compras-registradas.ts`): NUNCA `Infinity` ni `-100%`, que serían un
 * número inventado a partir de un precio que en realidad no se cargó.
 */
export function variacionPorcentual(actual: number | null, anterior: number | null): number | null {
  if (actual === null || anterior === null || anterior === 0 || actual === 0) return null;
  return redondearPorcentaje(((actual - anterior) / anterior) * 100);
}

// ---------------------------------------------------------------------------
// "Cómo se compró" (MP)
// ---------------------------------------------------------------------------

export interface FilaCompraHistorial {
  fecha: Date;
  proveedor: string | null;
  nroFactura: string | null;
  cantidad: number;
  precioPorUnidadStock: number | null;
  variacionPct: number | null;
  idOperacion: string | undefined;
}

export interface ResumenCompras {
  filas: FilaCompraHistorial[];
  cantidadCompras: number;
  medianaCantidad: number | null;
  comprasPorSemana: number | null;
  precioMin: number | null;
  precioMax: number | null;
  proveedores: string[];
}

interface EventoParaCompras {
  tipo: "movimiento" | "conteo";
  proceso?: string;
  anulada?: boolean;
  fecha: Date;
  cantidadConSigno?: number;
  precioPorUnidadStock?: number;
  proveedorNombre?: string | null;
  nroFactura?: string | null;
  idOperacion?: string;
}

/** Días entre la primera y la última fecha de la lista — `null` con menos de 2 fechas (no hay intervalo que medir). */
function diasEntrePrimeraYUltima(fechas: Date[]): number | null {
  if (fechas.length < 2) return null;
  const tiempos = fechas.map((f) => f.getTime());
  return (Math.max(...tiempos) - Math.min(...tiempos)) / 86_400_000;
}

/**
 * Resumen de "Cómo se compró (MP)" — decisiones 1-3 de §4 (mediana,
 * compras/semana, variación contra la anterior). EXCLUYE las anuladas (una
 * compra anulada no ocurrió — mismo criterio que §2 y que `/reportes/compras`,
 * que las muestra marcadas pero no las suma; ver
 * `test/arquitectura/reportes-compras-anuladas.test.ts`).
 */
export function resumirCompras(eventos: EventoParaCompras[]): ResumenCompras {
  const compras = eventos.filter((ev) => ev.tipo === "movimiento" && ev.proceso === "COMPRA" && !ev.anulada);
  const ordenadas = [...compras].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  const filas: FilaCompraHistorial[] = [];
  // Una compra sin precio (0, caso real) no sirve como "la anterior" para la comparación de la SIGUIENTE fila — se salta, no se propaga un 0.
  let ultimoPrecioValido: number | null = null;
  for (const ev of ordenadas) {
    const precio = ev.precioPorUnidadStock ?? null;
    filas.push({
      fecha: ev.fecha,
      proveedor: ev.proveedorNombre ?? null,
      nroFactura: ev.nroFactura ?? null,
      cantidad: redondearCantidad(Math.abs(ev.cantidadConSigno ?? 0)),
      precioPorUnidadStock: precio,
      variacionPct: variacionPorcentual(precio, ultimoPrecioValido),
      idOperacion: ev.idOperacion,
    });
    if (precio !== null && precio !== 0) ultimoPrecioValido = precio;
  }

  const cantidades = filas.map((f) => f.cantidad);
  const precios = filas.map((f) => f.precioPorUnidadStock).filter((p): p is number => p !== null && p !== 0);
  const dias = diasEntrePrimeraYUltima(ordenadas.map((e) => e.fecha));

  return {
    filas,
    cantidadCompras: filas.length,
    medianaCantidad: mediana(cantidades),
    // Frecuencia = decisión 2 de §4 ("compras por semana", no "días entre compras"). Sin intervalo medible (0 o 1 compra), no hay tasa que calcular.
    comprasPorSemana: dias !== null && dias > 0 ? redondearPorcentaje((filas.length / dias) * 7) : null,
    precioMin: precios.length ? Math.min(...precios) : null,
    precioMax: precios.length ? Math.max(...precios) : null,
    proveedores: [...new Set(filas.map((f) => f.proveedor).filter((p): p is string => p !== null))],
  };
}

// ---------------------------------------------------------------------------
// "Cómo se vendió" (PV)
// ---------------------------------------------------------------------------

export interface FilaVentaPorDia {
  /** `YYYY-MM-DD`, mismo criterio UTC que el resto de la pantalla (tabla-historial.tsx). */
  dia: string;
  cantidad: number;
  importe: number;
  precioPromedio: number | null;
}

interface EventoParaVentas {
  tipo: "movimiento" | "conteo";
  proceso?: string;
  anulada?: boolean;
  fecha: Date;
  cantidadConSigno?: number;
  precioTotal?: number;
}

// ---------------------------------------------------------------------------
// Rango por defecto de /reportes/historial
// ---------------------------------------------------------------------------

export type RangoHistorial = "10d" | "90d" | "todo" | "personalizado";

export interface RangoHistorialResuelto {
  rango: RangoHistorial;
  desde: Date | undefined;
  hasta: Date | undefined;
}

/**
 * Rango por defecto de /reportes/historial (§4, decisión 10 — surgida del
 * plan de implementación). NO extiende `OpcionRango`/`resolverRangoDeReporte`
 * (`rango-por-defecto.ts`): esa unión la comparten 5 pantallas de §1 —
 * agregar "90d" ahí las obligaría a todas a saber manejarlo, para un default
 * que solo tiene sentido acá.
 *
 * Default "10 días" (decisión del dueño 2026-10-02, con «Ver más» en la pantalla):
 * 10 días → 90 días (`rango=90d`, que un insumo que se compra cada 2-3
 * semanas necesita para mostrar un patrón real en "Cómo se compró") → todo.
 * "Todo el historial" queda como alternativa EXPLÍCITA
 * (`rango=todo`): sin eso, el Kardex de abajo —que comparte esta MISMA
 * consulta, una sola, para que sus números siempre cierren con los de
 * arriba— dejaría de poder verse completo como hoy.
 *
 * `ahora` inyectable, mismo criterio testeable que `resolverRangoPorDefecto`.
 */
export function resolverRangoHistorial(sp: { desde?: string; hasta?: string; rango?: string }, ahora: Date): RangoHistorialResuelto {
  if (sp.desde || sp.hasta || sp.rango === "personalizado") {
    return { rango: "personalizado", desde: sp.desde ? new Date(sp.desde) : undefined, hasta: sp.hasta ? new Date(sp.hasta) : undefined };
  }
  if (sp.rango === "todo") return { rango: "todo", desde: undefined, hasta: undefined };

  const hoy = inicioDelDiaDe(ahora, ZONA_UTC);
  const desde = new Date(hoy);
  if (sp.rango === "90d") {
    desde.setUTCDate(desde.getUTCDate() - 89); // 89 días atrás + hoy = 90 días, inclusive de los dos extremos.
    return { rango: "90d", desde, hasta: undefined };
  }
  desde.setUTCDate(desde.getUTCDate() - 9); // 9 días atrás + hoy = 10 días: lo que se ve por defecto; «Ver más» pasa a 90 días y después a todo.
  return { rango: "10d", desde, hasta: undefined };
}

/**
 * Saca de los eventos los datos comerciales: los dos de dinero (`precioTotal`, `precioPorUnidadStock`), el proveedor y el N.º de
 * factura. Se aplica en el SERVIDOR antes de armar cualquier prop de un componente cliente cuando el rol no tiene
 * `reporte_historial_importes`: ocultar la columna al dibujar no alcanza, el dato viaja igual en el payload y se lee con las
 * herramientas del navegador.
 */
export function quitarDineroDeEventos<T extends { precioTotal?: number; precioPorUnidadStock?: number; proveedorNombre?: string | null; nroFactura?: string | null }>(eventos: T[]): T[] {
  return eventos.map((ev) => {
    const sinDinero = { ...ev };
    delete sinDinero.precioTotal;
    delete sinDinero.precioPorUnidadStock;
    delete sinDinero.proveedorNombre;
    delete sinDinero.nroFactura;
    return sinDinero;
  });
}

/** Ventas agrupadas por día — EXCLUYE las anuladas (mismo criterio que `resumirCompras`). Orden cronológico ascendente. */
export function agruparVentasPorDia(eventos: EventoParaVentas[]): FilaVentaPorDia[] {
  const porDia = new Map<string, { cantidad: number; importe: number }>();
  for (const ev of eventos) {
    if (ev.tipo !== "movimiento" || ev.proceso !== "VENTA" || ev.anulada) continue;
    const dia = ev.fecha.toISOString().slice(0, 10);
    const acumulado = porDia.get(dia) ?? { cantidad: 0, importe: 0 };
    acumulado.cantidad += Math.abs(ev.cantidadConSigno ?? 0);
    acumulado.importe += ev.precioTotal ?? 0;
    porDia.set(dia, acumulado);
  }
  return [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, { cantidad, importe }]) => ({
      dia,
      cantidad: redondearCantidad(cantidad),
      importe: redondearMoneda(importe),
      precioPromedio: cantidad > 0 ? redondearMoneda(importe / cantidad) : null,
    }));
}
