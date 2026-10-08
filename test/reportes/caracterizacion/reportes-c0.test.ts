import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { limpiarBaseDeTest, prisma } from "../../setup/test-db";
import type { Db } from "../../../src/lib/db-tipos";
import { sembrarEscenarioDeReportes } from "./escenario-reportes";
import { listarComprasRegistradas } from "../../../src/server/consultas/reportes/compras-registradas";
import { generarReporteConsignacion } from "../../../src/server/consultas/reportes/consignacion";
import { reconstruirCostosDeVenta } from "../../../src/server/consultas/reportes/costo-historico";
import { cargarCostosYMargenes } from "../../../src/server/consultas/reportes/costos";
import { obtenerUltimaCotizacion, obtenerUltimaCotizacionSinRomper } from "../../../src/server/consultas/reportes/cotizacion-dolar";
import { obtenerReporteDescuentosClientes } from "../../../src/server/consultas/reportes/descuentos-clientes";
import { obtenerReporteDescuentosProductos } from "../../../src/server/consultas/reportes/descuentos-productos";
import { generarReporteDevoluciones } from "../../../src/server/consultas/reportes/devoluciones";
import { generarReporteDiferenciasAjustes } from "../../../src/server/consultas/reportes/diferencias-ajustes";
import { buscarProductoParaHistorial, obtenerHistorialProducto, obtenerIngredientesRecetaVigente } from "../../../src/server/consultas/reportes/historial-producto";
import { generarReporteHuecosCatalogo, obtenerProblemasUnidadMezclada } from "../../../src/server/consultas/reportes/huecos-catalogo";
import { generarReporteInsumosSinRecetaVinculada } from "../../../src/server/consultas/reportes/insumos-sin-receta";
import { cargarObjetivosDeMargen } from "../../../src/server/consultas/reportes/margen-objetivo-consulta";
import { obtenerReporteMargenPromociones } from "../../../src/server/consultas/reportes/margen-promociones";
import { calcularMargenRealDelPeriodo } from "../../../src/server/consultas/reportes/margen-real";
import { generarReportePerdidas } from "../../../src/server/consultas/reportes/perdidas";
import { calcularMargenDelPeriodo } from "../../../src/server/consultas/reportes/periodo-margen";
import { calcularComparativaPreciosDelPeriodo, calcularTendenciaPreciosDelPeriodo } from "../../../src/server/consultas/reportes/periodo-precios";
import { calcularRatioGastoVentas } from "../../../src/server/consultas/reportes/periodo-ratio";
import { generarReporteVentasPorCategoria, obtenerReportePorPeriodo, obtenerReportePorPeriodoConCatalogo } from "../../../src/server/consultas/reportes/periodo";
import { compararRendimientosDeSucursales, compararRendimientosPorSucursal } from "../../../src/server/consultas/reportes/rendimiento-por-sucursal";
import { calcularRendimientoRecetasCompartidas, calcularRendimientoRecetasSimples } from "../../../src/server/consultas/reportes/rendimiento-recetas";
import { obtenerResumenConsolidado } from "../../../src/server/consultas/reportes/resumen-consolidado";
import { obtenerResumenOperativo } from "../../../src/server/consultas/reportes/resumen-operativo";
import { generarReporteRotacionMesas } from "../../../src/server/consultas/reportes/rotacion-mesas";
import { generarReporteSaludPorProducto } from "../../../src/server/consultas/reportes/salud-por-producto";
import { listarTicketsEmitidos, obtenerNumeroDeMesa } from "../../../src/server/consultas/reportes/tickets-emitidos";
import { buscarOperacionesPorProducto, obtenerOperacionPorId } from "../../../src/server/consultas/reportes/trazabilidad";
import { calcularValuacionInventario } from "../../../src/server/consultas/reportes/valuacion";
import { generarConciliacionVencimientos, generarReporteLotesProximosAVencer, obtenerReporteVencimientosDatos } from "../../../src/server/consultas/reportes/vencimientos";
import { generarReporteVentasSinReceta } from "../../../src/server/consultas/reportes/ventas-sin-receta";

/**
 * CARACTERIZACIÓN de los reportes (C0, Hito 2 de docs/pureza-integracion.md, trabajo 2.2; origen: docs/plan-fase-4-pureza.md §11.2 #11). Se escribe ANTES de
 * mover nada de `src/server/consultas/reportes/` y NO se edita en ningún paso posterior: si un paso cambia un número, una fila, un orden, un aviso o la
 * CANTIDAD de consultas de un reporte, este archivo lo tiene que detectar en rojo. Para regenerarlo A PROPÓSITO (una decisión de producto o una mejora de
 * consultas asumida como tal, nunca una mudanza):
 * `REGENERAR_CARACTERIZACION_DE_REPORTES=1 npx vitest run test/reportes/caracterizacion/reportes-c0.test.ts`. Se usa un archivo propio y no los snapshots de
 * Vitest para que `-u` no lo pueda regenerar en silencio.
 *
 * Una sola siembra (`escenario-reportes.ts`, ids y horas fijos) y el reloj congelado en 2026-03-15 15:00 UTC (solo `Date`: la base y los timers siguen reales),
 * así «hoy», «hace N días», los vencimientos y la antigüedad del IPC son siempre los mismos. Los reportes solo leen. Por cada función exportada se vuelcan:
 *  1. las CONSULTAS que hizo, contadas con una extensión del cliente (`$allOperations`, que en Prisma 7 también ve `$queryRaw`/`$executeRaw`): el total y el
 *     multiconjunto `modelo.operación×n` ordenado (dentro de un `Promise.all` el orden de llegada puede variar; la cantidad no);
 *  2. el RESULTADO, en una forma estable: claves ordenadas, `Decimal` como texto exacto, fechas en ISO, `Map`/`Set` ordenados por su clave/valor, y TODOS los
 *     ids (`c` + 24 caracteres) reemplazados por `#1, #2…` en el orden en que aparecen por primera vez en el archivo.
 * Algunos arreglos salen en el orden en que los entrega la base SIN `ORDER BY` (o empatados en `fecha`): esos —y solo esos— se ordenan acá antes de volcarlos,
 * con un criterio que no depende de ids (ver `ordenar` en cada caso), para que el golden no dependa del plan de la base. El resto se vuelca en el orden del reporte.
 *
 * Con este escenario NINGÚN reporte devuelve vacío. Lo que no se ejercita a propósito: el término vacío de `buscarOperacionesPorProducto` (devuelve `[]` sin
 * consultar; se lo llama con «harina») y el `catch` de `obtenerUltimaCotizacionSinRomper` (con la base en pie es la misma lectura que `obtenerUltimaCotizacion`;
 * anotado en el golden). Tampoco hay Precio Local (capacidad `precio_local`) ni receta propia de sucursal: esas ramas quedan en sus tests propios.
 *
 * Varias entradas (las líneas del período, el catálogo, los objetivos de margen) se las arma a las funciones de `periodo-*`, `margen-real` y `costo-historico`
 * una lectura previa SIN contar, como en la página: el conteo es solo el de la función caracterizada.
 */
const ARCHIVO = join(__dirname, "reportes-c0.golden.txt");
const AHORA = new Date("2026-03-15T15:00:00.000Z");
/** El período de los reportes que piden un rango: del 16 de febrero al 15 de marzo (los que reciben días los expanden ellos con `rangoUtc`). */
const DESDE_DIA = new Date("2026-02-16T00:00:00.000Z");
const HASTA_DIA = new Date("2026-03-15T00:00:00.000Z");
/** El mismo período ya expandido, para los que filtran `fecha` tal cual (descuentos, promociones). */
const HASTA_FIN = new Date("2026-03-15T23:59:59.999Z");

// ── Conteo de consultas ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Corre `f` contra un cliente DERIVADO que anota cada consulta y la deja pasar. Solo `$allOperations` de primer nivel: en Prisma 7 recibe TODAS las
 * operaciones (las de modelo, con `model`, y las crudas `$queryRaw`/`$executeRaw`, sin él) — sumarle `$allModels.$allOperations` contaría dos veces cada
 * consulta de modelo (verificado al escribir esto: con los dos, `producto.findMany` aparecía duplicado).
 */
async function medir<T>(f: (db: Db) => Promise<T>): Promise<{ resultado: T; consultas: string[] }> {
  const consultas: string[] = [];
  const db = prisma.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        consultas.push(model ? `${model.charAt(0).toLowerCase()}${model.slice(1)}.${operation}` : operation);
        return query(args);
      },
    },
  }) as unknown as Db;
  const resultado = await f(db);
  return { resultado, consultas };
}

function resumenDeConsultas(consultas: readonly string[]): string {
  const porTipo = new Map<string, number>();
  for (const c of consultas) porTipo.set(c, (porTipo.get(c) ?? 0) + 1);
  const detalle = [...porTipo].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, n]) => `${k}×${n}`).join(", ");
  return `  consultas (${consultas.length}): ${detalle || "ninguna"}`;
}

// ── Volcado estable ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ANCHO = 150;

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Map) && !(v instanceof Set) && !Prisma.Decimal.isDecimal(v);
}

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Una línea, sin saltos. Los ids quedan crudos: los simboliza `simbolizar` sobre el texto entero, al final. */
function enLinea(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "bigint") return `${v}n`;
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return String(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "Date(inválida)" : `Date(${v.toISOString()})`;
  if (Prisma.Decimal.isDecimal(v)) return `Decimal(${(v as Prisma.Decimal).toFixed()})`;
  if (Array.isArray(v)) return `[${v.map(enLinea).join(", ")}]`;
  if (v instanceof Map) return `Map{${entradasDeMap(v).map(([k, x]) => `${k} => ${enLinea(x)}`).join(", ")}}`;
  if (v instanceof Set) return `Set[${valoresDeSet(v).join(", ")}]`;
  if (esObjetoPlano(v)) return `{${Object.keys(v).sort(comparar).map((k) => `${k}: ${enLinea(v[k])}`).join(", ")}}`;
  return String(v);
}

/** Las entradas de un Map ordenadas por su clave volcada: el orden de inserción de un Map depende a veces del orden de la base. */
function entradasDeMap(m: Map<unknown, unknown>): Array<[string, unknown]> {
  return [...m.entries()].map(([k, v]) => [enLinea(k), v] as [string, unknown]).sort(([a], [b]) => comparar(a, b));
}

function valoresDeSet(s: Set<unknown>): string[] {
  return [...s].map(enLinea).sort(comparar);
}

/** Bonito: en una línea si entra en `ANCHO`, si no, un hijo por línea. */
function volcar(v: unknown, nivel = 2): string {
  const linea = enLinea(v);
  if (linea.length + nivel * 2 <= ANCHO) return linea;
  const sangria = "  ".repeat(nivel + 1);
  const cierre = "  ".repeat(nivel);
  if (Array.isArray(v)) return `[\n${v.map((x) => sangria + volcar(x, nivel + 1)).join(",\n")}\n${cierre}]`;
  if (v instanceof Map) return `Map{\n${entradasDeMap(v).map(([k, x]) => `${sangria}${k} => ${volcar(x, nivel + 1)}`).join(",\n")}\n${cierre}}`;
  if (v instanceof Set) return `Set[\n${valoresDeSet(v).map((x) => sangria + x).join(",\n")}\n${cierre}]`;
  if (esObjetoPlano(v)) return `{\n${Object.keys(v).sort(comparar).map((k) => `${sangria}${k}: ${volcar(v[k], nivel + 1)}`).join(",\n")}\n${cierre}}`;
  return linea;
}

/** Cada id (`c` + 24 caracteres, la forma de un cuid) pasa a `#n` por orden de primera aparición en el archivo entero. */
function simbolizar(texto: string): string {
  const simbolos = new Map<string, string>();
  return texto.replace(/\bc[a-z0-9]{24}\b/g, (id) => {
    if (!simbolos.has(id)) simbolos.set(id, `#${simbolos.size + 1}`);
    return simbolos.get(id)!;
  });
}

/** Ordena (copia) por una lista de claves que NO son ids: para los arreglos que el reporte deja en el orden de la base. */
function ordenar<T>(filas: readonly T[], ...claves: Array<(f: T) => string | number>): T[] {
  return [...filas].sort((a, b) => {
    for (const clave of claves) {
      const x = clave(a);
      const y = clave(b);
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  });
}
const t = (d: Date) => d.toISOString();

// ── La corrida ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("Caracterización de los reportes (C0): resultado y conteo de consultas de cada función exportada", () => {
  let E: Awaited<ReturnType<typeof sembrarEscenarioDeReportes>>;

  beforeAll(async () => {
    // Solo `Date`: los timers reales siguen andando (el pool de conexiones y los timeouts del cliente los usan).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    await limpiarBaseDeTest();
    E = await sembrarEscenarioDeReportes();
  }, 120_000);

  afterAll(() => {
    vi.useRealTimers();
  });

  it("cada reporte da lo mismo, con las mismas consultas, que lo guardado en reportes-c0.golden.txt", async () => {
    const lineas: string[] = [];
    let n = 0;

    /** Mide, normaliza (solo lo que la base entrega sin orden) y vuelca un reporte. `nota` explica un resultado vacío por diseño. */
    async function reporte<T>(titulo: string, f: (db: Db) => Promise<T>, opciones: { normalizar?: (r: T) => unknown; nota?: string } = {}): Promise<T> {
      const { resultado, consultas } = await medir(f);
      n += 1;
      lineas.push(`### ${n}. ${titulo}`);
      if (opciones.nota) lineas.push(`  nota: ${opciones.nota}`);
      lineas.push(resumenDeConsultas(consultas));
      lineas.push(`  resultado: ${volcar(opciones.normalizar ? opciones.normalizar(resultado) : resultado, 1)}`);
      return resultado;
    }

    const S1 = E.S1;
    // Entradas que algunas funciones reciben ya calculadas (en la página las arma otra consulta): se leen con el cliente SIN contar.
    const objetivos = await cargarObjetivosDeMargen(prisma);
    const { reporte: repCrudo, productos } = await obtenerReportePorPeriodoConCatalogo(S1, DESDE_DIA, HASTA_DIA, {}, prisma, AHORA);

    // `items` sale ordenado por `Operacion.fecha`: las líneas de UNA misma operación (consumos + venta, renglones de una compra) empatan y la base las
    // entrega en cualquier orden (visto en la práctica: dos corridas seguidas con los mismos datos las dieron distinto). Se desempata por proceso,
    // producto y cantidad (ninguna operación repite ese trío). Las entradas de las funciones de abajo salen de las líneas YA ordenadas: `costoPorItem`
    // del margen real, por ejemplo, va alineado con el orden de lo que recibe.
    const ordenarItems = <R extends { items: typeof repCrudo.items }>(r: R): R => ({ ...r, items: ordenar(r.items, (i) => t(i.fecha), (i) => i.proceso, (i) => i.productoNombre, (i) => i.cantidad) });
    const rep = ordenarItems(repCrudo);
    const ventasSinCosto = rep.items.filter((i) => i.proceso === "VENTA" && i.costoUnitarioVenta === null && !i.anulada).map((i) => ({ productoId: i.productoId, fecha: i.fecha }));
    const itemsMargen = rep.items.map((i) => ({ proceso: i.proceso, anulada: i.anulada, productoId: i.productoId, cantidad: i.cantidad, precioTotal: i.precioTotal, costoUnitarioVenta: i.costoUnitarioVenta, fecha: i.fecha }));

    // compras-registradas.ts
    await reporte("compras-registradas.listarComprasRegistradas(Central, sin filtro)", (db) => listarComprasRegistradas(S1, {}, db));

    // consignacion.ts
    await reporte("consignacion.generarReporteConsignacion(Central, sin período)", (db) => generarReporteConsignacion(S1, db));
    await reporte("consignacion.generarReporteConsignacion(Central, 2026-03-01 → 2026-03-15)", (db) => generarReporteConsignacion(S1, db, { desde: new Date("2026-03-01T00:00:00Z"), hasta: HASTA_FIN }));

    // costo-historico.ts
    await reporte("costo-historico.reconstruirCostosDeVenta(Central, las ventas del período sin costo guardado)", (db) => reconstruirCostosDeVenta(S1, ventasSinCosto, db));

    // costos.ts y margen-objetivo-consulta.ts
    await reporte("margen-objetivo-consulta.cargarObjetivosDeMargen()", (db) => cargarObjetivosDeMargen(db));
    await reporte("costos.cargarCostosYMargenes(Central, objetivos cargados)", (db) => cargarCostosYMargenes(S1, db, objetivos));

    // cotizacion-dolar.ts
    await reporte("cotizacion-dolar.obtenerUltimaCotizacion()", (db) => obtenerUltimaCotizacion(db));
    await reporte("cotizacion-dolar.obtenerUltimaCotizacionSinRomper()", (db) => obtenerUltimaCotizacionSinRomper(db), { nota: "con la base en pie es la misma lectura que la anterior" });

    // descuentos-clientes.ts / descuentos-productos.ts
    await reporte("descuentos-clientes.obtenerReporteDescuentosClientes(Central, período)", (db) => obtenerReporteDescuentosClientes(S1, DESDE_DIA, HASTA_FIN, db));
    await reporte("descuentos-productos.obtenerReporteDescuentosProductos(Central, período)", (db) => obtenerReporteDescuentosProductos(S1, DESDE_DIA, HASTA_FIN, db));

    // devoluciones.ts
    await reporte("devoluciones.generarReporteDevoluciones(Central, 30 días)", (db) => generarReporteDevoluciones(S1, 30, db, AHORA));

    // diferencias-ajustes.ts
    await reporte("diferencias-ajustes.generarReporteDiferenciasAjustes(Central, hoy = reloj)", (db) => generarReporteDiferenciasAjustes(S1, db, AHORA));

    // historial-producto.ts
    await reporte("historial-producto.buscarProductoParaHistorial(Central, «pizza»)", (db) => buscarProductoParaHistorial(S1, "pizza", db));
    await reporte("historial-producto.obtenerHistorialProducto(Central, Harina 000, todas las secciones, período)", (db) => obtenerHistorialProducto(S1, E.HARINA, undefined, DESDE_DIA, HASTA_DIA, db));
    // El `include` de los ingredientes no tiene `orderBy`: se ordenan por nombre.
    const porNombre = (r: Array<{ nombre: string }>) => ordenar(r, (i) => i.nombre);
    await reporte("historial-producto.obtenerIngredientesRecetaVigente(Pizza, Central)", (db) => obtenerIngredientesRecetaVigente(E.PIZZA, db, S1), { normalizar: porNombre });
    await reporte("historial-producto.obtenerIngredientesRecetaVigente(Pizza, Norte: muzzarella calibrada)", (db) => obtenerIngredientesRecetaVigente(E.PIZZA, db, E.S2), { normalizar: porNombre });

    // huecos-catalogo.ts
    await reporte("huecos-catalogo.generarReporteHuecosCatalogo(Central)", (db) => generarReporteHuecosCatalogo(S1, db));
    // Los productos de cada insumo salen en el orden de `producto.findMany` (sin `orderBy`), y las unidades de un Set armado en ese orden.
    await reporte("huecos-catalogo.obtenerProblemasUnidadMezclada()", (db) => obtenerProblemasUnidadMezclada(db), {
      normalizar: (r) => r.map((p) => ({ ...p, unidades: [...p.unidades].sort(comparar), productos: ordenar(p.productos, (x) => x.nombre) })),
    });

    // insumos-sin-receta.ts
    await reporte("insumos-sin-receta.generarReporteInsumosSinRecetaVinculada(Central)", (db) => generarReporteInsumosSinRecetaVinculada(S1, db));

    // margen-promociones.ts / margen-real.ts
    await reporte("margen-promociones.obtenerReporteMargenPromociones(Central, período)", (db) => obtenerReporteMargenPromociones(S1, DESDE_DIA, HASTA_FIN, db));
    await reporte("margen-real.calcularMargenRealDelPeriodo(Central, las líneas del período, sin catálogo precargado)", (db) => calcularMargenRealDelPeriodo(S1, itemsMargen, db));

    // perdidas.ts — ordenado por `Operacion.fecha` desc: los consumos automáticos de UNA venta empatan; se desempata por producto.
    await reporte("perdidas.generarReportePerdidas(Central, 30 días)", (db) => generarReportePerdidas(S1, 30, db, AHORA), {
      normalizar: (r) => ({ ...r, mermas: ordenar(r.mermas, (x) => -x.fecha.getTime(), (x) => x.producto), consumos: ordenar(r.consumos, (x) => -x.fecha.getTime(), (x) => x.producto) }),
    });

    // periodo-margen.ts / periodo-precios.ts / periodo-ratio.ts (con las entradas que les arma `obtenerReportePorPeriodoConCatalogo`)
    await reporte("periodo-margen.calcularMargenDelPeriodo(Central, líneas y ventas del período, catálogo cargado, SIN índice de recetas)", (db) => calcularMargenDelPeriodo(S1, rep.items, rep.ventas, db, productos, AHORA));
    const tendencia = await reporte("periodo-precios.calcularTendenciaPreciosDelPeriodo(Central, desde 16-feb)", (db) => calcularTendenciaPreciosDelPeriodo(S1, rep.desde, rep.items, productos, db));
    await reporte("periodo-precios.calcularComparativaPreciosDelPeriodo(Central, período, tendencia de arriba)", (db) => calcularComparativaPreciosDelPeriodo(S1, rep.desde, rep.hasta, tendencia, rep.ventas.porProducto, db, AHORA));
    await reporte("periodo-ratio.calcularRatioGastoVentas(Central, período, totales del reporte, SIN clasificación precargada)", (db) =>
      calcularRatioGastoVentas(S1, rep.desde, rep.hasta, rep.compras.totalGastado, rep.compras.totalNoComestibles, rep.ventas.totalFacturado, productos, db)
    );

    // periodo.ts
    const periodo = await medir((db) => obtenerReportePorPeriodo(S1, DESDE_DIA, HASTA_DIA, {}, db, AHORA));
    n += 1;
    lineas.push(`### ${n}. periodo.obtenerReportePorPeriodo(Central, 16-feb → 15-mar, sin filtros)`, resumenDeConsultas(periodo.consultas), `  resultado: ${volcar(ordenarItems(periodo.resultado), 1)}`);
    const conCatalogo = await medir((db) => obtenerReportePorPeriodoConCatalogo(S1, DESDE_DIA, HASTA_DIA, {}, db, AHORA));
    n += 1;
    const mismoReporte = volcar(ordenarItems(conCatalogo.resultado.reporte), 1) === volcar(ordenarItems(periodo.resultado), 1);
    lineas.push(
      `### ${n}. periodo.obtenerReportePorPeriodoConCatalogo(Central, 16-feb → 15-mar, sin filtros)`,
      resumenDeConsultas(conCatalogo.consultas),
      // El `reporte` es el mismo de arriba (no se repite entero): se vuelca si es idéntico y, si deja de serlo, entero.
      `  resultado.reporte: ${mismoReporte ? "idéntico al de obtenerReportePorPeriodo" : volcar(ordenarItems(conCatalogo.resultado.reporte), 1)}`,
      `  resultado.productos: ${volcar(conCatalogo.resultado.productos, 1)}`
    );
    await reporte("periodo.generarReporteVentasPorCategoria(Central, período)", (db) => generarReporteVentasPorCategoria(S1, DESDE_DIA, HASTA_DIA, db));

    // rendimiento-por-sucursal.ts / rendimiento-recetas.ts
    await reporte("rendimiento-por-sucursal.compararRendimientosPorSucursal(Central + Norte, todas)", (db) => compararRendimientosPorSucursal(E.sucursales, { todas: true }, db));
    await reporte("rendimiento-por-sucursal.compararRendimientosDeSucursales(Central + Norte, solo calibradas)", (db) => compararRendimientosDeSucursales(E.sucursales, {}, db));
    await reporte("rendimiento-recetas.calcularRendimientoRecetasSimples(Central, período)", (db) => calcularRendimientoRecetasSimples(S1, DESDE_DIA, HASTA_DIA, db));
    await reporte("rendimiento-recetas.calcularRendimientoRecetasCompartidas(Central, período)", (db) => calcularRendimientoRecetasCompartidas(S1, DESDE_DIA, HASTA_DIA, db));

    // resumen-operativo.ts / resumen-consolidado.ts — `topStockBajo` sale en el orden del `groupBy` (sin `orderBy`): se ordena por producto y sección.
    await reporte("resumen-operativo.obtenerResumenOperativo(Central, ahora, rango por defecto)", (db) => obtenerResumenOperativo(S1, db, AHORA), {
      normalizar: (r) => ({ ...r, topStockBajo: ordenar(r.topStockBajo, (x) => x.producto, (x) => x.seccion) }),
    });
    await reporte("resumen-consolidado.obtenerResumenConsolidado(Central + Norte, ahora)", (db) => obtenerResumenConsolidado(E.sucursales, db, AHORA));

    // rotacion-mesas.ts / salud-por-producto.ts
    await reporte("rotacion-mesas.generarReporteRotacionMesas(Central, 1-mar → 15-mar, Buenos Aires)", (db) => generarReporteRotacionMesas(S1, new Date("2026-03-01T00:00:00Z"), HASTA_DIA, "America/Argentina/Buenos_Aires", db));
    await reporte("salud-por-producto.generarReporteSaludPorProducto(Central)", (db) => generarReporteSaludPorProducto(S1, db, AHORA));

    // tickets-emitidos.ts
    await reporte("tickets-emitidos.listarTicketsEmitidos(Central, sin filtro)", (db) => listarTicketsEmitidos(S1, {}, db));
    await reporte("tickets-emitidos.obtenerNumeroDeMesa(Central, mesa 4)", (db) => obtenerNumeroDeMesa(S1, E.MESA_4, db));

    // trazabilidad.ts — los movimientos de la operación vienen de un `include` sin `orderBy`: se ordenan por proceso y producto.
    await reporte("trazabilidad.obtenerOperacionPorId(Central, la primera compra de lácteos)", (db) => obtenerOperacionPorId(S1, E.COMPRA_LACTEOS_1, db), {
      normalizar: (r) => (r ? { ...r, items: ordenar(r.items, (i) => i.proceso, (i) => i.productoNombre) } : r),
    });
    await reporte("trazabilidad.buscarOperacionesPorProducto(Central, «harina»)", (db) => buscarOperacionesPorProducto(S1, "harina", db));

    // valuacion.ts
    await reporte("valuacion.calcularValuacionInventario(Central)", (db) => calcularValuacionInventario(S1, db));

    // vencimientos.ts
    await reporte("vencimientos.generarReporteLotesProximosAVencer(Central, 7 días)", (db) => generarReporteLotesProximosAVencer(S1, 7, db, AHORA));
    await reporte("vencimientos.generarConciliacionVencimientos(Central)", (db) => generarConciliacionVencimientos(S1, db));
    await reporte("vencimientos.obtenerReporteVencimientosDatos(Central, 7 días)", (db) => obtenerReporteVencimientosDatos(S1, 7, db, AHORA));

    // ventas-sin-receta.ts
    await reporte("ventas-sin-receta.generarReporteVentasSinReceta(Central)", (db) => generarReporteVentasSinReceta(S1, db));

    const actual = simbolizar(lineas.join("\n") + "\n");
    expect(actual.length).toBeGreaterThan(20_000); // si el escenario no armó nada, esto no está mirando nada

    if (process.env.REGENERAR_CARACTERIZACION_DE_REPORTES === "1") {
      mkdirSync(__dirname, { recursive: true });
      writeFileSync(ARCHIVO, actual, "utf8");
      return;
    }
    expect(existsSync(ARCHIVO), "falta reportes-c0.golden.txt: generalo contra el código ANTERIOR a la mudanza").toBe(true);
    expect(actual.replace(/\r\n/g, "\n")).toBe(readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n"));
  }, 180_000);
});
