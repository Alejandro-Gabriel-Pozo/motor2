import { redondearMoneda } from "@/core/moneda";
import { numeroDeEntrada, tieneALoSumoDecimales } from "./numero-tecleado";
import { aceptar, enMinuscula, rechazar, type ResultadoDato } from "./resultado";

/**
 * Importes de ENTRADA (precio de compra, precio local…): lo que se teclea o llega a una Server Action. "Redondeo uniforme" para la
 * entrada significa RECHAZAR más de 2 decimales, no redondear en silencio; `redondearMoneda` (src/core/moneda.ts)
 * sigue siendo para los montos CALCULADOS.
 */
export const DECIMALES_IMPORTE = 2;
/** Tope de las columnas `Decimal(14,2)` (mismo criterio que validarPrecioCarta): el importe tiene que ser menor. */
export const IMPORTE_MAXIMO = 1e12;
/** El mismo tope en CENTAVOS enteros, para las cuentas con `bigint`: el importe más grande que entra en la columna (99.999.999.999,99 → 99999999999999). */
export const CENTAVOS_MAXIMOS = BigInt(IMPORTE_MAXIMO * 100) - BigInt(1);

/**
 * NÚCLEO de los validadores de importe (ola «precio y carta», Fase 2, C): un `number` finito con a lo sumo 2 decimales, de cualquier signo y SIN tope. Es lo único que
 * comparten; el signo, el mínimo, el tope y los mensajes son la regla PROPIA de cada validador y se quedan en él (un precio que vio la pantalla no tiene tope; una
 * diferencia admite negativos; un precio de opción exige 0,01 o más). Para un importe que se va a GUARDAR, `esImporteDeColumna`.
 */
export function esImporteAlCentavo(n: number): boolean {
  return Number.isFinite(n) && tieneALoSumoDecimales(n, DECIMALES_IMPORTE);
}

/** Un importe que entra en una columna `Decimal(14,2)`: el núcleo (`esImporteAlCentavo`) y, en valor absoluto, menor que `IMPORTE_MAXIMO`. Cualquier signo: el signo lo decide quien llama. */
export function esImporteDeColumna(n: number): boolean {
  return esImporteAlCentavo(n) && Math.abs(n) < IMPORTE_MAXIMO;
}

/**
 * Un porcentaje de DIFERENCIA de precio en una columna `Decimal(7,4)` (`VersionDeOpcion_porcentaje_chk`): finito, mayor que -100 (bajar el 100 % deja el precio en 0),
 * hasta 999,9999 y con a lo sumo 4 decimales.
 */
export function esPorcentajeDeDiferencia(p: number): boolean {
  return Number.isFinite(p) && p > -100 && p <= 999.9999 && tieneALoSumoDecimales(p, 4);
}

export interface OpcionesImporte {
  /** Sujeto del mensaje, en mayúscula y masculino ("El precio", `El precio de "Harina"`): "El precio no puede ser negativo." */
  etiqueta: string;
  /** Vacío → error "Falta …" en vez de `null`. Default: false. */
  obligatorio?: boolean;
  /** Default: false. */
  permitirNegativo?: boolean;
  /** Default: true (una compra o un precio en 0 son válidos). */
  permitirCero?: boolean;
}

export function validarImporte(valor: unknown, opciones: OpcionesImporte): ResultadoDato<number | null> {
  const { etiqueta, obligatorio = false, permitirNegativo = false, permitirCero = true } = opciones;
  const numero = numeroDeEntrada(valor);
  if (!numero.ok) return rechazar("formato", `${etiqueta} no es un número válido.`);
  const n = numero.valor;
  if (n === null) return obligatorio ? rechazar("vacio", `Falta ${enMinuscula(etiqueta)}.`) : aceptar(null);
  if (n < 0 && !permitirNegativo) return rechazar("negativo", `${etiqueta} no puede ser negativo.`);
  if (n === 0 && !permitirCero) return rechazar("cero", `${etiqueta} tiene que ser mayor que cero.`);
  if (Math.abs(n) >= IMPORTE_MAXIMO) return rechazar("rango", `${etiqueta} es demasiado grande.`);
  if (!tieneALoSumoDecimales(n, DECIMALES_IMPORTE)) return rechazar("decimales", `${etiqueta} admite como máximo ${DECIMALES_IMPORTE} decimales.`);
  return aceptar(n);
}

/**
 * Los CENTAVOS (entero) de un importe de dinero que ya tiene a lo sumo 2 decimales (de una columna `Decimal(14,2)` pasada a `number`, o validado con
 * `validarImporte`). Redondea primero en decimal exacto (`redondearMoneda`) y después pasa a entero: así el ruido de la coma flotante (`0.1 + 0.2`) no
 * cambia el resultado. Es para COMPARAR dinero, nunca para hacer cuentas.
 */
export function centavosDeImporte(n: number): number {
  return Math.round(redondearMoneda(n) * 100);
}

/**
 * ¿Dos importes son el MISMO dinero, al centavo? La regla única del control del valor visto (ola «precio y carta», Fase 2): lo que vio la pantalla
 * contra lo que hay en la base, sin comparar `number` con `===` (`0.1 + 0.2 !== 0.3`). `null` es «sin importe» (un precio local que no hay): solo es
 * igual a otro `null`. Un valor no finito (`NaN`, `±Infinity`) no es igual a nada.
 */
export function mismosCentavos(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return centavosDeImporte(a) === centavosDeImporte(b);
}

/**
 * Los precios que una pantalla MOSTRÓ, por id (el control del valor visto de un «¿Aplicar $X también?»: ola «precio y carta», Fase 2): `undefined` o `null` es «ninguno» (el caso de uso
 * rechaza si hay algo que cambiar); si vienen, un objeto id → importe válido (no negativo, a lo sumo 2 decimales, dentro del tope). Cualquier otra forma se rechaza con `mensaje`.
 */
export function validarImportesVistosPorId(valor: unknown, mensaje: string): ResultadoDato<Record<string, number>> {
  if (valor === null || valor === undefined) return aceptar({});
  if (typeof valor !== "object" || Array.isArray(valor)) return rechazar("formato", mensaje);
  const vistos: [string, number][] = [];
  for (const [id, importe] of Object.entries(valor)) {
    const validado = validarImporte(importe, { etiqueta: "El precio que mostraba la pantalla", obligatorio: true });
    if (!validado.ok) return rechazar("formato", mensaje);
    vistos.push([id, validado.valor!]);
  }
  return aceptar(Object.fromEntries(vistos));
}
