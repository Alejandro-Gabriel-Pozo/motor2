import { esClaveIdempotenciaValida } from "@/core/datos/clave-idempotencia";
import { validarDatosDeParte, type DatosDeParte, type ErrorDeCampoDeParte } from "@/core/datos/datos-de-parte";
import type { ComandoAltaDeParte, ComandoCambiarEstadoDeParte, ComandoEditarParte, EntradaDeAltaDeParte, EntradaDeEdicionDeParte } from "./partes.schema";

/**
 * Guards de la feature «partes» (ficha única; convención «guard por feature»): el formato de cada comando ANTES de tocar la base. Los llama la Server Action DENTRO de su `conPermisoDeEmpresa(…)`: el rechazo por permiso
 * llega antes que el de formato. Puros. El rechazo es un CÓDIGO (la pantalla lo traduce): `DATOS_INVALIDOS` lleva un código por campo, todos juntos.
 */
export type RechazoDeGuardDeParte = { ok: false; codigo: "DATOS_INVALIDOS" | "CLAVE_INVALIDA" | "IDENTIFICADOR_INVALIDO" | "VERSION_INVALIDA" | "ESTADO_INVALIDO"; errores: readonly ErrorDeCampoDeParte[] };
export type ResultadoDeGuardDeParte<T> = { ok: true; valor: T } | RechazoDeGuardDeParte;

const rechazo = (codigo: RechazoDeGuardDeParte["codigo"], errores: readonly ErrorDeCampoDeParte[] = []): RechazoDeGuardDeParte => ({ ok: false, codigo, errores });

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** El id de una ficha es un UUID (lo genera el servidor): cualquier otra cosa es un identificador inválido. */
export const esIdentificadorDeParte = (valor: unknown): valor is string => typeof valor === "string" && REGEX_UUID.test(valor);

function datosValidos(entrada: Parameters<typeof validarDatosDeParte>[0]): ResultadoDeGuardDeParte<DatosDeParte> {
  const r = validarDatosDeParte(entrada);
  return r.ok ? { ok: true, valor: r.valor } : rechazo("DATOS_INVALIDOS", r.errores);
}

/** «Alta de una ficha»: la clave de reintento es OBLIGATORIA (un UUID) y los datos se validan campo por campo. */
export function guardComandoAltaDeParte(entrada: EntradaDeAltaDeParte): ResultadoDeGuardDeParte<ComandoAltaDeParte> {
  if (!esClaveIdempotenciaValida(entrada.claveIdempotencia)) return rechazo("CLAVE_INVALIDA");
  const datos = datosValidos(entrada.datos);
  return datos.ok ? { ok: true, valor: { claveIdempotencia: entrada.claveIdempotencia, datos: datos.valor } } : datos;
}

/** «Editar una ficha»: el id, la versión leída (entero >= 1) y los datos completos. */
export function guardComandoEditarParte(entrada: EntradaDeEdicionDeParte): ResultadoDeGuardDeParte<ComandoEditarParte> {
  if (!esIdentificadorDeParte(entrada.parteId)) return rechazo("IDENTIFICADOR_INVALIDO");
  const version = entrada.versionEsperada;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 2_147_483_647) return rechazo("VERSION_INVALIDA");
  const datos = datosValidos(entrada.datos);
  return datos.ok ? { ok: true, valor: { parteId: entrada.parteId, versionEsperada: version, datos: datos.valor } } : datos;
}

/** «Desactivar o reactivar»: el id y un booleano. */
export function guardComandoCambiarEstadoDeParte(entrada: { parteId: unknown; activa: unknown }): ResultadoDeGuardDeParte<ComandoCambiarEstadoDeParte> {
  if (!esIdentificadorDeParte(entrada.parteId)) return rechazo("IDENTIFICADOR_INVALIDO");
  if (typeof entrada.activa !== "boolean") return rechazo("ESTADO_INVALIDO");
  return { ok: true, valor: { parteId: entrada.parteId, activa: entrada.activa } };
}
