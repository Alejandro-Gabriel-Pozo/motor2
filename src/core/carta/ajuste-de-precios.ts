import { CENTAVOS_MAXIMOS } from "@/core/datos/importe";

/**
 * CARTA-MANT F4 («Precios», prototipo aprobado: «Ajustar sección» con vista previa): el CÁLCULO del precio nuevo de un producto al subir o bajar una sección entera (o uno solo), en DECIMAL
 * EXACTO. Puro: trabaja en CENTAVOS con enteros (`bigint`), nunca con coma flotante; entra y sale como texto decimal con dos decimales («14900.00»), como `Decimal(14,2)` en la base.
 *
 * Regla (escrita acá para que sea una sola):
 *  1. El ajuste: un PORCENTAJE (hasta dos decimales: «12,5 %») o un MONTO en pesos (hasta dos decimales), para subir o para bajar; o, para un producto solo, el PRECIO nuevo tal cual (sin redondeo).
 *  2. Con porcentaje, lo que suma o resta se redondea AL CENTAVO, mitades hacia arriba (de 0,005 en adelante sube): 14.900 × 12,5 % = 1.862,50.
 *  3. REDONDEO: DECISIÓN DEL DUEÑO (2026-10-14): SIN redondeo, el precio queda al centavo; la pantalla NO ofrece elegir redondeo (manda siempre `REDONDEO_POR_DEFECTO`, 0). El cálculo puro conserva
 *     el redondeo configurable (al MÚLTIPLO más cercano de $10, $50 o $100, mitades hacia arriba: $14.905 a $10 → $14.910) por si algún día se expone; ojo con «al más cercano»: un aumento chico
 *     puede quedar en el mismo precio o un poco por debajo (subir $14.903 un 0,01 % y redondear a $10 da $14.900). Si se prefiere «al subir, hacia arriba», se cambia SOLO `redondearAlMultiplo`.
 *  4. Piso: el precio nunca queda en $0 ni negativo: como mínimo $0,01, o el múltiplo elegido si hay redondeo.
 */

const REDONDEOS_DE_PRECIO = [0, 10, 50, 100] as const;
/** En pesos; 0 = sin redondeo (al centavo). */
export type RedondeoDePrecio = (typeof REDONDEOS_DE_PRECIO)[number];
/** Decisión del dueño (2026-10-14): sin redondeo (al centavo); es lo único que manda la pantalla. */
export const REDONDEO_POR_DEFECTO: RedondeoDePrecio = 0;

export interface AjusteDePrecio {
  /** En `precio` no se usa. */
  direccion: "subir" | "bajar";
  /** `precio`: el precio nuevo tal cual («Cambiar precio» de un producto); no se le aplica el redondeo. */
  modo: "porcentaje" | "monto" | "precio";
  /** Texto decimal positivo con hasta dos decimales («10», «12,5», «1500.50»). */
  valor: string;
  redondeo: RedondeoDePrecio;
}

/** Tope de un porcentaje (subir más de 5 veces, o bajar el 100 % o más, es un error de tipeo). */
// Sin literales `123n`: el proyecto compila a ES2017 (tsconfig), que no los admite; `BigInt(…)` es lo mismo.
const CERO = BigInt(0);
const UNO = BigInt(1);
const DOS = BigInt(2);
const CIEN = BigInt(100);
const DIEZ_MIL = BigInt(10000);
const PORCENTAJE_MAXIMO_AL_SUBIR = BigInt(50000);
const PORCENTAJE_MAXIMO_AL_BAJAR = BigInt(9999);

/** «14900», «14900,50», «14900.5» → centavos. Acepta coma o punto decimal (no separador de miles: «14.900» con punto es 14,9). `null` si no es un número positivo o cero con hasta dos decimales. */
export function aCentavos(texto: string): bigint | null {
  const limpio = texto.trim().replace(",", ".");
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(limpio);
  if (!m) return null;
  return BigInt(m[1]!) * CIEN + BigInt((m[2] ?? "").padEnd(2, "0"));
}

/** Centavos → «14900.50» (dos decimales, sin separador de miles). */
export function deCentavos(centavos: bigint): string {
  const signo = centavos < CERO ? "-" : "";
  const abs = centavos < CERO ? -centavos : centavos;
  return `${signo}${abs / CIEN}.${String(abs % CIEN).padStart(2, "0")}`;
}

/** `n / d` redondeado al entero más cercano, mitades hacia arriba (n >= 0, d > 0). */
function dividirRedondeando(n: bigint, d: bigint): bigint {
  return (n * DOS + d) / (DOS * d);
}

/** Al múltiplo de `multiplo` centavos más cercano, mitades hacia arriba (`centavos` >= 0). */
function redondearAlMultiplo(centavos: bigint, multiplo: bigint): bigint {
  return dividirRedondeando(centavos, multiplo) * multiplo;
}

export type ValidacionDeAjuste = { ok: true; valor: AjusteDePrecio } | { ok: false; mensaje: string };

/** El ajuste tal como llega de la pantalla, validado (la Server Action lo vuelve a validar con esta MISMA función). */
export function validarAjusteDePrecio(entrada: { direccion?: unknown; modo?: unknown; valor?: unknown; redondeo?: unknown }): ValidacionDeAjuste {
  const { direccion, modo, valor, redondeo } = entrada;
  if (direccion !== "subir" && direccion !== "bajar") return { ok: false, mensaje: "Elegí si se sube o se baja." };
  if (modo !== "porcentaje" && modo !== "monto" && modo !== "precio") return { ok: false, mensaje: "Elegí si el ajuste es en % o en $." };
  if (typeof redondeo !== "number" || !(REDONDEOS_DE_PRECIO as readonly number[]).includes(redondeo)) return { ok: false, mensaje: "El redondeo no es válido." };
  const cent = typeof valor === "string" ? aCentavos(valor) : null;
  if (cent === null || cent === CERO) return { ok: false, mensaje: modo === "precio" ? "Escribí el precio nuevo, mayor que 0 y con hasta dos decimales." : "Escribí cuánto, un número mayor que 0 con hasta dos decimales." };
  if (modo === "porcentaje" && cent > (direccion === "subir" ? PORCENTAJE_MAXIMO_AL_SUBIR : PORCENTAJE_MAXIMO_AL_BAJAR)) {
    return { ok: false, mensaje: direccion === "subir" ? "Un aumento de más del 500 % parece un error de tipeo." : "Bajar el 100 % o más dejaría el precio en $0." };
  }
  return { ok: true, valor: { direccion, modo, valor: deCentavos(cent), redondeo: redondeo as RedondeoDePrecio } };
}

/** El precio nuevo (texto con dos decimales) de un producto que hoy cuesta `precioActual`, con el ajuste ya validado. */
export function precioAjustado(precioActual: string, ajuste: AjusteDePrecio): string {
  const actual = aCentavos(precioActual);
  const valor = aCentavos(ajuste.valor);
  if (actual === null || valor === null) throw new Error(`precioAjustado: precio o ajuste no válido («${precioActual}», «${ajuste.valor}»)`);
  if (ajuste.modo === "precio") return deCentavos(valor > CENTAVOS_MAXIMOS ? CENTAVOS_MAXIMOS : valor);
  // En porcentaje, `valor` son centésimos de punto (12,5 % = 1250): delta = actual × valor / 10.000, al centavo.
  const delta = ajuste.modo === "porcentaje" ? dividirRedondeando(actual * valor, DIEZ_MIL) : valor;
  let nuevo = ajuste.direccion === "subir" ? actual + delta : actual - delta;
  const multiplo = BigInt(ajuste.redondeo) * CIEN;
  if (nuevo < CERO) nuevo = CERO;
  if (multiplo > CERO) nuevo = redondearAlMultiplo(nuevo, multiplo);
  const piso = multiplo > CERO ? multiplo : UNO;
  if (nuevo < piso) nuevo = piso;
  if (nuevo > CENTAVOS_MAXIMOS) nuevo = multiplo > CERO ? (CENTAVOS_MAXIMOS / multiplo) * multiplo : CENTAVOS_MAXIMOS;
  return deCentavos(nuevo);
}
