import { valido, type ResultadoDeRegla } from "@/core/datos/resultado-de-regla";
import type { DatoDelCobro, DatosQuePideElMedio } from "./medios";

/**
 * Los datos opcionales de un cobro (etapa C3; Pedernal `src/modulos/caja/dominio/datos-del-cobro.ts` y las fichas `cupon-de-pago`, `ultimos-cuatro-digitos-de-la-tarjeta`, `cuotas-del-cobro`, decisión 129). Nunca bloquean: ausente es
 * válido; mal escrito es error con el nombre del dato y no deja cobrar hasta corregir o vaciar; un dato que el medio no pidió se rechaza (la pantalla no lo ofrece y el servidor no lo confía). Nunca se guarda el número de la tarjeta: un
 * cupón que lo parece se rechaza y los últimos 4 no se truncan. Cada regla es una LISTA DE PERMITIDOS (forma, largo, conjunto) y la repite la base (`Cobro_cupon_chk`, `Cobro_ultimos4_chk`, `Cobro_cuotas_chk`, `Cobro_dni_chk`).
 * «Obligatorio» por dato no existe (diseñado y no construido en Pedernal).
 *
 * Puro: sin reloj, sin azar, sin I/O.
 */
export interface DatosDelCobro {
  readonly cupon?: string;
  readonly ultimos4?: string;
  /** El id (UUID) de una marca activa de la lista `MARCAS_DE_TARJETA`; que exista y esté activa lo mira el caso de uso (y la base). */
  readonly marcaDeTarjetaId?: string;
  readonly cuotas?: number;
  readonly dni?: string;
}

/** Los datos en su forma completa: lo que no vino es `null`. Es lo que se guarda y lo que entra a la huella. */
export interface DatosDelCobroCompletos {
  readonly cupon: string | null;
  readonly ultimos4: string | null;
  readonly marcaDeTarjetaId: string | null;
  readonly cuotas: number | null;
  readonly dni: string | null;
}

/** `FORMA`: el dato no tiene la forma permitida. `NUMERO_DE_TARJETA`: el cupón parece el número de una tarjeta. `NO_DISPONIBLE`: la marca no existe o está desactivada (lo decide el caso de uso). */
export type MotivoDeDatoInvalido = "FORMA" | "NUMERO_DE_TARJETA" | "NO_DISPONIBLE";

export type ErrorDeDatoDelCobro =
  | { readonly codigo: "DATO_DE_COBRO_NO_HABILITADO"; readonly dato: DatoDelCobro }
  | { readonly codigo: "DATO_DE_COBRO_INVALIDO"; readonly dato: DatoDelCobro; readonly motivo: MotivoDeDatoInvalido };

const FORMA_DEL_CUPON = /^[A-Za-z0-9._/-]{1,32}$/;
const SEPARADORES_DEL_CUPON = /[._/-]/g;
const TRECE_DIGITOS_SEGUIDOS = /[0-9]{13}/;
const TIENE_LETRA_O_DIGITO = /[A-Za-z0-9]/;
const CUATRO_DIGITOS = /^[0-9]{4}$/;
const FORMA_DEL_DNI = /^[1-9][0-9]{5,8}$/;
const FORMA_DE_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MAXIMO_DE_CUOTAS = 36;
/** Suma de los dígitos de un dígito duplicado (control de Luhn): 0→0, 1→2, …, 5→1, …, 9→9. */
const DIGITO_DUPLICADO = [0, 2, 4, 6, 8, 1, 3, 5, 7, 9] as const;

function pasaLuhn(digitos: string): boolean {
  let suma = 0;
  let duplicar = false;
  for (let i = digitos.length - 1; i >= 0; i -= 1) {
    const valor = digitos.charCodeAt(i) - 48;
    suma += duplicar ? (DIGITO_DUPLICADO[valor] ?? 0) : valor;
    duplicar = !duplicar;
  }
  return suma % 10 === 0;
}

/** Un número de tarjeta pegado en el cupón: 13 dígitos seguidos (aun con separadores en el medio) o 13 a 19 dígitos en total que pasan Luhn. */
function pareceNumeroDeTarjeta(valor: string): boolean {
  if (TRECE_DIGITOS_SEGUIDOS.test(valor.replace(SEPARADORES_DEL_CUPON, ""))) return true;
  const digitos = valor.replace(/[^0-9]/g, "");
  return digitos.length >= 13 && digitos.length <= 19 && pasaLuhn(digitos);
}

function motivoDelCupon(valor: unknown): MotivoDeDatoInvalido | null {
  if (typeof valor !== "string" || !FORMA_DEL_CUPON.test(valor) || !TIENE_LETRA_O_DIGITO.test(valor)) return "FORMA";
  return pareceNumeroDeTarjeta(valor) ? "NUMERO_DE_TARJETA" : null;
}

const VALIDADORES: Readonly<Record<DatoDelCobro, (valor: unknown) => MotivoDeDatoInvalido | null>> = {
  cupon: motivoDelCupon,
  ultimos4: (valor) => (typeof valor === "string" && CUATRO_DIGITOS.test(valor) ? null : "FORMA"),
  marca: (valor) => (typeof valor === "string" && FORMA_DE_UUID.test(valor) ? null : "FORMA"),
  cuotas: (valor) => (typeof valor === "number" && Number.isInteger(valor) && valor >= 1 && valor <= MAXIMO_DE_CUOTAS ? null : "FORMA"),
  dni: (valor) => (typeof valor === "string" && FORMA_DEL_DNI.test(valor) ? null : "FORMA"),
};

/** Dato → campo de `DatosDelCobro`, en el orden en que se revisan. */
const CAMPOS: readonly (readonly [DatoDelCobro, keyof DatosDelCobro])[] = [
  ["cupon", "cupon"],
  ["ultimos4", "ultimos4"],
  ["marca", "marcaDeTarjetaId"],
  ["cuotas", "cuotas"],
  ["dni", "dni"],
];

/** Qué datos trae el cobro (la lista que va a la auditoría: NUNCA los valores). */
export function datosCompletados(datos: DatosDelCobro): readonly DatoDelCobro[] {
  return CAMPOS.filter(([, campo]) => datos[campo] !== undefined).map(([dato]) => dato);
}

/**
 * Valida los datos contra lo que el medio pidió, en el orden cupón, últimos 4, marca, cuotas y DNI, y devuelve el primer error: primero si el dato no está habilitado, después si está mal escrito. Solo `undefined` es
 * «no vino»: un texto vacío o un `null` es un dato mal escrito (la frontera convierte el campo vacío en ausente).
 */
export function validarDatosDelCobro(datos: DatosDelCobro, habilitados: DatosQuePideElMedio): ResultadoDeRegla<DatosDelCobroCompletos, never> | { readonly ok: false; readonly error: ErrorDeDatoDelCobro } {
  for (const [dato, campo] of CAMPOS) {
    const valor = datos[campo];
    if (valor === undefined) continue;
    if (!habilitados[dato]) return { ok: false, error: { codigo: "DATO_DE_COBRO_NO_HABILITADO", dato } };
    const motivo = VALIDADORES[dato](valor);
    if (motivo !== null) return { ok: false, error: { codigo: "DATO_DE_COBRO_INVALIDO", dato, motivo } };
  }
  return valido(datosEnFormaCompleta(datos));
}

/**
 * Los datos en su forma completa SIN juzgarlos: la huella de un cobro se arma antes de leer qué pide el medio (la clave de reintento se mira primero) y una repetición tiene que dar la misma huella que el pedido original.
 */
export function datosEnFormaCompleta(datos: DatosDelCobro | undefined): DatosDelCobroCompletos {
  return {
    cupon: datos?.cupon ?? null,
    ultimos4: datos?.ultimos4 ?? null,
    marcaDeTarjetaId: datos?.marcaDeTarjetaId ?? null,
    cuotas: datos?.cuotas ?? null,
    dni: datos?.dni ?? null,
  };
}

/** ¿El cobro no trae ningún dato? (Un cobro sin datos conserva la forma vieja de la huella.) */
export function sinDatos(datos: DatosDelCobroCompletos): boolean {
  return Object.values(datos).every((v) => v === null);
}
