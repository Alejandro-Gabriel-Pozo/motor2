/**
 * Guion de eventos tipado del seed de la demo (docs/planes-demo-y-claridad-reportes-2026-09-21.md §5, "Diseño recomendado":
 * "arquitectura en piezas puras + ejecutor + verificador, separando 'qué pasa' (el guion, testeable sin base) de 'cómo se
 * ejecuta' (llamadas a los server actions reales)"). Este archivo es la pieza "qué pasa": tipos de evento + la calculadora de
 * totales esperados, ninguno de los dos toca la base ni un server action — el ejecutor (paso siguiente del plan) es el que
 * recorre un `GuionDemo` y llama a `registrarMovimiento`/`registrarVenta`/etc. de verdad.
 *
 * Los eventos referencian productos/proveedores por CÓDIGO (`PRODUCTOS`/`PROVEEDORES` de seed-demo-pizzeria-data.ts), nunca por
 * id: a esta altura (guion puro, sin base) los ids todavía no existen — el ejecutor es quien los resuelve.
 */
import type { MotivoMerma } from "@prisma/client";

export type Seccion = "Cocina" | "Barra";

export interface ItemCompra {
  productoCodigo: string;
  cantidad: number;
  precioUnitario: number;
  /** Vence este lote (ej. una compra grande de oportunidad que después queda parte sin consumir) — reporte de vencimientos, §0 regla 4. */
  loteVencimiento?: Date;
}
export interface EventoCompra {
  tipo: "COMPRA";
  /** Referencia lógica ÚNICA del evento dentro del guion — la usan ANULAR_COMPRA/CORREGIR_COMPRA para apuntar a esta compra sin depender de un id de base todavía inexistente. */
  ref: string;
  semana: number;
  diaSemana: number;
  seccion: Seccion;
  proveedorCodigo: string | null;
  nroFactura?: string;
  items: ItemCompra[];
}

export interface ItemVenta {
  productoCodigo: string;
  cantidad: number;
}
export interface EventoVenta {
  tipo: "VENTA";
  ref: string;
  semana: number;
  diaSemana: number;
  seccion: Seccion;
  items: ItemVenta[];
  /** Ventas de los primeros 1-1,5 meses (tramo de desorden, §0) se cargan sin costo congelado a propósito — ver §5 "Ventas de los primeros 1-1,5 meses sin costo congelado (para '· reconstruido'/'· parcial')". El ejecutor decide cómo lograrlo (no es un campo que reciba registrarVenta); acá solo se documenta la intención. */
  sinCostoCongelado?: boolean;
}

export interface EventoProduccion {
  tipo: "PRODUCCION";
  ref: string;
  semana: number;
  diaSemana: number;
  seccion: Seccion;
  productoCodigo: string;
  cantidad: number;
}

export interface EventoConteoFisico {
  tipo: "CONTEO_FISICO";
  ref: string;
  semana: number;
  diaSemana: number;
  seccion: Seccion;
  productoCodigo: string;
  /**
   * Diferencia contra el saldo del sistema EN ESE MOMENTO (negativo = faltante, positivo = sobrante) — NO un valor absoluto: el
   * guion es puro y no simula el saldo acumulado del Kardex (eso lo hace de verdad Postgres, corriendo cada evento anterior). El
   * ejecutor lee el saldo real al llegar a este evento y calcula `conteoReal = saldoActual + ajusteRelativo` antes de llamar a
   * `registrarConteoFisico` — mismo patrón que ya usaba el seed de 30 días (`saldoActual - 1.4`), generalizado acá.
   */
  ajusteRelativo: number;
  accion: "AJUSTAR" | "FALTA_MOVIMIENTO" | "DESCARTAR";
  detalle?: string;
}

export interface EventoMerma {
  tipo: "MERMA";
  ref: string;
  semana: number;
  diaSemana: number;
  seccion: Seccion;
  productoCodigo: string;
  cantidad: number;
  motivo: MotivoMerma;
  detalleLibre?: string;
}

/**
 * Da de alta la receta de un producto EN ESE MOMENTO del guion, no en el catálogo inicial — el mecanismo detrás de "recetas
 * incompletas" del tramo de desorden (§0, docs/planes-demo-y-claridad-reportes-2026-09-21.md): mientras la receta no existe,
 * una VENTA de ese producto no puede congelar costo (`registrarVenta` necesita la receta para costear al vender), así que
 * queda con `costoUnitarioVenta: null` — exactamente lo que hace falta para que el margen Real de esas ventas salga
 * "reconstruido"/"parcial" más adelante. La reconstrucción usa la receta VIGENTE HOY (ver costo-historico.ts), así que basta con
 * que la receta exista para cuando se genera el reporte — no hace falta que existiera el día de la venta.
 */
export interface EventoCrearReceta {
  tipo: "CREAR_RECETA";
  ref: string;
  semana: number;
  diaSemana: number;
  productoCodigo: string;
}

export interface EventoAnularCompra {
  tipo: "ANULAR_COMPRA";
  ref: string;
  semana: number;
  diaSemana: number;
  /** `ref` del EventoCompra que anula — tiene que existir antes en el guion (mismo orden cronológico que exige el Kardex append-only real). */
  refCompra: string;
}

export interface EventoCorregirCompra {
  tipo: "CORREGIR_COMPRA";
  ref: string;
  semana: number;
  diaSemana: number;
  refCompra: string;
  /** Campos a corregir — mismo shape parcial que acepta corregirCompra (proveedor, N.º de factura, precios). */
  proveedorCodigo?: string | null;
  nroFactura?: string;
}

export type EventoDemo = EventoCompra | EventoVenta | EventoProduccion | EventoConteoFisico | EventoMerma | EventoCrearReceta | EventoAnularCompra | EventoCorregirCompra;

export interface GuionDemo {
  eventos: EventoDemo[];
}

/** Todas las `ref` del guion, en el orden en que aparecen — para validar unicidad y para que ANULAR_COMPRA/CORREGIR_COMPRA puedan resolver su `refCompra`. */
export function refsDelGuion(guion: GuionDemo): string[] {
  return guion.eventos.map((e) => e.ref);
}

/**
 * Valida invariantes estructurales del guion ANTES de ejecutarlo contra una base real — atrapar acá un guion mal armado es
 * mucho más barato que descubrirlo a mitad de una corrida de 6 meses contra Postgres. Devuelve la lista de problemas (vacía si
 * está todo bien), nunca lanza: quien llama decide si un guion con problemas se ejecuta igual o no.
 */
export function validarGuion(guion: GuionDemo): string[] {
  const problemas: string[] = [];
  const refsVistas = new Set<string>();
  const refsDeCompra = new Set<string>();

  for (const [i, ev] of guion.eventos.entries()) {
    if (refsVistas.has(ev.ref)) problemas.push(`ref duplicada: "${ev.ref}" (evento #${i})`);
    refsVistas.add(ev.ref);
    if (ev.tipo === "COMPRA") refsDeCompra.add(ev.ref);
  }

  let semanaAnterior = -Infinity;
  for (const [i, ev] of guion.eventos.entries()) {
    if (ev.semana < semanaAnterior) problemas.push(`evento #${i} ("${ev.ref}") va en la semana ${ev.semana}, antes que un evento anterior de la semana ${semanaAnterior} — el guion tiene que venir en orden cronológico`);
    semanaAnterior = Math.max(semanaAnterior, ev.semana);

    if (ev.tipo === "ANULAR_COMPRA" || ev.tipo === "CORREGIR_COMPRA") {
      if (!refsDeCompra.has(ev.refCompra)) problemas.push(`${ev.tipo} "${ev.ref}" referencia una compra inexistente: "${ev.refCompra}"`);
    }
  }

  return problemas;
}

export interface TotalesDeCompras {
  totalGastado: number;
  /** Clave: proveedorCodigo, o "SIN_PROVEEDOR". */
  porProveedor: Map<string, number>;
  /** Compras (operaciones) que NO terminaron anuladas por un ANULAR_COMPRA posterior. */
  cantidadCompras: number;
}
export interface TotalesDeVentas {
  totalFacturado: number;
  porProducto: Map<string, number>;
  cantidadVendidaPorProducto: Map<string, number>;
}
export interface TotalesEsperados {
  compras: TotalesDeCompras;
  ventas: TotalesDeVentas;
}

/**
 * Totales que el guion, por sí solo, PROMETE que el sistema va a mostrar una vez ejecutado — la mitad "esperada" de las
 * conciliaciones de §5 (gasto del período = compras registradas = pivote por proveedor; ingreso = ventas por producto). No
 * incluye stock/Kardex a propósito: el saldo de cada producto depende de la receta (qué consume una VENTA/PRODUCCION), que es
 * lógica de dominio que ya vive en costos.ts/periodo.ts — reimplementarla acá sería duplicar esa lógica con el riesgo de que las
 * dos copias diverjan. El saldo se verifica más adelante (paso "invariantes de dominio"), comparando el sistema CONTRA SÍ MISMO
 * (Kardex = valuación = stock consolidado), no contra un cálculo aparte.
 *
 * `precioVentaPorCodigo`: el catálogo (PRODUCTOS de seed-demo-pizzeria-data.ts) es un insumo externo al guion, no algo que el
 * guion module conozca — se pasa explícito para que esta función siga siendo pura (sin importar datos "de verdad" del seed).
 */
export function calcularTotalesEsperados(guion: GuionDemo, precioVentaPorCodigo: ReadonlyMap<string, number>): TotalesEsperados {
  const refsCompraAnuladas = new Set(guion.eventos.filter((e): e is EventoAnularCompra => e.tipo === "ANULAR_COMPRA").map((e) => e.refCompra));

  const compras: TotalesDeCompras = { totalGastado: 0, porProveedor: new Map(), cantidadCompras: 0 };
  const ventas: TotalesDeVentas = { totalFacturado: 0, porProducto: new Map(), cantidadVendidaPorProducto: new Map() };

  for (const ev of guion.eventos) {
    if (ev.tipo === "COMPRA") {
      if (refsCompraAnuladas.has(ev.ref)) continue; // anulada: no cuenta ni en el total ni por proveedor, mismo criterio que K1c
      compras.cantidadCompras += 1;
      const clave = ev.proveedorCodigo ?? "SIN_PROVEEDOR";
      let importeCompra = 0;
      for (const item of ev.items) importeCompra += item.cantidad * item.precioUnitario;
      compras.totalGastado += importeCompra;
      compras.porProveedor.set(clave, (compras.porProveedor.get(clave) ?? 0) + importeCompra);
    } else if (ev.tipo === "VENTA") {
      for (const item of ev.items) {
        const precioVenta = precioVentaPorCodigo.get(item.productoCodigo);
        if (precioVenta === undefined) throw new Error(`calcularTotalesEsperados: sin precioVenta para "${item.productoCodigo}" (evento "${ev.ref}")`);
        const importe = item.cantidad * precioVenta;
        ventas.totalFacturado += importe;
        ventas.porProducto.set(item.productoCodigo, (ventas.porProducto.get(item.productoCodigo) ?? 0) + importe);
        ventas.cantidadVendidaPorProducto.set(item.productoCodigo, (ventas.cantidadVendidaPorProducto.get(item.productoCodigo) ?? 0) + item.cantidad);
      }
    }
  }

  compras.totalGastado = redondear(compras.totalGastado);
  for (const [k, v] of compras.porProveedor) compras.porProveedor.set(k, redondear(v));
  ventas.totalFacturado = redondear(ventas.totalFacturado);
  for (const [k, v] of ventas.porProducto) ventas.porProducto.set(k, redondear(v));

  return { compras, ventas };
}

function redondear(importe: number): number {
  return Math.round(importe * 100) / 100;
}
