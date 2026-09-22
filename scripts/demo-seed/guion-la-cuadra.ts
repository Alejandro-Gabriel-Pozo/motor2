/**
 * El guion completo de 6 meses de "La Cuadra" (docs/planes-demo-y-claridad-reportes-2026-09-21.md §0 y §5) — arma un
 * `GuionDemo` (scripts/demo-seed/guion.ts) puro, determinístico, reusando el catálogo/recetas ya existentes
 * (seed-demo-pizzeria-data.ts) más las series de precio (series-precio.ts) y el PRNG (prng.ts) del Tramo 1.
 *
 * Arco temporal (§0, regla 3): las primeras `semanasDeDesorden` semanas (1 a 1,5 meses) son el tramo de DESORDEN — un
 * producto (PV020, la pizza más vendida) vende sin receta cargada todavía, así que esas ventas quedan sin costo congelado
 * ("· reconstruido"/"· parcial" en el margen Real más adelante). El resto (hasta `semanas`) es el tramo ORDENADO: recetas
 * completas, cadencia de compras regular, conteos periódicos.
 *
 * Lo que agrega sobre el seed de 30 días existente (scripts/seed-demo-pizzeria.ts):
 * - Precios de compra con una serie temporal real (antes: un valor único y constante por todo el período).
 * - El bug del proveedor alternativo corregido: cuando un insumo se compra a un proveedor distinto del habitual, esa
 *   compra sale como una OPERACIÓN APARTE a nombre del proveedor real, nunca mezclada en la operación del proveedor "de
 *   la ronda" (antes la Operación completa quedaba a nombre del proveedor de siempre, aunque un insumo viniera de otro).
 * - Un PV que "se produce" (PV030, pizza al corte por porción — ver seed-demo-pizzeria-data.ts), para que el saldo de un
 *   PV signifique algo real.
 * - 3 conteos físicos en vez de 1, con los tres perfiles pedidos por §5 (bien calibrado / ruidoso por lote / merma real).
 * - Un episodio corto de anulación + corrección de compra (§5: "acotado a un episodio corto, no al centro de la historia").
 * - Un vencimiento de lote y un faltante puntual (stockout), las "variaciones creíbles" de §0 regla 4.
 *
 * Lo que NO hace este archivo: no toca la base, no llama a ningún server action — eso es el ejecutor (paso siguiente del
 * plan), que recorre el `GuionDemo` resultante y sí lo escribe de verdad, resolviendo `semana`/`diaSemana` a fechas
 * calendario relativas a "hoy" y leyendo saldos reales para los conteos (`ajusteRelativo`).
 */
import { gaussiana, type GeneradorAleatorio } from "./prng";
import { generarSerieDePrecio, precioEnSemana, type PuntoDeSerie } from "./series-precio";
import type { EventoDemo, GuionDemo, ItemCompra, Seccion } from "./guion";
import { PRECIOS_REFERENCIA, PRODUCTOS, RECETAS } from "../seed-demo-pizzeria-data";

export interface ConfigGuionLaCuadra {
  /** Duración total del guion, en semanas — 26 ≈ 6 meses (§0). */
  semanas: number;
  /** Semanas del tramo de desorden al inicio — 4 a 6 ≈ 1 a 1,5 meses (§0, regla 3). */
  semanasDeDesorden: number;
}

export const CONFIG_LA_CUADRA_DEFAULT: ConfigGuionLaCuadra = { semanas: 26, semanasDeDesorden: 5 };

/** Ventas semanales base por PV — la variación semana a semana la da `generarMultiplicadoresPorPV`, no un vector fijo (a diferencia del seed de 30 días, acá son 26 semanas: no entra a mano). */
const VENTAS_BASE: Record<string, number> = {
  PV020: 40, PV021: 20, PV022: 18, PV023: 14, PV024: 12, PV025: 10, PV026: 8, PV027: 9,
  PV030: 22, // pizza al corte — el único PV que "se produce"
  PV007: 60, PV008: 70, PV009: 30, PV010: 25, PV011: 6,
};
/** Peso relativo por día de la semana (0=domingo..6=sábado) — fin de semana más fuerte, lunes flojo. */
const PESO_DIA: Record<number, number> = { 0: 0.9, 1: 0.7, 2: 0.85, 3: 0.9, 4: 1.1, 5: 1.5, 6: 1.6 };
const SUMA_PESOS_SEMANA = Object.values(PESO_DIA).reduce((a, b) => a + b, 0);

const CODIGOS_BARRA = new Set(["PV007", "PV008", "PV009", "PV010", "PV011", "MX002", "MX003", "MX004", "MX005"]);
function seccionDe(codigo: string): Seccion {
  return CODIGOS_BARRA.has(codigo) ? "Barra" : "Cocina";
}

const CADENCIA_PROVEEDOR: Record<string, number[]> = {
  PRV_HARINAS: [2, 5],
  PRV_LACTEOS: [3],
  PRV_VERDULERIA: [1, 2, 3, 4, 5, 6],
  PRV_FIAMBRES: [1],
  PRV_ALMACEN: [2],
};
const MP_POR_PROVEEDOR: Record<string, string[]> = {
  PRV_HARINAS: ["MP001"],
  PRV_LACTEOS: ["MP006", "MP007", "MP017", "MP018"],
  PRV_VERDULERIA: ["MP010", "MP011", "MP012", "MP015", "MP016"],
  PRV_FIAMBRES: ["MP008", "MP009"],
  PRV_ALMACEN: ["MP002", "MP003", "MP004", "MP005", "MP013", "MP014"],
};
/** Doble fuente real: ocasionalmente el pedido sale del proveedor alternativo — la compra de ESE insumo se separa en su propia Operación (bug corregido, ver docstring del archivo). */
const PROVEEDOR_ALTERNATIVO: Record<string, string> = { MP001: "PRV_ALMACEN", MP004: "PRV_HARINAS", MP006: "PRV_FIAMBRES" };
const CADA_CUANTAS_ENTREGAS_ALTERNA: Record<string, number> = { MP001: 5, MP006: 4 };

/** Intermedios que se PRODUCEN y son ingrediente de otra receta (a diferencia de PV030, que también se produce pero se VENDE directo, nunca es ingrediente de nada). */
const INTERMEDIOS_PRODUCIDOS = new Set(["MPZ01", "MPZ02"]);
const BUFFER = 1.12;

const RECETA_POR_PRODUCTO = new Map(RECETAS.map((r) => [r.productoCodigo, r.ingredientes]));
const FACTOR_CONVERSION_POR_CODIGO = new Map(PRODUCTOS.map((p) => [p.codigo, p.factorConversion]));

/** Cuánto de cada MP hace falta explotando la receta de `codigo` × `cantidad` — un solo nivel (no recursivo): los intermedios producidos van a `produccion`, el resto (MP hoja) a `directa`. Alcanza para la estructura de esta demo (2 niveles: MP hoja, e intermedios MPZ01/MPZ02/PV030 sin sub-intermedios propios). */
function explotarUnaVez(codigo: string, cantidad: number, directa: Record<string, number>, produccion: Record<string, number>): void {
  if (!(cantidad > 0)) return;
  const receta = RECETA_POR_PRODUCTO.get(codigo);
  if (!receta) return;
  for (const ing of receta) {
    const cant = cantidad * ing.cantidad * (1 + ing.mermaPorcentaje / 100);
    if (INTERMEDIOS_PRODUCIDOS.has(ing.insumoCodigo)) produccion[ing.insumoCodigo] = (produccion[ing.insumoCodigo] ?? 0) + cant;
    else directa[ing.insumoCodigo] = (directa[ing.insumoCodigo] ?? 0) + cant;
  }
}

export interface NecesidadSemanal {
  /** MP que hay que COMPRAR esta semana. */
  directa: Record<string, number>;
  /** Intermedios (MPZ01/MPZ02) y PV030 que hay que PRODUCIR esta semana. */
  produccion: Record<string, number>;
}

/** Necesidad de la semana `semana`, explotando ventas → recetas → MP comprable, en 3 pasadas (ver el docstring de `explotarUnaVez`: PV030 primero, para que su fracción de MPZ01 se sume ANTES de explotar MPZ01). */
export function necesidadSemanal(semana: number, multiplicadores: Record<string, number[]>): NecesidadSemanal {
  const directa: Record<string, number> = {};
  const produccion: Record<string, number> = { MPZ01: 0, MPZ02: 0, PV030: 0 };

  for (const [pv, base] of Object.entries(VENTAS_BASE)) {
    const qty = base * multiplicadores[pv]![semana]!;
    if (pv === "PV030") {
      produccion.PV030 += qty; // se produce: la venta no consume receta, hay que haberlo horneado antes
      continue;
    }
    explotarUnaVez(pv, qty, directa, produccion);
  }
  explotarUnaVez("PV030", produccion.PV030, directa, produccion);
  explotarUnaVez("MPZ01", produccion.MPZ01, directa, produccion);
  explotarUnaVez("MPZ02", produccion.MPZ02, directa, produccion);

  return { directa, produccion };
}

/** Ventas objetivo del día `diaSemana` (0=domingo) de la semana `semana`, por PV. */
export function ventasDelDia(semana: number, diaSemana: number, multiplicadores: Record<string, number[]>): Record<string, number> {
  const pesoDia = PESO_DIA[diaSemana]!;
  const out: Record<string, number> = {};
  for (const [pv, base] of Object.entries(VENTAS_BASE)) {
    const totalSemana = base * multiplicadores[pv]![semana]!;
    out[pv] = Math.max(0, Math.round((totalSemana * pesoDia) / SUMA_PESOS_SEMANA));
  }
  return out;
}

/** Multiplicador semanal por PV: paseo aleatorio con reversión a la media (vuelve hacia 1.0), acotado a [0.45, 1.8] — da una mezcla de ventas realmente distinta semana a semana (necesario para que la regresión de los pools compartidos de Rendimiento real pueda separar el coeficiente de cada plato). */
export function generarMultiplicadoresSemanales(rand: GeneradorAleatorio, semanas: number, dispersion = 0.12): number[] {
  const out: number[] = [];
  let m = 1;
  for (let s = 0; s < semanas; s++) {
    m = m + (1 - m) * 0.25 + gaussiana(rand) * dispersion;
    m = Math.min(1.8, Math.max(0.45, m));
    out.push(Math.round(m * 1000) / 1000);
  }
  return out;
}

export function construirMultiplicadoresPorPV(rand: GeneradorAleatorio, semanas: number): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const pv of Object.keys(VENTAS_BASE)) out[pv] = generarMultiplicadoresSemanales(rand, semanas);
  return out;
}

const CONFIG_SERIE_PRECIO = { inflacionMensualEsperada: 0.035, dispersionSemanal: 0.02, probabilidadSaltoSemanal: 0.035, saltoMinPct: 0.06, saltoMaxPct: 0.15 };
/** Precio inicial de referencia de MP011B (compra de oportunidad, sin proveedor formal — no está en PRECIOS_REFERENCIA porque no tiene código de proveedor real). */
const PRECIO_INICIAL_MP011B = 2450;

function construirSeriesDePrecios(semanas: number, rand: GeneradorAleatorio): Map<string, PuntoDeSerie[]> {
  const series = new Map<string, PuntoDeSerie[]>();
  for (const ref of PRECIOS_REFERENCIA) {
    const clave = `${ref.productoCodigo}|${ref.proveedorCodigo}`;
    series.set(clave, generarSerieDePrecio({ ...CONFIG_SERIE_PRECIO, precioInicial: ref.precioUnitarioCompra, semanas }, rand));
  }
  series.set("MP011B|SIN_PROVEEDOR", generarSerieDePrecio({ ...CONFIG_SERIE_PRECIO, precioInicial: PRECIO_INICIAL_MP011B, semanas }, rand));
  return series;
}
function precioDeCompra(series: Map<string, PuntoDeSerie[]>, productoCodigo: string, proveedorCodigo: string, semana: number): number {
  const clave = `${productoCodigo}|${proveedorCodigo}`;
  const serie = series.get(clave);
  if (!serie) throw new Error(`precioDeCompra: sin serie de precio para "${clave}"`);
  return precioEnSemana(serie, semana);
}

/** El proveedor de referencia de un producto (el primero que aparece en PRECIOS_REFERENCIA) — para el stock inicial, que compra CUALQUIER MP que haga falta, no solo los que tienen una cadencia semanal propia (ej. descartables, bebidas). */
function proveedorHabitualDe(productoCodigo: string): string | null {
  return PRECIOS_REFERENCIA.find((p) => p.productoCodigo === productoCodigo)?.proveedorCodigo ?? null;
}

/** Contador incremental para refs únicas — un objeto mutable simple, no hace falta más ceremonia para esto. */
function crearContador() {
  let n = 0;
  return () => `ev${n++}`;
}

/**
 * Arma el guion completo — determinístico dada la misma `config` y el mismo `rand` (mismo criterio que
 * `generarSerieDePrecio`: nada de `Math.random()`, todo sale de `rand`).
 */
export function generarGuionLaCuadra(config: ConfigGuionLaCuadra, rand: GeneradorAleatorio): GuionDemo {
  if (config.semanas < config.semanasDeDesorden + 4) throw new Error("generarGuionLaCuadra: semanas tiene que dejar un tramo ordenado real después del desorden");

  const multiplicadores = construirMultiplicadoresPorPV(rand, config.semanas);
  const series = construirSeriesDePrecios(config.semanas, rand);
  const ref = crearContador();
  const eventos: EventoDemo[] = [];

  // --- Stock inicial ("día -1" de la semana 0): sin esto, las ventas/producción del domingo de la semana 0 se
  // quedarían sin stock — las primeras compras programadas recién caen martes/miércoles (CADENCIA_PROVEEDOR), como si
  // la cocina arrancara de cero un domingo. Mismo motivo que el seed de 30 días (que sembraba "un día antes de la
  // ventana"): acá se expresa con `diaSemana: -1` en la semana 0, que `fechaDe` (ejecutor) resuelve un día antes que
  // semana 0/día 0 — la fórmula ya generaliza sin necesitar un caso especial.
  {
    const necesidadInicial = necesidadSemanal(0, multiplicadores);
    const itemsPorSeccion = new Map<Seccion, ItemCompra[]>();
    for (const [mpCodigo, cantidadNecesaria] of Object.entries(necesidadInicial.directa)) {
      if (!(cantidadNecesaria > 0)) continue;
      const proveedorCodigo = proveedorHabitualDe(mpCodigo);
      if (!proveedorCodigo) continue; // no debería pasar (todo MP de receta tiene un precio de referencia), pero no aborta el guion entero por eso
      const factor = FACTOR_CONVERSION_POR_CODIGO.get(mpCodigo) ?? 1;
      const cantidadCompra = Math.max(1, Math.ceil((cantidadNecesaria * BUFFER * 2) / factor)); // 2 semanas de colchón inicial
      const precio = precioDeCompra(series, mpCodigo, proveedorCodigo, 0);
      const seccion = seccionDe(mpCodigo);
      if (!itemsPorSeccion.has(seccion)) itemsPorSeccion.set(seccion, []);
      itemsPorSeccion.get(seccion)!.push({ productoCodigo: mpCodigo, cantidad: cantidadCompra, precioUnitario: Math.round(cantidadCompra * precio) / cantidadCompra });
    }
    for (const [seccion, items] of itemsPorSeccion) {
      if (!items.length) continue;
      eventos.push({ tipo: "COMPRA", ref: ref(), semana: 0, diaSemana: -1, seccion, proveedorCodigo: null, nroFactura: "STOCK-INICIAL", items });
    }
    // Producción inicial de los intermedios y de PV030 — para que el día 0 ya tenga algo armado, no solo comprado.
    for (const clave of ["MPZ01", "MPZ02", "PV030"] as const) {
      const necesidadDiaria = (necesidadInicial.produccion[clave] ?? 0) / 7;
      const cantidad = Math.max(1, Math.round(necesidadDiaria * BUFFER * 2) * (clave === "PV030" ? 12 : 1));
      if ((necesidadInicial.produccion[clave] ?? 0) > 0) eventos.push({ tipo: "PRODUCCION", ref: ref(), semana: 0, diaSemana: -1, seccion: "Cocina", productoCodigo: clave, cantidad });
    }
  }

  // --- Recetas: todas al día 0 salvo PV020 (la más vendida), que se carga recién al final del tramo de desorden —
  // el mecanismo detrás de "ventas sin costo congelado" del tramo de desorden (ver EventoCrearReceta en guion.ts).
  // El evento se emite DENTRO del loop de semanas (más abajo), en su posición cronológica real — emitirlo acá, antes
  // de las semanas 0..SEMANA_RECETA_TARDIA-1, rompería el orden cronológico que exige `validarGuion`.
  const PRODUCTO_RECETA_TARDIA = "PV020";
  const SEMANA_RECETA_TARDIA = Math.max(1, config.semanasDeDesorden - 1);

  // --- Contadores de sustitución de proveedor (persisten semana a semana, no se reinician). ---
  const contadorEntregas: Record<string, number> = { MP001: 0, MP006: 0 };

  // --- Semana de escenarios puntuales (§0/§5) — separadas para que no choquen entre sí en la misma semana. ---
  const SEMANA_STOCKOUT = Math.min(config.semanasDeDesorden + 4, config.semanas - 6);
  const SEMANA_ANULACION = Math.min(config.semanasDeDesorden + 6, config.semanas - 5);
  const SEMANA_VENCIMIENTO = Math.floor(config.semanas * 0.4);
  const SEMANA_CONTEO_TEMPRANO = config.semanasDeDesorden + 2;
  const SEMANA_CONTEO_RUIDOSO = Math.floor(config.semanas * 0.55);
  const SEMANA_CONTEO_MERMA = config.semanas - 3;
  const SEMANA_MERMA = Math.floor(config.semanas * 0.7);

  const semanasDeEscenario = [SEMANA_RECETA_TARDIA, SEMANA_STOCKOUT, SEMANA_ANULACION, SEMANA_VENCIMIENTO, SEMANA_CONTEO_TEMPRANO, SEMANA_CONTEO_RUIDOSO, SEMANA_CONTEO_MERMA, SEMANA_MERMA];
  if (new Set(semanasDeEscenario).size !== semanasDeEscenario.length) throw new Error(`generarGuionLaCuadra: dos escenarios puntuales cayeron en la misma semana (${semanasDeEscenario.join(", ")}) — se pisarían entre sí`);
  if (semanasDeEscenario.some((s) => s < 0 || s >= config.semanas)) throw new Error(`generarGuionLaCuadra: algún escenario puntual cae fuera de [0, ${config.semanas}) — semanas muy chico para este guion`);

  let refCompraParaAnular: string | null = null;
  let refCompraParaCorregir: string | null = null;

  for (let semana = 0; semana < config.semanas; semana++) {
    const necesidad = necesidadSemanal(semana, multiplicadores);
    const bufferSemana = semana === 0 ? BUFFER * 2.2 : BUFFER; // semana 0: colchón extra, como si la cocina ya viniera funcionando de antes
    // Refs de TODAS las compras emitidas esta semana — de acá salen las dos que el episodio de anulación/corrección necesita (ver más abajo), sin depender de qué proveedor haya tocado justo esa semana.
    const refsCompraDeLaSemana: string[] = [];

    if (semana === SEMANA_RECETA_TARDIA) {
      eventos.push({ tipo: "CREAR_RECETA", ref: ref(), semana, diaSemana: 0, productoCodigo: PRODUCTO_RECETA_TARDIA });
    }

    // --- Compras por proveedor habitual, agrupadas por proveedor EFECTIVO (bug del proveedor alternativo corregido: un insumo que sale de otro proveedor es su PROPIA Operación). ---
    for (const [provCodigo, dias] of Object.entries(CADENCIA_PROVEEDOR)) {
      const mps = MP_POR_PROVEEDOR[provCodigo]!;
      const ocurrencias = dias.length;
      const porProveedorEfectivo = new Map<string, ItemCompra[]>();

      for (const mpCodigo of mps) {
        // Stockout puntual: ese insumo, esa semana, no llega — ninguno de sus proveedores lo entrega.
        if (semana === SEMANA_STOCKOUT && mpCodigo === "MP006") continue;

        let proveedorEfectivo = provCodigo;
        const cadaCuanto = CADA_CUANTAS_ENTREGAS_ALTERNA[mpCodigo];
        if (cadaCuanto) {
          contadorEntregas[mpCodigo] = (contadorEntregas[mpCodigo] ?? 0) + 1;
          if (contadorEntregas[mpCodigo]! % cadaCuanto === 0) proveedorEfectivo = PROVEEDOR_ALTERNATIVO[mpCodigo]!;
        }

        const necesidadTotal = (necesidad.directa[mpCodigo] ?? 0) * (semana === 0 ? 2 : 1); // semana 0: 2 semanas de colchón inicial
        const necesidadPorEntrega = (necesidadTotal * bufferSemana) / ocurrencias;
        const factor = FACTOR_CONVERSION_POR_CODIGO.get(mpCodigo) ?? 1;
        let cantidadCompra = Math.max(1, Math.ceil(necesidadPorEntrega / factor));
        // Vencimiento de lote: una compra de más, con fecha de vencimiento cercana — parte queda sin consumir a tiempo.
        const esVencimiento = semana === SEMANA_VENCIMIENTO && mpCodigo === "MP006";
        if (esVencimiento) cantidadCompra = Math.ceil(cantidadCompra * 2.4);

        const precio = precioDeCompra(series, mpCodigo, proveedorEfectivo, semana);
        if (!porProveedorEfectivo.has(proveedorEfectivo)) porProveedorEfectivo.set(proveedorEfectivo, []);
        const item: ItemCompra = { productoCodigo: mpCodigo, cantidad: cantidadCompra, precioUnitario: Math.round(cantidadCompra * precio) / cantidadCompra };
        porProveedorEfectivo.get(proveedorEfectivo)!.push(item);
      }

      for (const dia of dias) {
        for (const [proveedorEfectivo, items] of porProveedorEfectivo) {
          if (!items.length) continue;
          const r = ref();
          eventos.push({
            tipo: "COMPRA",
            ref: r,
            semana,
            diaSemana: dia,
            seccion: "Cocina",
            proveedorCodigo: proveedorEfectivo,
            // Incluye la RONDA (provCodigo) además del proveedor efectivo: cuando la sustitución del proveedor
            // alternativo cae el mismo día que la entrega habitual de ESE MISMO proveedor efectivo (ej. MP001
            // sustituido a PRV_ALMACEN un martes, el mismo día que la entrega regular de PRV_ALMACEN), las dos
            // compras son operaciones DISTINTAS a nombre del mismo proveedor — sin la ronda en la factura, la
            // segunda pisaría el número de la primera (única por proveedor+factura).
            nroFactura: `${provCodigo}-${proveedorEfectivo}-s${semana}d${dia}`,
            items: semana === SEMANA_VENCIMIENTO && dia === dias[0] ? items.map((it) => (it.productoCodigo === "MP006" ? { ...it, loteVencimiento: new Date(Date.UTC(2000, 0, 1 + semana * 7 + dia + 12)) } : it)) : items,
          });
          refsCompraDeLaSemana.push(r);
        }
      }
    }

    // --- Verdulería: compra de oportunidad de MP011B (feria, sin proveedor formal) — jueves. ---
    {
      const necesidadMorron = necesidad.directa.MP011 ?? 0;
      const cantidadB = Math.max(5, Math.round(necesidadMorron * bufferSemana * 0.4));
      const precioB = precioDeCompra(series, "MP011B", "SIN_PROVEEDOR", semana);
      const r = ref();
      eventos.push({
        tipo: "COMPRA", ref: r, semana, diaSemana: 4, seccion: "Cocina", proveedorCodigo: null,
        items: [{ productoCodigo: "MP011B", cantidad: cantidadB, precioUnitario: Math.round(cantidadB * precioB) / cantidadB }],
      });
      refsCompraDeLaSemana.push(r);
    }

    // --- Descartables/limpieza, cada 2 semanas. ---
    if (semana % 2 === 0) {
      const items: ItemCompra[] = ["MP019", "MP020", "OT001", "OT002"].map((codigo) => {
        const necesidadTotal = (necesidad.directa[codigo] ?? 0) * 2;
        const factor = FACTOR_CONVERSION_POR_CODIGO.get(codigo) ?? 1;
        const cantidad = Math.max(1, Math.ceil((necesidadTotal * bufferSemana) / factor) || 1);
        const precio = precioDeCompra(series, codigo, "PRV_DESCARTABLES", semana);
        return { productoCodigo: codigo, cantidad, precioUnitario: Math.round(cantidad * precio) / cantidad };
      });
      const r = ref();
      eventos.push({ tipo: "COMPRA", ref: r, semana, diaSemana: 2, seccion: "Cocina", proveedorCodigo: "PRV_DESCARTABLES", nroFactura: `PRV_DESCARTABLES-s${semana}`, items });
      refsCompraDeLaSemana.push(r);
    }

    // --- Bebidas, semanal (jueves). ---
    {
      const items: ItemCompra[] = ["MX002", "MX003", "MX004", "MX005"].map((codigo) => {
        const necesidadTotal = necesidad.directa[codigo] ?? 0;
        const factor = FACTOR_CONVERSION_POR_CODIGO.get(codigo) ?? 1;
        const cantidad = Math.max(1, Math.ceil((necesidadTotal * bufferSemana) / factor) || 1);
        const precio = precioDeCompra(series, codigo, "PRV_BEBIDAS", semana);
        return { productoCodigo: codigo, cantidad, precioUnitario: Math.round(cantidad * precio) / cantidad };
      });
      const r = ref();
      eventos.push({ tipo: "COMPRA", ref: r, semana, diaSemana: 4, seccion: "Barra", proveedorCodigo: "PRV_BEBIDAS", nroFactura: `PRV_BEBIDAS-s${semana}`, items });
      refsCompraDeLaSemana.push(r);
    }

    // --- Producción de prepizza (lunes/miércoles/viernes) y de PV030 (martes/sábado). ---
    const GAP_HASTA_PROXIMA_TANDA: Record<number, number> = { 1: 2, 3: 2, 5: 3 };
    for (const dia of [1, 3, 5]) {
      for (const clave of ["MPZ01", "MPZ02"] as const) {
        const necesidadTotal = necesidad.produccion[clave] ?? 0;
        const cantidad = Math.max(1, Math.round((necesidadTotal * bufferSemana * GAP_HASTA_PROXIMA_TANDA[dia]!) / 7));
        eventos.push({ tipo: "PRODUCCION", ref: ref(), semana, diaSemana: dia, seccion: "Cocina", productoCodigo: clave, cantidad });
      }
    }
    const GAP_PV030: Record<number, number> = { 2: 4, 6: 3 }; // martes cubre hasta el sábado (4 días), sábado cubre hasta el martes (3 días)
    for (const dia of [2, 6]) {
      const necesidadTotal = necesidad.produccion.PV030 ?? 0;
      const cantidad = Math.max(12, Math.round((necesidadTotal * bufferSemana * GAP_PV030[dia]!) / 7 / 12) * 12); // en múltiplos de 12 (1 bandeja)
      eventos.push({ tipo: "PRODUCCION", ref: ref(), semana, diaSemana: dia, seccion: "Cocina", productoCodigo: "PV030", cantidad });
    }

    // --- Ventas, todos los días. ---
    for (let dia = 0; dia < 7; dia++) {
      const ventasHoy = ventasDelDia(semana, dia, multiplicadores);
      const itemsCocina = Object.entries(ventasHoy).filter(([pv, cant]) => seccionDe(pv) === "Cocina" && cant > 0).map(([productoCodigo, cantidad]) => ({ productoCodigo, cantidad }));
      const itemsBarra = Object.entries(ventasHoy).filter(([pv, cant]) => seccionDe(pv) === "Barra" && cant > 0).map(([productoCodigo, cantidad]) => ({ productoCodigo, cantidad }));
      const esDesorden = semana < config.semanasDeDesorden;
      if (itemsCocina.length) eventos.push({ tipo: "VENTA", ref: ref(), semana, diaSemana: dia, seccion: "Cocina", items: itemsCocina, ...(esDesorden ? { sinCostoCongelado: true } : {}) });
      if (itemsBarra.length) eventos.push({ tipo: "VENTA", ref: ref(), semana, diaSemana: dia, seccion: "Barra", items: itemsBarra, ...(esDesorden ? { sinCostoCongelado: true } : {}) });
    }

    // --- Conteos físicos: 3 perfiles, en ambos extremos de la ventana (§5). ---
    if (semana === SEMANA_CONTEO_TEMPRANO) {
      eventos.push({
        tipo: "CONTEO_FISICO", ref: ref(), semana, diaSemana: 6, seccion: "Cocina", productoCodigo: "MP006",
        ajusteRelativo: -0.3, accion: "AJUSTAR", detalle: "Conteo de rutina — bien calibrado, diferencia mínima (fraccionamiento).",
      });
    }
    if (semana === SEMANA_CONTEO_RUIDOSO) {
      eventos.push({
        tipo: "CONTEO_FISICO", ref: ref(), semana, diaSemana: 6, seccion: "Cocina", productoCodigo: "MP010",
        ajusteRelativo: -0.8, accion: "AJUSTAR", detalle: "Conteo de rutina — se compra por balde (presentación de a 2kg), la fracción real nunca calza exacto con lo cargado.",
      });
    }
    if (semana === SEMANA_CONTEO_MERMA) {
      eventos.push({
        tipo: "CONTEO_FISICO", ref: ref(), semana, diaSemana: 6, seccion: "Cocina", productoCodigo: "MP008",
        ajusteRelativo: -1.8, accion: "AJUSTAR", detalle: "Conteo de rutina — faltante consistente con una merma real no registrada.",
      });
    }

    // --- Merma real (rotura). ---
    if (semana === SEMANA_MERMA) {
      eventos.push({ tipo: "MERMA", ref: ref(), semana, diaSemana: 3, seccion: "Barra", productoCodigo: "MX003", cantidad: 6, motivo: "ROTO_O_CAIDO", detalleLibre: "Se cayó un six-pack al acomodar la heladera." });
    }

    // --- Anulación + corrección de compra: episodio corto, con stock aún no consumido (§5). Se eligen DOS compras
    // DISTINTAS de esta semana (hay de sobra: proveedor habitual × varios, feria, descartables, bebidas) — la próxima
    // semana, una se anula (compra duplicada por error) y la otra se corrige (factura mal tipeada). ---
    if (semana === SEMANA_ANULACION) {
      refCompraParaAnular = refsCompraDeLaSemana[0] ?? null;
      refCompraParaCorregir = refsCompraDeLaSemana[1] ?? null;
    }
    if (semana === SEMANA_ANULACION + 1 && refCompraParaAnular) {
      eventos.push({ tipo: "ANULAR_COMPRA", ref: ref(), semana, diaSemana: 0, refCompra: refCompraParaAnular });
      refCompraParaAnular = null;
    }
    if (semana === SEMANA_ANULACION + 1 && refCompraParaCorregir) {
      eventos.push({ tipo: "CORREGIR_COMPRA", ref: ref(), semana, diaSemana: 1, refCompra: refCompraParaCorregir, nroFactura: "0001-00004521" });
      refCompraParaCorregir = null;
    }
  }

  return { eventos };
}
