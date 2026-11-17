"use server";

import {
  guardComandoCambiarEstadoDeCuentaDeCobro,
  guardComandoCambiarEstadoDeMedioDePago,
  guardComandoCrearCuentaDeCobro,
  guardComandoCrearMedioDePago,
  guardComandoEditarCuentaDeCobro,
  guardComandoEditarMedioDePago,
  type EntradaDeCambiarEstadoDeCuentaDeCobro,
  type EntradaDeCambiarEstadoDeMedioDePago,
  type EntradaDeCrearCuentaDeCobro,
  type EntradaDeCrearMedioDePago,
  type EntradaDeEditarCuentaDeCobro,
  type EntradaDeEditarMedioDePago,
  type RechazoDeGuardDeCuentasYMedios,
} from "@/core/features/caja/cuentas-y-medios.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { azarDelProceso } from "@/lib/azar";
import { conPermiso } from "../con-permiso";
import { type ResultadoAccion } from "../tipos";
import { desactivarCuentaDeCobroCasoDeUso, reactivarCuentaDeCobroCasoDeUso } from "./casos-de-uso/cambiar-estado-de-cuenta-de-cobro";
import { desactivarMedioDePagoCasoDeUso, reactivarMedioDePagoCasoDeUso } from "./casos-de-uso/cambiar-estado-de-medio-de-pago";
import { crearCuentaDeCobroCasoDeUso } from "./casos-de-uso/crear-cuenta-de-cobro";
import { crearMedioDePagoCasoDeUso } from "./casos-de-uso/crear-medio-de-pago";
import { editarCuentaDeCobroCasoDeUso } from "./casos-de-uso/editar-cuenta-de-cobro";
import { editarMedioDePagoCasoDeUso } from "./casos-de-uso/editar-medio-de-pago";

/**
 * Las Server Actions de ADMINISTRACIÓN de la caja (etapa B; docs/diseno-caja-cuentas-de-cobro-y-medios-acciones-y-permisos-2026-11-17.md §5): ocho adaptadores finos sobre los seis casos de uso de C3. Permiso (PRIMERA línea, `conPermiso`, una clave por acción)
 * → formato (`guardComando…`, por lista de permitidos) → caso de uso (`./casos-de-uso/`). Sin lógica nueva. La sucursal y el usuario del contexto salen de la sesión; la sucursal de una cuenta de cobro es una entrada EXPLÍCITA que el guard acepta SOLO si es la activa
 * (`sucursalActivaId`) y que el caso de uso vuelve a validar contra el alcance del usuario (nunca se confía en el navegador). El resultado es `ResultadoAccion` MÁS lo que la pantalla necesita para decidir sin adivinar: el `codigo` estable del fallo (en un rechazo de formato el mensaje es solo el código), los ids de lo creado, la
 * versión nueva y la repetición (`yaExistia`, `yaEstaba…`). Ninguna refresca la vista: quien llama es un componente de cliente.
 */
export type ResultadoDeCuentasYMedios = ResultadoAccion & {
  /** El código estable del fallo (formato o regla del caso de uso). */
  codigo?: string;
  /** Con un rechazo de formato: cuál dato (`datos`, `versionEsperada`). */
  campo?: string;
  cuentaDeCobroId?: string;
  medioDePagoId?: string;
  /** Al editar: la versión vigente tras la edición. */
  version?: number;
  /** El reintento devolvió lo ya hecho (el alta ya estaba). */
  yaExistia?: boolean;
  yaEstabaActiva?: boolean;
  yaEstabaInactiva?: boolean;
  yaEstabaActivo?: boolean;
  yaEstabaInactivo?: boolean;
  /** Con `DATO_NO_ADMITIDO_POR_EL_MEDIO`: el primer dato que el tipo de medio no admite. */
  dato?: string;
};

const rechazoDeGuard = (r: RechazoDeGuardDeCuentasYMedios): ResultadoDeCuentasYMedios => ({ ok: false, codigo: r.codigo, campo: r.campo, mensaje: r.codigo === "SUCURSAL_FUERA_DE_ALCANCE" ? "No tenés acceso a esa sucursal." : r.codigo });

/** Lo que la pantalla necesita además del `ok` y el mensaje (`aResultadoAccion` los descarta). Solo campos de una lista (nunca se vuelca `datos` entero). */
function extras(r: { ok: boolean }): Omit<ResultadoDeCuentasYMedios, "ok" | "mensaje"> {
  const crudo = r as Record<string, unknown>;
  const fuente: Record<string, unknown> = r.ok ? ((crudo.datos ?? {}) as Record<string, unknown>) : crudo;
  const id = (clave: string): string | undefined => (typeof fuente[clave] === "string" ? (fuente[clave] as string) : undefined);
  const booleano = (clave: string): boolean | undefined => (typeof fuente[clave] === "boolean" ? (fuente[clave] as boolean) : undefined);
  const campos = {
    ...(!r.ok && typeof crudo.codigo === "string" ? { codigo: crudo.codigo } : {}),
    cuentaDeCobroId: id("cuentaDeCobroId"),
    medioDePagoId: id("medioDePagoId"),
    version: r.ok && typeof fuente.version === "number" ? fuente.version : undefined,
    yaExistia: booleano("yaExistia"),
    yaEstabaActiva: booleano("yaEstabaActiva"),
    yaEstabaInactiva: booleano("yaEstabaInactiva"),
    yaEstabaActivo: booleano("yaEstabaActivo"),
    yaEstabaInactivo: booleano("yaEstabaInactivo"),
    dato: !r.ok ? id("dato") : undefined,
  };
  return Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
}

/** «Dar de alta una cuenta de cobro» (terminal, QR o cuenta bancaria) de una sucursal. Nace activa; una sola activa por sucursal. */
export async function crearCuentaDeCobroDeCaja(entrada: EntradaDeCrearCuentaDeCobro): Promise<ResultadoDeCuentasYMedios> {
  return conPermiso("caja_cuenta_de_cobro_crear", async (ctx) => {
    const comando = guardComandoCrearCuentaDeCobro(entrada, { sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await crearCuentaDeCobroCasoDeUso(ctx, comando.valor, azarDelProceso);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Editar una cuenta de cobro»: nombre, identificador y sucursal, con la versión que vio la pantalla (control de versión optimista). */
export async function editarCuentaDeCobroDeCaja(entrada: EntradaDeEditarCuentaDeCobro): Promise<ResultadoDeCuentasYMedios> {
  return conPermiso("caja_cuenta_de_cobro_editar", async (ctx) => {
    const comando = guardComandoEditarCuentaDeCobro(entrada, { sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await editarCuentaDeCobroCasoDeUso(ctx, comando.valor);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Desactivar una cuenta de cobro». Repetirlo no escribe (`yaEstabaInactiva`). */
export async function desactivarCuentaDeCobroDeCaja(entrada: EntradaDeCambiarEstadoDeCuentaDeCobro): Promise<ResultadoDeCuentasYMedios> {
  return conPermiso("caja_cuenta_de_cobro_desactivar", async (ctx) => {
    const comando = guardComandoCambiarEstadoDeCuentaDeCobro(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await desactivarCuentaDeCobroCasoDeUso(ctx, comando.valor);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Reactivar una cuenta de cobro»: con otra activa en la sucursal se rechaza. Repetirlo no escribe (`yaEstabaActiva`). */
export async function reactivarCuentaDeCobroDeCaja(entrada: EntradaDeCambiarEstadoDeCuentaDeCobro): Promise<ResultadoDeCuentasYMedios> {
  return conPermiso("caja_cuenta_de_cobro_reactivar", async (ctx) => {
    const comando = guardComandoCambiarEstadoDeCuentaDeCobro(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await reactivarCuentaDeCobroCasoDeUso(ctx, comando.valor);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Dar de alta un medio de pago» de la empresa (uno de los seis tipos). Nace activo y sin pedir ningún dato extra. */
export async function crearMedioDePagoDeCaja(entrada: EntradaDeCrearMedioDePago): Promise<ResultadoDeCuentasYMedios> {
  return conPermiso("caja_medio_de_pago_crear", async (ctx) => {
    const comando = guardComandoCrearMedioDePago(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await crearMedioDePagoCasoDeUso(ctx, comando.valor, azarDelProceso);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Editar un medio de pago»: nombre y el conjunto FINAL de datos que pide al cobrar, con la versión que vio la pantalla. */
export async function editarMedioDePagoDeCaja(entrada: EntradaDeEditarMedioDePago): Promise<ResultadoDeCuentasYMedios> {
  return conPermiso("caja_medio_de_pago_editar", async (ctx) => {
    const comando = guardComandoEditarMedioDePago(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await editarMedioDePagoCasoDeUso(ctx, comando.valor);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Desactivar un medio de pago» (el efectivo no se desactiva). Repetirlo no escribe (`yaEstabaInactivo`). */
export async function desactivarMedioDePagoDeCaja(entrada: EntradaDeCambiarEstadoDeMedioDePago): Promise<ResultadoDeCuentasYMedios> {
  return conPermiso("caja_medio_de_pago_desactivar", async (ctx) => {
    const comando = guardComandoCambiarEstadoDeMedioDePago(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await desactivarMedioDePagoCasoDeUso(ctx, comando.valor);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Reactivar un medio de pago». Repetirlo no escribe (`yaEstabaActivo`). */
export async function reactivarMedioDePagoDeCaja(entrada: EntradaDeCambiarEstadoDeMedioDePago): Promise<ResultadoDeCuentasYMedios> {
  return conPermiso("caja_medio_de_pago_reactivar", async (ctx) => {
    const comando = guardComandoCambiarEstadoDeMedioDePago(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await reactivarMedioDePagoCasoDeUso(ctx, comando.valor);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}
