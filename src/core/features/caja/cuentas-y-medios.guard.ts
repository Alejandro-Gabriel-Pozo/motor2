import { DATOS_DEL_COBRO, identificadorExternoValido, nombreDeConfiguracionValido, tipoDeCuentaValido, tipoDeMedioValido, type DatosQuePideElMedio } from "@/core/caja/public";
import type {
  ComandoCambiarEstadoDeCuentaDeCobro,
  ComandoCambiarEstadoDeMedioDePago,
  ComandoCrearCuentaDeCobro,
  ComandoCrearMedioDePago,
  ComandoEditarCuentaDeCobro,
  ComandoEditarMedioDePago,
} from "./caja.schema";

/**
 * Guards de las acciones de ADMINISTRACIÓN de la caja (etapa B: cuentas de cobro y medios de pago; docs/diseno-caja-cuentas-de-cobro-y-medios-acciones-y-permisos-2026-11-17.md §5): el FORMATO de cada comando ANTES de tocar la base. Los llama la Server Action DENTRO de su
 * `conPermiso(…)` (el rechazo por permiso llega antes que el de formato). Puros: sin reloj, sin azar, sin I/O. Todo por LISTA DE PERMITIDOS (regla «todo nace cerrado», 2026-11-11): cada dato declara lo que SE ACEPTA y lo demás se rechaza, incluido lo que no sea del tipo
 * esperado (el navegador puede mandar cualquier cosa). El rechazo es un CÓDIGO estable (la pantalla lo traduce a texto; `campo` dice cuál dato).
 *  · Tipos (de cuenta y de medio): solo los vocabularios cerrados de `core/caja`.
 *  · Nombre e identificador externo: la lista de permitidos del dominio (`nombreDeConfiguracionValido`, `identificadorExternoValido`); pasa su forma canónica.
 *  · Ids: el de la cuenta de cobro y el del medio son UUID; el de la sucursal, una cadena de letras, dígitos, `_` y `-` (hasta 64) y, además, SOLO la sucursal ACTIVA del contexto (la única que el usuario puede escribir: cualquier otra, de la empresa o de otra, se rechaza con `SUCURSAL_FUERA_DE_ALCANCE` antes de tocar la base; el caso de uso la vuelve a juzgar contra el alcance).
 *  · Versión esperada: entero de 1 al tope de la columna (`Int` de Postgres).
 *  · Datos que pide un medio: un objeto con EXACTAMENTE los cinco datos del cobro y cada uno booleano (el conjunto FINAL, no lo que cambia); cualquier otra clave, o una faltante, se rechaza.
 * Que el tipo de medio admita ese conjunto de datos, o que la sucursal esté en el alcance, lo juzga el caso de uso con su propio código: acá solo la forma.
 */
export type CodigoDeRechazoDeGuardDeCuentasYMedios = "ENTRADA_INVALIDA" | "IDENTIFICADOR_INVALIDO" | "TIPO_INVALIDO" | "NOMBRE_INVALIDO" | "IDENTIFICADOR_EXTERNO_INVALIDO" | "VERSION_INVALIDA" | "DATOS_INVALIDOS" | "SUCURSAL_FUERA_DE_ALCANCE";
export type RechazoDeGuardDeCuentasYMedios = { ok: false; codigo: CodigoDeRechazoDeGuardDeCuentasYMedios; campo: string };
export type ResultadoDeGuardDeCuentasYMedios<T> = { ok: true; valor: T } | RechazoDeGuardDeCuentasYMedios;

/** Lo que la pantalla le manda a cada acción ANTES de validarse (el navegador puede mandar cualquier cosa: los guards lo juzgan campo por campo). */
export interface EntradaDeCrearCuentaDeCobro {
  tipo: string;
  nombre: string;
  identificadorExterno: string | null;
  sucursalId: string;
}
export interface EntradaDeEditarCuentaDeCobro {
  cuentaDeCobroId: string;
  versionEsperada: number;
  nombre: string;
  identificadorExterno: string | null;
  sucursalId: string;
}
export interface EntradaDeCambiarEstadoDeCuentaDeCobro {
  cuentaDeCobroId: string;
}
export interface EntradaDeCrearMedioDePago {
  tipo: string;
  nombre: string | null;
}
export interface EntradaDeEditarMedioDePago {
  medioDePagoId: string;
  versionEsperada: number;
  nombre: string | null;
  datos: Readonly<Record<string, boolean>>;
}
export interface EntradaDeCambiarEstadoDeMedioDePago {
  medioDePagoId: string;
}

const rechazo = (codigo: CodigoDeRechazoDeGuardDeCuentasYMedios, campo: string): RechazoDeGuardDeCuentasYMedios => ({ ok: false, codigo, campo });

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REGEX_ID_DE_SUCURSAL = /^[A-Za-z0-9_-]{1,64}$/;
/** El tope de la columna `version` (`Int` de Postgres). */
const VERSION_MAXIMA = 2_147_483_647;

const esUuid = (valor: unknown): valor is string => typeof valor === "string" && REGEX_UUID.test(valor);
const esIdDeSucursal = (valor: unknown): valor is string => typeof valor === "string" && REGEX_ID_DE_SUCURSAL.test(valor);
const esObjetoPlano = (valor: unknown): valor is Record<string, unknown> => typeof valor === "object" && valor !== null && !Array.isArray(valor);
const esVersionValida = (valor: unknown): valor is number => typeof valor === "number" && Number.isInteger(valor) && valor >= 1 && valor <= VERSION_MAXIMA;

/** El conjunto FINAL de datos que pide un medio: exactamente los cinco datos del cobro, cada uno booleano. `null` si no pasa. */
function datosQuePide(valor: unknown): DatosQuePideElMedio | null {
  if (!esObjetoPlano(valor)) return null;
  const claves = Object.keys(valor);
  if (claves.length !== DATOS_DEL_COBRO.length) return null;
  const datos: Record<string, boolean> = {};
  for (const dato of DATOS_DEL_COBRO) {
    const v = valor[dato];
    if (typeof v !== "boolean") return null;
    datos[dato] = v;
  }
  return datos as DatosQuePideElMedio;
}

/** Lo que el guard sabe del pedido y no manda el navegador: la sucursal ACTIVA del contexto (la única donde se puede escribir). */
export interface ContextoDeGuardDeCuentas {
  sucursalActivaId: string;
}

/** «Crear una cuenta de cobro»: tipo, nombre, identificador externo (o `null`) y la sucursal (que tiene que ser la activa). */
export function guardComandoCrearCuentaDeCobro(entrada: EntradaDeCrearCuentaDeCobro, contexto: ContextoDeGuardDeCuentas): ResultadoDeGuardDeCuentasYMedios<ComandoCrearCuentaDeCobro> {
  if (!esObjetoPlano(entrada)) return rechazo("ENTRADA_INVALIDA", "entrada");
  const tipo = tipoDeCuentaValido(entrada.tipo);
  if (!tipo.ok) return rechazo("TIPO_INVALIDO", "tipo");
  const nombre = nombreDeConfiguracionValido(entrada.nombre);
  if (!nombre.ok) return rechazo("NOMBRE_INVALIDO", "nombre");
  const identificador = identificadorExternoValido(entrada.identificadorExterno);
  if (!identificador.ok) return rechazo("IDENTIFICADOR_EXTERNO_INVALIDO", "identificadorExterno");
  if (!esIdDeSucursal(entrada.sucursalId)) return rechazo("IDENTIFICADOR_INVALIDO", "sucursalId");
  if (entrada.sucursalId !== contexto.sucursalActivaId) return rechazo("SUCURSAL_FUERA_DE_ALCANCE", "sucursalId");
  return { ok: true, valor: { tipo: tipo.valor, nombre: nombre.valor, identificadorExterno: identificador.valor, sucursalId: entrada.sucursalId } };
}

/** «Editar una cuenta de cobro»: la cuenta, la versión que vio la pantalla, nombre, identificador externo (o `null`) y la sucursal (que tiene que ser la activa). */
export function guardComandoEditarCuentaDeCobro(entrada: EntradaDeEditarCuentaDeCobro, contexto: ContextoDeGuardDeCuentas): ResultadoDeGuardDeCuentasYMedios<ComandoEditarCuentaDeCobro> {
  if (!esObjetoPlano(entrada)) return rechazo("ENTRADA_INVALIDA", "entrada");
  if (!esUuid(entrada.cuentaDeCobroId)) return rechazo("IDENTIFICADOR_INVALIDO", "cuentaDeCobroId");
  if (!esVersionValida(entrada.versionEsperada)) return rechazo("VERSION_INVALIDA", "versionEsperada");
  const nombre = nombreDeConfiguracionValido(entrada.nombre);
  if (!nombre.ok) return rechazo("NOMBRE_INVALIDO", "nombre");
  const identificador = identificadorExternoValido(entrada.identificadorExterno);
  if (!identificador.ok) return rechazo("IDENTIFICADOR_EXTERNO_INVALIDO", "identificadorExterno");
  if (!esIdDeSucursal(entrada.sucursalId)) return rechazo("IDENTIFICADOR_INVALIDO", "sucursalId");
  if (entrada.sucursalId !== contexto.sucursalActivaId) return rechazo("SUCURSAL_FUERA_DE_ALCANCE", "sucursalId");
  return { ok: true, valor: { cuentaDeCobroId: entrada.cuentaDeCobroId, versionEsperada: entrada.versionEsperada, nombre: nombre.valor, identificadorExterno: identificador.valor, sucursalId: entrada.sucursalId } };
}

/** «Desactivar» o «reactivar» una cuenta de cobro: solo la cuenta (UUID); el resto lo decide el caso de uso por el estado. */
export function guardComandoCambiarEstadoDeCuentaDeCobro(entrada: EntradaDeCambiarEstadoDeCuentaDeCobro): ResultadoDeGuardDeCuentasYMedios<ComandoCambiarEstadoDeCuentaDeCobro> {
  if (!esObjetoPlano(entrada)) return rechazo("ENTRADA_INVALIDA", "entrada");
  if (!esUuid(entrada.cuentaDeCobroId)) return rechazo("IDENTIFICADOR_INVALIDO", "cuentaDeCobroId");
  return { ok: true, valor: { cuentaDeCobroId: entrada.cuentaDeCobroId } };
}

/** «Crear un medio de pago»: el tipo (uno de los seis) y el nombre (o `null`: sin nombre propio). */
export function guardComandoCrearMedioDePago(entrada: EntradaDeCrearMedioDePago): ResultadoDeGuardDeCuentasYMedios<ComandoCrearMedioDePago> {
  if (!esObjetoPlano(entrada)) return rechazo("ENTRADA_INVALIDA", "entrada");
  const tipo = tipoDeMedioValido(entrada.tipo);
  if (!tipo.ok) return rechazo("TIPO_INVALIDO", "tipo");
  let nombre: string | null = null;
  if (entrada.nombre !== null) {
    const n = nombreDeConfiguracionValido(entrada.nombre);
    if (!n.ok) return rechazo("NOMBRE_INVALIDO", "nombre");
    nombre = n.valor;
  }
  return { ok: true, valor: { tipo: tipo.valor, nombre } };
}

/** «Editar un medio de pago»: el medio, la versión que vio la pantalla, el nombre (o `null`) y el conjunto FINAL de datos que pide. */
export function guardComandoEditarMedioDePago(entrada: EntradaDeEditarMedioDePago): ResultadoDeGuardDeCuentasYMedios<ComandoEditarMedioDePago> {
  if (!esObjetoPlano(entrada)) return rechazo("ENTRADA_INVALIDA", "entrada");
  if (!esUuid(entrada.medioDePagoId)) return rechazo("IDENTIFICADOR_INVALIDO", "medioDePagoId");
  if (!esVersionValida(entrada.versionEsperada)) return rechazo("VERSION_INVALIDA", "versionEsperada");
  let nombre: string | null = null;
  if (entrada.nombre !== null) {
    const n = nombreDeConfiguracionValido(entrada.nombre);
    if (!n.ok) return rechazo("NOMBRE_INVALIDO", "nombre");
    nombre = n.valor;
  }
  const datos = datosQuePide(entrada.datos);
  if (datos === null) return rechazo("DATOS_INVALIDOS", "datos");
  return { ok: true, valor: { medioDePagoId: entrada.medioDePagoId, versionEsperada: entrada.versionEsperada, nombre, datos } };
}

/** «Desactivar» o «reactivar» un medio de pago: solo el medio (UUID). */
export function guardComandoCambiarEstadoDeMedioDePago(entrada: EntradaDeCambiarEstadoDeMedioDePago): ResultadoDeGuardDeCuentasYMedios<ComandoCambiarEstadoDeMedioDePago> {
  if (!esObjetoPlano(entrada)) return rechazo("ENTRADA_INVALIDA", "entrada");
  if (!esUuid(entrada.medioDePagoId)) return rechazo("IDENTIFICADOR_INVALIDO", "medioDePagoId");
  return { ok: true, valor: { medioDePagoId: entrada.medioDePagoId } };
}
