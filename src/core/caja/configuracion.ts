import { invalido, valido, type ResultadoDeRegla } from "@/core/datos/resultado-de-regla";
import { TIPOS_DE_CUENTA, TIPOS_DE_MEDIO, type TipoDeCuenta, type TipoDeMedio } from "./medios";

/**
 * Configuración de medios de pago y cuentas de cobro (etapa C3; Pedernal `src/modulos/caja/dominio/configuracion.ts`, e3 §3.2). Nada se borra: se desactiva, y una desactivada conserva su nombre (no se puede crear otra igual: se la
 * reactiva). La forma de cada texto es una LISTA DE PERMITIDOS que repite su CHECK de la base (`CuentaDeCobro_nombre_chk`, `CuentaDeCobro_identificador_chk`, `MedioDePago_nombre_chk`).
 *
 * Puro: sin reloj, sin azar, sin I/O.
 */
const LARGO_MAXIMO_DEL_NOMBRE = 60;
const FORMA_DEL_NOMBRE = /^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ][A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ ._/-]{0,59}$/;
const FORMA_DEL_IDENTIFICADOR = /^[A-Za-z0-9 ._/-]{1,40}$/;

/** El nombre canónico (recortado, en NFC y con los espacios repetidos juntados) si es de la forma permitida (1 a 60), o `NOMBRE_INVALIDO`. Se compara sin distinguir mayúsculas con `claveDeNombre`. */
export function nombreDeConfiguracionValido(texto: unknown): ResultadoDeRegla<string, "NOMBRE_INVALIDO"> {
  if (typeof texto !== "string") return invalido("NOMBRE_INVALIDO");
  const canonico = texto.trim().normalize("NFC").replace(/ {2,}/g, " ");
  return canonico.length <= LARGO_MAXIMO_DEL_NOMBRE && FORMA_DEL_NOMBRE.test(canonico) ? valido(canonico) : invalido("NOMBRE_INVALIDO");
}

/** El número de terminal o el alias de una cuenta (opcional; nunca una credencial): se recortan los extremos; en blanco es inválido. `null` = sin dato. */
export function identificadorExternoValido(texto: unknown): ResultadoDeRegla<string | null, "IDENTIFICADOR_EXTERNO_INVALIDO"> {
  if (texto === null) return valido(null);
  if (typeof texto !== "string") return invalido("IDENTIFICADOR_EXTERNO_INVALIDO");
  const recortado = texto.trim();
  return FORMA_DEL_IDENTIFICADOR.test(recortado) ? valido(recortado) : invalido("IDENTIFICADOR_EXTERNO_INVALIDO");
}

export function tipoDeMedioValido(texto: unknown): ResultadoDeRegla<TipoDeMedio, "TIPO_DE_MEDIO_INVALIDO"> {
  const tipo = TIPOS_DE_MEDIO.find((candidato) => candidato === texto);
  return tipo === undefined ? invalido("TIPO_DE_MEDIO_INVALIDO") : valido(tipo);
}

export function tipoDeCuentaValido(texto: unknown): ResultadoDeRegla<TipoDeCuenta, "TIPO_DE_CUENTA_INVALIDO"> {
  const tipo = TIPOS_DE_CUENTA.find((candidato) => candidato === texto);
  return tipo === undefined ? invalido("TIPO_DE_CUENTA_INVALIDO") : valido(tipo);
}

export type DecisionDeAlta = "CREAR" | "YA_EXISTIA";

export interface MedioGuardado {
  readonly id: string;
  readonly tipo: TipoDeMedio;
  readonly nombre: string | null;
  readonly activo: boolean;
  readonly version: number;
}

export interface CuentaGuardada {
  readonly id: string;
  readonly tipo: TipoDeCuenta;
  readonly nombre: string;
  readonly identificadorExterno: string | null;
  readonly sucursalId: string;
  readonly activa: boolean;
  readonly version: number;
}

/**
 * Crear un medio. `conEseNombre` es el que ya usa ese nombre (sin distinguir mayúsculas) o, si el pedido no trae nombre, el que no tiene nombre de ese tipo; `efectivo` es el efectivo de la empresa si ya existe. Hay un solo
 * efectivo por empresa (`EFECTIVO_YA_EXISTE`), salvo que el pedido sea el que ya está hecho (mismo nombre: doble clic o reintento). Un nombre que usa un medio de OTRO tipo es `MEDIO_DUPLICADO`; el de uno desactivado,
 * `MEDIO_INACTIVO_CON_ESE_NOMBRE` (se lo reactiva, no se crea otro).
 */
export function decidirAltaDeMedio(
  pedido: Readonly<{ tipo: TipoDeMedio; nombre: string | null }>,
  existentes: Readonly<{ conEseNombre: MedioGuardado | null; efectivo: MedioGuardado | null }>,
): ResultadoDeRegla<DecisionDeAlta, "MEDIO_DUPLICADO" | "MEDIO_INACTIVO_CON_ESE_NOMBRE" | "EFECTIVO_YA_EXISTE"> {
  const { conEseNombre, efectivo } = existentes;
  if (pedido.tipo === "EFECTIVO" && efectivo !== null) return efectivo.nombre === pedido.nombre ? valido("YA_EXISTIA") : invalido("EFECTIVO_YA_EXISTE");
  if (conEseNombre === null) return valido("CREAR");
  if (conEseNombre.tipo !== pedido.tipo) return invalido("MEDIO_DUPLICADO");
  return conEseNombre.activo ? valido("YA_EXISTIA") : invalido("MEDIO_INACTIVO_CON_ESE_NOMBRE");
}

/**
 * Crear una cuenta cuyo nombre (sin distinguir mayúsculas, en toda la empresa) puede ya existir: si es la misma cuenta y está activa, el alta ya estaba hecha; cualquier otra cosa con ese nombre (otra cuenta, o la misma
 * desactivada) es `CUENTA_DUPLICADA`.
 */
export function decidirAltaDeCuenta(
  pedido: Readonly<{ tipo: TipoDeCuenta; identificadorExterno: string | null; sucursalId: string }>,
  existente: CuentaGuardada | null,
): ResultadoDeRegla<DecisionDeAlta, "CUENTA_DUPLICADA"> {
  if (existente === null) return valido("CREAR");
  const esLaMisma = existente.activa && existente.tipo === pedido.tipo && existente.identificadorExterno === pedido.identificadorExterno && existente.sucursalId === pedido.sucursalId;
  return esLaMisma ? valido("YA_EXISTIA") : invalido("CUENTA_DUPLICADA");
}

export type DecisionDeEdicion = "SIN_CAMBIOS" | "EDITAR";

/**
 * Editar con control de versión: si lo pedido ya es lo que hay no hay nada que hacer, aunque la versión sea otra (repetir una edición ya aplicada da el mismo resultado y no un conflicto); si no, la versión esperada tiene que
 * ser la vigente.
 */
export function decidirConVersion(igual: boolean, versionVigente: number, versionEsperada: number): ResultadoDeRegla<DecisionDeEdicion, "VERSION_DESACTUALIZADA"> {
  if (igual) return valido("SIN_CAMBIOS");
  return versionVigente === versionEsperada ? valido("EDITAR") : invalido("VERSION_DESACTUALIZADA");
}

export type DecisionDeCambioDeEstado = "YA_ESTABA" | "CAMBIAR";

/** Desactivar o reactivar es idempotente por estado: si ya está como se pide, no se escribe ni se audita. */
export function decidirCambioDeEstado(estaActivo: boolean, seQuiereActivo: boolean): DecisionDeCambioDeEstado {
  return estaActivo === seQuiereActivo ? "YA_ESTABA" : "CAMBIAR";
}

/**
 * ¿Escribe el actor en esa sucursal? `alcance` es el que la transacción fijó (`undefined` = la transacción no lo declara y decide la RLS de la base, que falla cerrado con 42501). Un rechazo anticipado devuelve un código
 * limpio en lugar de abortar la transacción entera.
 */
export function sucursalEnAlcanceDeEscritura(alcance: { readonly escritura: readonly string[] } | undefined, sucursalId: string): boolean {
  return alcance === undefined || alcance.escritura.includes(sucursalId);
}
