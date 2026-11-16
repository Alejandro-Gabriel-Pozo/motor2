/**
 * ORÁCULO DE COMBINACIONES DEL COBRO (etapa C3; regla del dueño del 2026-10-28, «Combinaciones»): las reglas esperadas escritas APARTE del código, en forma de tabla legible. Los tests (`oraculo-de-combinaciones-del-cobro.test.ts`)
 * recorren TODAS las combinaciones de las dimensiones de abajo contra este archivo, sobre el núcleo puro y sobre la base real. Si el código y este archivo discrepan, uno de los dos está mal: no se «arregla» el test copiando el código.
 * Este archivo NO importa nada de `src/` a propósito.
 *
 * DIMENSIONES cuyas combinaciones cambian dinero, permisos, visibilidad o stock (decláralo acá o el guardián falla):
 *   1. tipo de medio              (6)  EFECTIVO, TARJETA_DEBITO, TARJETA_CREDITO, TRANSFERENCIA, QR, OTRO
 *   2. qué datos pide el medio    (5)  cupón, últimos 4, marca, cuotas, DNI (cada uno sí/no, con el techo por tipo)
 *   3. qué datos manda el cobro   (5)  los mismos cinco (cada uno presente/ausente)
 *   4. la cuenta de cobro         (5)  ninguna, compatible, incompatible, inactiva, de otra sucursal
 *
 * REGLAS (en el orden en que el caso de uso las revisa, y cada una gana sobre las que le siguen):
 *   R1. El efectivo no lleva cuenta de cobro: cualquier cuenta con efectivo → CUENTA_DE_COBRO_NO_ADMITIDA.
 *   R2. Una cuenta de otra sucursal → CUENTA_DE_COBRO_DE_OTRA_SUCURSAL.
 *   R3. Una cuenta inactiva → CUENTA_DE_COBRO_INACTIVA.
 *   R4. Una cuenta de un tipo que el medio no admite → CUENTA_DE_COBRO_INCOMPATIBLE.
 *   R5. Ninguna cuenta, o una compatible, activa y de la sucursal → el renglón pasa a los datos.
 *   R6. Un dato que el cobro manda y el medio NO pide → DATO_DE_COBRO_NO_HABILITADO (el primero en el orden cupón, últimos 4, marca, cuotas, DNI).
 *   R7. Un dato que el cobro manda y el medio pide (con forma válida) → entra. Pedir un dato y no mandarlo es válido (ninguno es obligatorio).
 *   R8. El techo por tipo: un medio no puede PEDIR un dato fuera de su lista (DATO_NO_ADMITIDO_POR_EL_MEDIO al editarlo; la base lo rechaza con `MedioDePago_datos_chk`).
 */

export const TIPOS_DE_MEDIO = ["EFECTIVO", "TARJETA_DEBITO", "TARJETA_CREDITO", "TRANSFERENCIA", "QR", "OTRO"] as const;
export type Tipo = (typeof TIPOS_DE_MEDIO)[number];
export const TIPOS_DE_CUENTA = ["TERMINAL", "QR", "CUENTA_BANCARIA"] as const;
export type TipoCuenta = (typeof TIPOS_DE_CUENTA)[number];
export const DATOS = ["cupon", "ultimos4", "marca", "cuotas", "dni"] as const;
export type Dato = (typeof DATOS)[number];
export const ESTADOS_DE_CUENTA = ["NINGUNA", "COMPATIBLE", "INCOMPATIBLE", "INACTIVA", "OTRA_SUCURSAL"] as const;
export type EstadoDeCuenta = (typeof ESTADOS_DE_CUENTA)[number];

/** Qué tipos de cuenta admite cada tipo de medio. */
export const CUENTAS_QUE_ADMITE: Readonly<Record<Tipo, readonly TipoCuenta[]>> = {
  EFECTIVO: [],
  TARJETA_DEBITO: ["TERMINAL"],
  TARJETA_CREDITO: ["TERMINAL"],
  TRANSFERENCIA: ["CUENTA_BANCARIA"],
  QR: ["QR", "TERMINAL"],
  OTRO: ["TERMINAL", "QR", "CUENTA_BANCARIA"],
};

/** Qué datos puede pedir cada tipo de medio (el techo). */
export const DATOS_QUE_PUEDE_PEDIR: Readonly<Record<Tipo, readonly Dato[]>> = {
  EFECTIVO: [],
  QR: [],
  OTRO: [],
  TARJETA_DEBITO: ["cupon", "ultimos4", "marca"],
  TARJETA_CREDITO: ["cupon", "ultimos4", "marca", "cuotas"],
  TRANSFERENCIA: ["dni"],
};

/** Un tipo de cuenta que el medio NO admite (para armar la cuenta «incompatible»), o `null` si admite los tres (OTRO): esa combinación no existe. */
export function cuentaIncompatibleDe(tipo: Tipo): TipoCuenta | null {
  return TIPOS_DE_CUENTA.find((c) => !CUENTAS_QUE_ADMITE[tipo].includes(c)) ?? null;
}

/** ¿Existe esta combinación (medio, estado de cuenta)? Con el efectivo existen todas (cualquier cuenta es rechazada, R1); «incompatible» no existe donde el medio admite los tres tipos de cuenta (OTRO). */
export function existeLaCombinacion(tipo: Tipo, estado: EstadoDeCuenta): boolean {
  return estado !== "INCOMPATIBLE" || cuentaIncompatibleDe(tipo) !== null;
}

export type Esperado = "OK" | "CUENTA_DE_COBRO_NO_ADMITIDA" | "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL" | "CUENTA_DE_COBRO_INACTIVA" | "CUENTA_DE_COBRO_INCOMPATIBLE" | `DATO_DE_COBRO_NO_HABILITADO:${Dato}`;

/** El resultado esperado de un renglón de cobro (ver R1 a R7). `pide` y `manda` son los datos pedidos por el medio y mandados por el cobro (con forma válida). */
export function esperadoDeUnRenglon(tipo: Tipo, estado: EstadoDeCuenta, pide: readonly Dato[], manda: readonly Dato[]): Esperado {
  if (estado !== "NINGUNA") {
    if (tipo === "EFECTIVO") return "CUENTA_DE_COBRO_NO_ADMITIDA";
    if (estado === "OTRA_SUCURSAL") return "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL";
    if (estado === "INACTIVA") return "CUENTA_DE_COBRO_INACTIVA";
    if (estado === "INCOMPATIBLE") return "CUENTA_DE_COBRO_INCOMPATIBLE";
  }
  const sobrante = DATOS.find((d) => manda.includes(d) && !pide.includes(d));
  return sobrante ? `DATO_DE_COBRO_NO_HABILITADO:${sobrante}` : "OK";
}

/** Todos los subconjuntos de una lista (para recorrer las combinaciones de datos). */
export function subconjuntos<T>(lista: readonly T[]): T[][] {
  return lista.reduce<T[][]>((acc, x) => acc.flatMap((s) => [s, [...s, x]]), [[]]);
}

/**
 * LA DECLARACIÓN DE COLUMNAS (guardián de dimensiones nuevas): toda columna de `MedioDePago` y de `Cobro` que aparezca en `prisma/schema.prisma` tiene que figurar acá con su veredicto. `afecta: true` = sus combinaciones
 * cambian dinero, permisos, visibilidad o stock y entran a las dimensiones de arriba; `afecta: false` = no, con el motivo. Una columna `pide*` o un dato nuevo sin declarar hace fallar el guardián hasta que alguien decida.
 */
export const COLUMNAS_DECLARADAS: Readonly<Record<"MedioDePago" | "Cobro" | "CuentaDeCobro", Readonly<Record<string, { afecta: boolean; motivo: string }>>>> = {
  MedioDePago: {
    id: { afecta: false, motivo: "identificador" },
    empresaId: { afecta: false, motivo: "aislamiento por empresa (RLS)" },
    tipo: { afecta: true, motivo: "dimensión 1: define el techo de datos y las cuentas admitidas" },
    nombre: { afecta: false, motivo: "solo se muestra; único por empresa" },
    activo: { afecta: true, motivo: "un medio inactivo no cobra (MEDIO_NO_HABILITADO)" },
    creadoEn: { afecta: false, motivo: "historia" },
    actualizadoEn: { afecta: false, motivo: "historia" },
    version: { afecta: false, motivo: "control de versión optimista" },
    pideCupon: { afecta: true, motivo: "dimensión 2: habilita el cupón" },
    pideUltimos4: { afecta: true, motivo: "dimensión 2: habilita los últimos 4" },
    pideMarca: { afecta: true, motivo: "dimensión 2: habilita la marca" },
    pideCuotas: { afecta: true, motivo: "dimensión 2: habilita las cuotas" },
    pideDni: { afecta: true, motivo: "dimensión 2: habilita el DNI" },
  },
  Cobro: {
    id: { afecta: false, motivo: "identificador" },
    empresaId: { afecta: false, motivo: "aislamiento por empresa (RLS)" },
    sucursalId: { afecta: false, motivo: "aislamiento por sucursal (RLS)" },
    cobranzaId: { afecta: false, motivo: "pertenencia" },
    orden: { afecta: false, motivo: "orden canónico del renglón" },
    medioDePagoId: { afecta: true, motivo: "dimensión 1" },
    movimientoId: { afecta: false, motivo: "pertenencia 1 a 1" },
    importe: { afecta: false, motivo: "su suma al centavo la cubre la regla del total (C1), no las combinaciones de datos" },
    cuentaDeCobroId: { afecta: true, motivo: "dimensión 4" },
    cupon: { afecta: true, motivo: "dimensión 3" },
    ultimos4: { afecta: true, motivo: "dimensión 3" },
    marcaDeTarjetaId: { afecta: true, motivo: "dimensión 3" },
    cuotas: { afecta: true, motivo: "dimensión 3" },
    dni: { afecta: true, motivo: "dimensión 3" },
  },
  CuentaDeCobro: {
    id: { afecta: false, motivo: "identificador" },
    empresaId: { afecta: false, motivo: "aislamiento por empresa (RLS)" },
    sucursalId: { afecta: true, motivo: "dimensión 4: una cuenta de otra sucursal no sirve" },
    tipo: { afecta: true, motivo: "dimensión 4: decide la compatibilidad con el medio" },
    nombre: { afecta: false, motivo: "solo se muestra; único por empresa" },
    identificadorExterno: { afecta: false, motivo: "dato informativo (número de terminal o alias)" },
    activa: { afecta: true, motivo: "dimensión 4: una cuenta inactiva no cobra" },
    creadoEn: { afecta: false, motivo: "historia" },
    actualizadoEn: { afecta: false, motivo: "historia" },
    version: { afecta: false, motivo: "control de versión optimista" },
  },
};
