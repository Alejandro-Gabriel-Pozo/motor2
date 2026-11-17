"use server";

import {
  guardComandoCerrarJornada,
  guardComandoCorregirMedioDeCobro,
  guardComandoDarConformeGeneral,
  guardComandoDeJornada,
  guardComandoDeclararTotal,
  guardComandoRegistrarAjuste,
  type RechazoDeGuardDeCaja,
} from "@/core/features/caja/caja.guard";
import type { ControlDeJornadaVisto, EntradaDeCerrarJornada, EntradaDeCorregirMedioDeCobro, EntradaDeDarConformeGeneral, EntradaDeDeclararTotal, EntradaDeJornada, EntradaDeRegistrarAjuste, ImpedimentoDeJornada } from "@/core/features/caja/caja.schema";
import { aResultadoAccion } from "@/core/resultado-caso";
import { azarDelProceso } from "@/lib/azar";
import { conPermiso } from "../con-permiso";
import { type ResultadoAccion } from "../tipos";
import { cancelarAuditoriaCasoDeUso } from "./casos-de-uso/cancelar-auditoria";
import { cerrarJornadaCasoDeUso } from "./casos-de-uso/cerrar-jornada";
import { corregirMedioDeCobroCasoDeUso } from "./casos-de-uso/corregir-medio-de-cobro";
import { darConformeGeneralCasoDeUso } from "./casos-de-uso/dar-conforme-general";
import { declararTotalCasoDeUso } from "./casos-de-uso/declarar-total";
import { iniciarAuditoriaCasoDeUso } from "./casos-de-uso/iniciar-auditoria";
import { registrarAjusteCasoDeUso } from "./casos-de-uso/registrar-ajuste";

/**
 * Las Server Actions del CIERRE DEL DÍA (caja, etapa A, 2026-11-17; docs/diseno-caja-cierre-del-dia-acciones-y-permisos-2026-11-17.md §5): adaptadores finos, el mismo molde de `caja.ts`. Permiso (PRIMERA línea, `conPermiso`) → formato
 * (`guardComando…`, por lista de permitidos) → caso de uso de C2 (`./casos-de-uso/`) → resultado cerrado. La sucursal y el usuario son los del contexto de la sesión: la fecha de negocio es lo único que nombra a la jornada y las claves de reintento las genera la
 * pantalla. El resultado es `ResultadoAccion` MÁS lo que la pantalla necesita para decidir sin adivinar (el `codigo` estable del fallo, los ids y las marcas `ya…`); los importes no viajan de vuelta (esta capa no devuelve dinero).
 */
export type ResultadoDeCierreDelDia = ResultadoAccion & {
  /** El código estable del fallo (formato o regla del caso de uso). */
  codigo?: string;
  /** Con un rechazo de formato: cuál dato (`reconocimientos.2.clave`). */
  campo?: string;
  /** El reintento con la misma clave devolvió lo ya hecho. */
  yaExistia?: boolean;
  /** Solo al iniciar el cierre del día: ya estaba empezado (repetir no escribe). */
  yaEstabaEnAuditoria?: boolean;
  /** Solo al cancelar: la jornada ya estaba abierta (repetir no escribe). */
  yaEstabaAbierta?: boolean;
  /** Solo al cerrar: el día ya estaba cerrado con el mismo pedido. */
  yaEstabaCerrada?: boolean;
  correccionId?: string;
  declaracionId?: string;
  conformeId?: string;
  movimientoId?: string;
  secuencia?: number;
  /** Con `MEDIO_DEL_COBRO_CAMBIO`: la corrección vigente del cobro. */
  vigenteId?: string;
  /** Con `JORNADA_CON_IMPEDIMENTOS`: qué controles impiden empezar el cierre. */
  impedimentos?: readonly ImpedimentoDeJornada[];
  /** Al cerrar (y con `CONTROLES_CAMBIARON`): los controles tal como quedaron o como están ahora. */
  controles?: readonly ControlDeJornadaVisto[];
  /** Con `CONTROLES_CAMBIARON`: la huella de los controles de ahora. */
  huellaActual?: string;
  /** Con `CONTROLES_QUE_BLOQUEAN` o `CONTROLES_SIN_RECONOCER`: las claves involucradas. */
  claves?: readonly string[];
};

const rechazoDeGuard = (r: RechazoDeGuardDeCaja): ResultadoDeCierreDelDia => ({ ok: false, codigo: r.codigo, campo: r.campo, mensaje: r.codigo });

/** Lo que la pantalla necesita además del `ok` y el mensaje: solo campos de una lista (nunca se vuelca `datos` entero ni un objeto que no se haya mirado). */
function extras(r: { ok: boolean }): Omit<ResultadoDeCierreDelDia, "ok" | "mensaje"> {
  const crudo = r as Record<string, unknown>;
  const fuente: Record<string, unknown> = r.ok ? ((crudo.datos ?? {}) as Record<string, unknown>) : crudo;
  const id = (clave: string): string | undefined => (typeof fuente[clave] === "string" ? (fuente[clave] as string) : undefined);
  const booleano = (clave: string): boolean | undefined => (typeof fuente[clave] === "boolean" ? (fuente[clave] as boolean) : undefined);
  function lista<T>(clave: string): readonly T[] | undefined {
    return Array.isArray(fuente[clave]) ? (fuente[clave] as readonly T[]) : undefined;
  }
  const campos = {
    ...(!r.ok && typeof crudo.codigo === "string" ? { codigo: crudo.codigo } : {}),
    yaExistia: booleano("yaExistia"),
    yaEstabaEnAuditoria: booleano("yaEstabaEnAuditoria"),
    yaEstabaAbierta: booleano("yaEstabaAbierta"),
    yaEstabaCerrada: booleano("yaEstabaCerrada"),
    correccionId: id("correccionId"),
    declaracionId: id("declaracionId"),
    conformeId: id("conformeId"),
    movimientoId: id("movimientoId"),
    secuencia: typeof fuente.secuencia === "number" ? fuente.secuencia : undefined,
    vigenteId: id("vigenteId"),
    impedimentos: lista<ImpedimentoDeJornada>("impedimentos"),
    controles: lista<ControlDeJornadaVisto>("controles"),
    huellaActual: id("huellaActual"),
    claves: lista<string>("claves"),
  };
  return Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
}

/** «Empezar el cierre del día» de la jornada de la sucursal activa: con cajas sin cerrar o cuentas abiertas responde `JORNADA_CON_IMPEDIMENTOS`. Repetirlo no escribe (`yaEstabaEnAuditoria`). */
export async function iniciarAuditoriaDeJornada(entrada: EntradaDeJornada): Promise<ResultadoDeCierreDelDia> {
  return conPermiso("caja_jornada_iniciar_auditoria", async (ctx) => {
    const comando = guardComandoDeJornada(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await iniciarAuditoriaCasoDeUso(ctx, comando.valor);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Cancelar el cierre del día»: la jornada EN_AUDITORIA vuelve a ABIERTA. Repetirlo no escribe (`yaEstabaAbierta`). */
export async function cancelarAuditoriaDeJornada(entrada: EntradaDeJornada): Promise<ResultadoDeCierreDelDia> {
  return conPermiso("caja_jornada_cancelar_auditoria", async (ctx) => {
    const comando = guardComandoDeJornada(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await cancelarAuditoriaCasoDeUso(ctx, comando.valor);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Corregir el medio de un cobro» con la jornada EN_AUDITORIA, con motivo. Misma clave y mismo pedido: `yaExistia`; misma clave y otro pedido: `CLAVE_REUTILIZADA`. */
export async function corregirMedioDeCobroDeCaja(entrada: EntradaDeCorregirMedioDeCobro): Promise<ResultadoDeCierreDelDia> {
  return conPermiso("caja_corregir_medio_de_cobro", async (ctx) => {
    const comando = guardComandoCorregirMedioDeCobro(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await corregirMedioDeCobroCasoDeUso(ctx, comando.valor, azarDelProceso);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Declarar el total de un medio» (lo que dicen los comprobantes), con la jornada EN_AUDITORIA. Importe en pesos como texto decimal. */
export async function declararTotalDeMedio(entrada: EntradaDeDeclararTotal): Promise<ResultadoDeCierreDelDia> {
  return conPermiso("caja_declarar_total", async (ctx) => {
    const comando = guardComandoDeclararTotal(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await declararTotalCasoDeUso(ctx, comando.valor, azarDelProceso);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Dar el conforme general» de la jornada EN_AUDITORIA. Misma clave que declarar el total (`caja_declarar_total`), como Pedernal. */
export async function darConformeGeneralDeJornada(entrada: EntradaDeDarConformeGeneral): Promise<ResultadoDeCierreDelDia> {
  return conPermiso("caja_declarar_total", async (ctx) => {
    const comando = guardComandoDarConformeGeneral(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await darConformeGeneralCasoDeUso(ctx, comando.valor, azarDelProceso);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Cerrar el día» con la huella de los controles que vio la pantalla y los reconocimientos: con controles que cambiaron, bloquean o sin reconocer responde con su código. Repetirlo con el mismo pedido no escribe (`yaEstabaCerrada`). */
export async function cerrarJornadaDeCaja(entrada: EntradaDeCerrarJornada): Promise<ResultadoDeCierreDelDia> {
  return conPermiso("caja_jornada_cerrar", async (ctx) => {
    const comando = guardComandoCerrarJornada(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await cerrarJornadaCasoDeUso(ctx, comando.valor, azarDelProceso);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/**
 * «Registrar un ajuste» sobre una jornada ya cerrada. El permiso `caja_registrar_ajuste` es de piso operario (PISOS-65): lo delega la empresa fila por fila y el gate rechaza a quien no tiene la fila; el caso de uso recibe `true` porque la acción solo llega acá con el
 * permiso aprobado (su propio `SIN_PERMISO_PARA_AJUSTAR` queda como segunda barrera para otros llamadores).
 */
export async function registrarAjusteDeCaja(entrada: EntradaDeRegistrarAjuste): Promise<ResultadoDeCierreDelDia> {
  return conPermiso("caja_registrar_ajuste", async (ctx) => {
    const comando = guardComandoRegistrarAjuste(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await registrarAjusteCasoDeUso(ctx, comando.valor, true, azarDelProceso);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}
