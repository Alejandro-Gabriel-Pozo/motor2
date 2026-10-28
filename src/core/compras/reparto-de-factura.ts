import { Decimal } from "decimal.js";

/**
 * E3a: el reparto EXACTO de una factura de proveedor de mercadería entre sucursales (docs/diseno-factura-de-proveedor-e3a-2026-10-27.md, §4 y nivel 5, D1 a D3, D9, D11, D12).
 *
 * Pura y sin I/O. La usan el caso de uso (que decide) y la pantalla (vista previa: la misma cuenta, nunca la manda hecha). Todo el dinero se maneja en CENTAVOS ENTEROS y las
 * cantidades en PASOS ENTEROS de la unidad (`10^-decimales`), con `Decimal` solo para multiplicar y dividir sin perder exactitud.
 *
 * Reglas (decisión 4 del dueño, 2026-10-27: «tengo que saber cuánto le costó a cada una»):
 *  1. Pesos de cada sucursal: si se tipearon IMPORTES, esos importes (tienen que sumar el total exacto); si se tipearon PORCENTAJES (en puntos básicos, suman 10000), el total repartido por
 *     mayor residuo. El porcentaje declarado que se guarda (`porcentajeDeclaradoBp`) es la intención: con importes, el mayor residuo de 10000 con piso 1 (la base exige 1..10000); nunca atribuye dinero.
 *  2. Matriz renglón × sucursal con las DOS sumas exactas: cada renglón se reparte por mayor residuo con lo que le RESTA a cada sucursal (presupuesto remanente) y el último se lleva el resto. Así
 *     cada renglón suma su importe (D2) y cada sucursal suma su peso (D3), sin negativos (medido: 200.000 casos al azar, desvío de una celda contra su proporción ideal de 0,8 a 7,8 centavos
 *     según 2 a 50 renglones; el «redondeo acumulado» daba celdas negativas).
 *  3. Cantidades: cada renglón reparte su cantidad en pasos de su unidad con los pesos de sus celdas (o con los pesos de las sucursales si el renglón vale 0), así el precio por unidad de cada
 *     celda queda cerca del del renglón.
 *  4. Rechazos: total 0 con importes (D12), una celda con dinero y sin cantidad (producto indivisible, D11), una sucursal sin ninguna cantidad.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Pesos en centavos de un número de pesos con hasta 2 decimales (`12.5` → 1250). */
export function aCentavos(importe: number): number {
  return new D(importe).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** `total` (entero ≥ 0) en partes enteras proporcionales a `pesos` (≥ 0), por MAYOR RESIDUO; a igual resto gana el índice más bajo. Sin ningún peso positivo, partes iguales. */
export function repartirEnteros(total: number, pesos: readonly number[]): number[] {
  if (pesos.length === 0) return [];
  const positivos = pesos.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  const suma = positivos.reduce((s, p) => s.plus(p), new D(0));
  const efectivos = suma.gt(0) ? positivos : pesos.map(() => 1);
  const sumaEfectiva = suma.gt(0) ? suma : new D(pesos.length);
  const exactos = efectivos.map((p) => new D(total).times(p).dividedBy(sumaEfectiva));
  const pisos = exactos.map((e) => e.toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber());
  const restante = total - pisos.reduce((s, v) => s + v, 0);
  const orden = exactos.map((e, i) => ({ i, resto: e.minus(pisos[i]!) })).sort((a, b) => b.resto.comparedTo(a.resto) || a.i - b.i);
  const partes = [...pisos];
  for (let k = 0; k < restante; k++) partes[orden[k]!.i]! += 1;
  return partes;
}

/** Matriz renglón × sucursal (centavos) con presupuesto remanente: fila i suma `renglones[i]` y columna j suma `presupuestos[j]`. Exige Σ renglones = Σ presupuestos. */
export function repartirMatriz(renglones: readonly number[], presupuestos: readonly number[]): number[][] {
  const restante = [...presupuestos];
  return renglones.map((importe, i) => {
    const fila = i === renglones.length - 1 ? [...restante] : importe === 0 ? restante.map(() => 0) : repartirEnteros(importe, restante);
    fila.forEach((v, j) => (restante[j]! -= v));
    return fila;
  });
}

/** Una cantidad (en unidad de stock) repartida en pasos de `10^-decimales` por mayor residuo. */
export function repartirCantidad(cantidad: number, pesos: readonly number[], decimales: number): number[] {
  const paso = new D(10).pow(decimales);
  const pasos = new D(cantidad).times(paso).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return repartirEnteros(pasos, pesos).map((n) => new D(n).dividedBy(paso).toNumber());
}

export type ModoDeReparto = "IMPORTE" | "PORCENTAJE";

export interface RenglonARepartir {
  /** Para los mensajes. */
  nombre: string;
  /** Lo pagado por el renglón, con IVA incluido (pesos, 2 decimales). */
  precioTotal: number;
  /** En unidad de stock, ya redondeada a sus decimales. */
  cantidadStock: number;
  /** Decimales de la unidad de stock del producto (0 a 4). */
  decimales: number;
}

export interface CeldaDeReparto {
  cantidadStock: number;
  /** Pesos, 2 decimales. */
  precioTotal: number;
}

export type RepartoDeFactura =
  | {
      ok: true;
      /** Total de la factura (pesos). */
      total: number;
      /** Por sucursal (en el orden recibido): lo que le toca en pesos y el porcentaje declarado en puntos básicos. */
      partes: { importe: number; porcentajeDeclaradoBp: number }[];
      /** `celdas[renglón][sucursal]`. */
      celdas: CeldaDeReparto[][];
    }
  | { ok: false; mensaje: string };

/**
 * El reparto completo de una factura. `valores` va en el orden de las sucursales: importes en pesos (modo IMPORTE) o porcentajes con hasta 2 decimales (modo PORCENTAJE, 33,33 = 3333 puntos básicos).
 * Una sola sucursal (100 %) es el caso degenerado: todo le toca a ella.
 */
export function repartirFactura(renglones: readonly RenglonARepartir[], modo: ModoDeReparto, valores: readonly number[]): RepartoDeFactura {
  if (!renglones.length) return { ok: false, mensaje: "La factura no tiene renglones." };
  if (!valores.length) return { ok: false, mensaje: "Elegí al menos una sucursal." };
  if (valores.some((v) => !Number.isFinite(v) || v <= 0)) {
    return { ok: false, mensaje: modo === "IMPORTE" ? "El importe de cada sucursal tiene que ser mayor que cero." : "El porcentaje de cada sucursal tiene que ser mayor que cero." };
  }
  const renglonesCentavos = renglones.map((r) => aCentavos(r.precioTotal));
  const totalCentavos = renglonesCentavos.reduce((s, v) => s + v, 0);

  let presupuestos: number[];
  let bp: number[];
  if (modo === "IMPORTE") {
    if (totalCentavos === 0) return { ok: false, mensaje: "La factura suma $0: para repartirla por importe tiene que tener un total." };
    presupuestos = valores.map(aCentavos);
    const diferencia = totalCentavos - presupuestos.reduce((s, v) => s + v, 0);
    if (diferencia !== 0) {
      const pesos = new D(Math.abs(diferencia)).dividedBy(100).toFixed(2);
      return { ok: false, mensaje: diferencia > 0 ? `Los importes de las sucursales no llegan al total: faltan $${pesos}.` : `Los importes de las sucursales pasan el total: sobran $${pesos}.` };
    }
    bp = puntosBasicosConPiso(presupuestos);
  } else {
    bp = valores.map((v) => new D(v).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber());
    if (valores.some((v, j) => !new D(v).times(100).equals(bp[j]!))) return { ok: false, mensaje: "Los porcentajes admiten hasta dos decimales." };
    const suma = bp.reduce((s, v) => s + v, 0);
    if (suma !== 10000) return { ok: false, mensaje: `Los porcentajes tienen que sumar 100 %: suman ${new D(suma).dividedBy(100).toFixed(2)} %.` };
    presupuestos = repartirEnteros(totalCentavos, bp);
  }

  const matriz = repartirMatriz(renglonesCentavos, presupuestos);
  const celdas: CeldaDeReparto[][] = [];
  for (let i = 0; i < renglones.length; i++) {
    const r = renglones[i]!;
    const pesos = renglonesCentavos[i]! > 0 ? matriz[i]! : presupuestos;
    const cantidades = repartirCantidad(r.cantidadStock, pesos, r.decimales);
    // El presupuesto remanente garantiza que ninguna celda quede negativa; si pasara, es un error de programación y no se escribe nada.
    if (matriz[i]!.some((c) => c < 0)) throw new Error("repartirFactura: celda negativa en el reparto (no debería pasar con el presupuesto remanente).");
    const fila = matriz[i]!.map((centavos, j) => ({ cantidadStock: cantidades[j]!, precioTotal: new D(centavos).dividedBy(100).toNumber() }));
    if (fila.some((c) => c.precioTotal > 0 && c.cantidadStock === 0)) {
      return { ok: false, mensaje: `«${r.nombre}» no se puede partir en esas proporciones (alguna sucursal se quedaría con plata y sin mercadería): cargalo en una factura aparte o cambiá el reparto.` };
    }
    celdas.push(fila);
  }
  const sinMercaderia = valores.findIndex((_, j) => celdas.every((fila) => fila[j]!.cantidadStock === 0));
  if (sinMercaderia >= 0) return { ok: false, mensaje: "Una de las sucursales no recibiría ninguna mercadería con ese reparto: sacala del reparto o cambiá los valores." };

  return {
    ok: true,
    total: new D(totalCentavos).dividedBy(100).toNumber(),
    partes: presupuestos.map((c, j) => ({ importe: new D(c).dividedBy(100).toNumber(), porcentajeDeclaradoBp: bp[j]! })),
    celdas,
  };
}

/** Puntos básicos (suman 10000) proporcionales a los importes, con piso 1 para toda sucursal con importe (la base exige 1..10000): el piso se le descuenta a la de mayor porcentaje. */
function puntosBasicosConPiso(centavos: readonly number[]): number[] {
  const bp = repartirEnteros(10000, centavos);
  for (let j = 0; j < bp.length; j++) {
    if (bp[j] === 0 && centavos[j]! > 0) {
      const mayor = bp.indexOf(Math.max(...bp));
      bp[mayor]! -= 1;
      bp[j] = 1;
    }
  }
  return bp;
}
