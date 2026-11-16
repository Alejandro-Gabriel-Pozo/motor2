import { invalido, valido, type ResultadoDeRegla } from "@/core/datos/resultado-de-regla";

/**
 * Medios de pago y cuentas de cobro (etapa C3, docs/diseno-caja-c3-cuenta-de-cobro-y-marcas-2026-11-16.md), como las decidió Pedernal (`src/modulos/caja/dominio/medios.ts`, decisiones 124, 129 y 151). Los vocabularios
 * son cerrados y cada tabla repite un CHECK o una función de la migración 20261117130000_caja_c3_cuenta_de_cobro: `test/caja/oraculo-de-combinaciones-del-cobro.test.ts` compara el código, el oráculo escrito aparte y la base.
 *
 * Puro: sin reloj, sin azar, sin I/O.
 */

export const TIPOS_DE_MEDIO = ["EFECTIVO", "TARJETA_DEBITO", "TARJETA_CREDITO", "TRANSFERENCIA", "QR", "OTRO"] as const;
export type TipoDeMedio = (typeof TIPOS_DE_MEDIO)[number];

export const TIPOS_DE_CUENTA = ["TERMINAL", "QR", "CUENTA_BANCARIA"] as const;
export type TipoDeCuenta = (typeof TIPOS_DE_CUENTA)[number];

/** Los datos opcionales de un cobro (decisión 129 de Pedernal). «Obligatorio» por dato NO existe (diseñado y no construido en Pedernal). */
export const DATOS_DEL_COBRO = ["cupon", "ultimos4", "marca", "cuotas", "dni"] as const;
export type DatoDelCobro = (typeof DATOS_DEL_COBRO)[number];

/** Qué tipos de cuenta admite cada tipo de medio. El efectivo no admite ninguna. Es `CuentaDeCobro_admitida_por_medio` de la base. */
export const CUENTAS_ADMITIDAS: Readonly<Record<TipoDeMedio, readonly TipoDeCuenta[]>> = {
  EFECTIVO: [],
  TARJETA_DEBITO: ["TERMINAL"],
  TARJETA_CREDITO: ["TERMINAL"],
  QR: ["QR", "TERMINAL"],
  TRANSFERENCIA: ["CUENTA_BANCARIA"],
  OTRO: ["TERMINAL", "QR", "CUENTA_BANCARIA"],
};

/** Qué datos puede pedir cada tipo de medio (el techo). Es `MedioDePago_datos_chk` de la base. */
export const DATOS_ADMITIDOS_POR_MEDIO: Readonly<Record<TipoDeMedio, readonly DatoDelCobro[]>> = {
  EFECTIVO: [],
  QR: [],
  OTRO: [],
  TARJETA_DEBITO: ["cupon", "ultimos4", "marca"],
  TARJETA_CREDITO: ["cupon", "ultimos4", "marca", "cuotas"],
  TRANSFERENCIA: ["dni"],
};

function cuentaAdmitidaPorMedio(tipoDeMedio: TipoDeMedio, tipoDeCuenta: TipoDeCuenta): boolean {
  return CUENTAS_ADMITIDAS[tipoDeMedio].includes(tipoDeCuenta);
}

/** Qué datos pide un medio (las columnas `pide*` de `MedioDePago`). Un medio nuevo nace con todos en `false`. */
export type DatosQuePideElMedio = Readonly<Record<DatoDelCobro, boolean>>;

export type MedioVisto = Readonly<{ tipo: TipoDeMedio; activo: boolean }>;
export type CuentaVista = Readonly<{ tipo: TipoDeCuenta; activa: boolean; sucursalId: string }>;

export type ErrorDeParDeCobro =
  | "MEDIO_NO_HABILITADO"
  | "CUENTA_DE_COBRO_NO_ADMITIDA"
  | "CUENTA_DE_COBRO_NO_ENCONTRADA"
  | "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL"
  | "CUENTA_DE_COBRO_INACTIVA"
  | "CUENTA_DE_COBRO_INCOMPATIBLE";

/**
 * El par (medio, cuenta) de un renglón de cobro: el medio existe y está activo; si viene cuenta, el medio la admite (el efectivo no), existe, es de la sucursal de la caja, está activa y es de un tipo compatible.
 * Devuelve el tipo del medio. Espejo EXACTO, y con el mismo orden de chequeos, de `CuentaDeCobro_validar_par` de la base (que es la defensa final). `medio` y `cuenta` son lo que el caso de uso encontró (`null` = no existe en la empresa).
 */
export function validarParDeCobro(
  entrada: Readonly<{ medio: MedioVisto | null; cuentaDeCobroId: string | null; cuenta: CuentaVista | null; sucursalDeLaCaja: string }>,
): ResultadoDeRegla<TipoDeMedio, ErrorDeParDeCobro> {
  const { medio, cuentaDeCobroId, cuenta } = entrada;
  if (medio === null || !medio.activo) return invalido("MEDIO_NO_HABILITADO");
  if (cuentaDeCobroId === null) return valido(medio.tipo);
  if (medio.tipo === "EFECTIVO") return invalido("CUENTA_DE_COBRO_NO_ADMITIDA");
  if (cuenta === null) return invalido("CUENTA_DE_COBRO_NO_ENCONTRADA");
  if (cuenta.sucursalId !== entrada.sucursalDeLaCaja) return invalido("CUENTA_DE_COBRO_DE_OTRA_SUCURSAL");
  if (!cuenta.activa) return invalido("CUENTA_DE_COBRO_INACTIVA");
  if (!cuentaAdmitidaPorMedio(medio.tipo, cuenta.tipo)) return invalido("CUENTA_DE_COBRO_INCOMPATIBLE");
  return valido(medio.tipo);
}

/** `editarMedioDePago` rechaza habilitar un dato que el tipo no admite (el CHECK `MedioDePago_datos_chk` de la base es la defensa final). Devuelve el primer dato que sobra. */
export function validarDatosQuePide(tipoDeMedio: TipoDeMedio, pide: DatosQuePideElMedio): ResultadoDeRegla<null, "DATO_NO_ADMITIDO_POR_EL_MEDIO"> & { dato?: DatoDelCobro } {
  for (const dato of DATOS_DEL_COBRO) {
    if (pide[dato] && !DATOS_ADMITIDOS_POR_MEDIO[tipoDeMedio].includes(dato)) return { ...invalido("DATO_NO_ADMITIDO_POR_EL_MEDIO"), dato };
  }
  return valido(null);
}
