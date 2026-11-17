"use server";

import { guardComandoAbrirSesion, guardComandoAnularMovimiento, guardComandoCerrarSesion, guardComandoCobrarCuenta, guardComandoMovimientoManual, type RechazoDeGuardDeCaja } from "@/core/features/caja/caja.guard";
import type { EntradaDeAbrirSesion, EntradaDeAnularMovimiento, EntradaDeCerrarSesion, EntradaDeCobrarCuenta, EntradaDeMovimientoManual } from "@/core/features/caja/caja.schema";
import { aResultadoAccion } from "@/core/resultado-caso";
import { azarDelProceso } from "@/lib/azar";
import { requierePermiso } from "@/server/acceso/gate";
import { conPermiso } from "../con-permiso";
import { type ResultadoAccion } from "../tipos";
import { abrirSesionCasoDeUso } from "./casos-de-uso/abrir-sesion";
import { anularMovimientoCasoDeUso } from "./casos-de-uso/anular-movimiento";
import { cerrarSesionCasoDeUso } from "./casos-de-uso/cerrar-sesion";
import { cobrarCuentaCasoDeUso } from "./casos-de-uso/cobrar-cuenta";
import { registrarMovimientoManualCasoDeUso } from "./casos-de-uso/registrar-movimiento-manual";

/**
 * Las Server Actions de la CAJA (etapa C1, PR-B; docs/diseno-caja-c1-pr-b-permisos-acciones-y-consultas-2026-11-16.md): adaptadores finos. Permiso (PRIMERA línea, `conPermiso`) → formato (`guardComando…`) → caso de uso
 * (`./casos-de-uso/`). Nada que mande el navegador decide quién es ni de qué sucursal: la sucursal y el usuario son los del contexto de la sesión.
 * El resultado es `ResultadoAccion` MÁS lo que la pantalla necesita para decidir sin adivinar: el `codigo` estable del fallo (la pantalla lo traduce a texto: acá el mensaje de un rechazo de formato es solo el código), los ids
 * que ya son de la pantalla, `yaExistia` (el reintento con la misma clave) y los importes en CENTAVOS como TEXTO (nunca `number`). Ninguna refresca la vista: quien llama es un componente de cliente.
 */
export type ResultadoDeCaja = ResultadoAccion & {
  /** El código estable del fallo (formato o regla del caso de uso). */
  codigo?: string;
  /** Con un rechazo de formato: cuál dato (`renglones.2.importe`). */
  campo?: string;
  sesionId?: string;
  movimientoId?: string;
  cobranzaId?: string;
  /** El reintento con la misma clave devolvió lo ya hecho. */
  yaExistia?: boolean;
  /** Solo al cerrar: la caja ya estaba cerrada con el mismo conteo. */
  yaEstabaCerrada?: boolean;
  /** Solo en un egreso: superó el efectivo esperado (se permite; es un aviso). */
  superaElEfectivo?: boolean;
  /** Con `TOTAL_CAMBIO`: el total actual de la cuenta, en centavos. */
  totalActualEnCentavos?: string;
  /** Con `COBRO_NO_CUADRA`: lo que falta y lo que sobra, en centavos. */
  faltaEnCentavos?: string;
  sobraEnCentavos?: string;
  /** Al cerrar: contado menos esperado en efectivo, en centavos (negativo falta, positivo sobra). */
  diferenciaEnEfectivoEnCentavos?: string;
};

const rechazoDeGuard = (r: RechazoDeGuardDeCaja): ResultadoDeCaja => ({ ok: false, codigo: r.codigo, campo: r.campo, mensaje: r.codigo });

/**
 * Lo que la pantalla necesita además del `ok` y el mensaje (`aResultadoAccion` los descarta): el código del fallo, los ids y los importes en centavos como TEXTO. Solo campos de una lista (nunca se vuelca `datos` entero).
 */
function extras(r: { ok: boolean }): Omit<ResultadoDeCaja, "ok" | "mensaje"> {
  const crudo = r as Record<string, unknown>;
  const fuente: Record<string, unknown> = r.ok ? ((crudo.datos ?? {}) as Record<string, unknown>) : crudo;
  const texto = (clave: string): string | undefined => (typeof fuente[clave] === "bigint" ? (fuente[clave] as bigint).toString() : undefined);
  const id = (clave: string): string | undefined => (typeof fuente[clave] === "string" ? (fuente[clave] as string) : undefined);
  const booleano = (clave: string): boolean | undefined => (typeof fuente[clave] === "boolean" ? (fuente[clave] as boolean) : undefined);
  const campos = {
    ...(!r.ok && typeof crudo.codigo === "string" ? { codigo: crudo.codigo } : {}),
    sesionId: id("sesionId"),
    movimientoId: id("movimientoId"),
    cobranzaId: id("cobranzaId"),
    yaExistia: booleano("yaExistia"),
    yaEstabaCerrada: booleano("yaEstabaCerrada"),
    superaElEfectivo: booleano("superaElEfectivo"),
    totalActualEnCentavos: texto("totalActualEnCentavos"),
    faltaEnCentavos: texto("faltaEnCentavos"),
    sobraEnCentavos: texto("sobraEnCentavos"),
    diferenciaEnEfectivoEnCentavos: texto("diferenciaEnEfectivoEnCentavos"),
  };
  return Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
}

/** «Abrir la caja» de la sucursal activa con su fondo inicial (texto decimal; admite «0»). */
export async function abrirSesionDeCaja(entrada: EntradaDeAbrirSesion): Promise<ResultadoDeCaja> {
  return conPermiso("caja_abrir_sesion", async (ctx) => {
    const comando = guardComandoAbrirSesion(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await abrirSesionCasoDeUso(ctx, comando.valor, azarDelProceso);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Ingreso o egreso manual de efectivo» en la sesión abierta, con motivo. */
export async function registrarMovimientoDeCaja(entrada: EntradaDeMovimientoManual): Promise<ResultadoDeCaja> {
  return conPermiso("caja_mover_efectivo", async (ctx) => {
    const comando = guardComandoMovimientoManual(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await registrarMovimientoManualCasoDeUso(ctx, comando.valor, azarDelProceso);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Anular un movimiento manual»: lo propio con `caja_mover_efectivo`; el de otra persona solo con `caja_anular_movimiento_ajeno` (la misma regla del gate, no una copia). */
export async function anularMovimientoDeCaja(entrada: EntradaDeAnularMovimiento): Promise<ResultadoDeCaja> {
  return conPermiso("caja_mover_efectivo", async (ctx) => {
    const comando = guardComandoAnularMovimiento(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const puedeAnularAjenos = (await requierePermiso(ctx.usuarioId, ctx.sucursalId, "caja_anular_movimiento_ajeno", ctx.db)).ok;
    const r = await anularMovimientoCasoDeUso(ctx, comando.valor, puedeAnularAjenos, azarDelProceso);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Cerrar la caja con arqueo»: billetes por denominación y monedas (texto decimal). Cerrar con diferencia se permite y queda auditado. */
export async function cerrarSesionDeCaja(entrada: EntradaDeCerrarSesion): Promise<ResultadoDeCaja> {
  return conPermiso("caja_cerrar_sesion", async (ctx) => {
    const comando = guardComandoCerrarSesion(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await cerrarSesionCasoDeUso(ctx, comando.valor, azarDelProceso);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}

/** «Cobrar una cuenta cerrada» con uno o más medios de pago (la suma tiene que dar el total al centavo). */
export async function cobrarCuenta(entrada: EntradaDeCobrarCuenta): Promise<ResultadoDeCaja> {
  return conPermiso("cobrar_cuenta", async (ctx) => {
    const comando = guardComandoCobrarCuenta(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await cobrarCuentaCasoDeUso(ctx, comando.valor, azarDelProceso);
    return { ...aResultadoAccion(r), ...extras(r) };
  });
}
