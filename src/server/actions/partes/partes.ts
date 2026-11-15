"use server";

import { guardComandoAltaDeParte, guardComandoCambiarEstadoDeParte, guardComandoEditarParte, type RechazoDeGuardDeParte } from "@/core/features/partes/partes.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import type { EntradaDeAltaDeParte, EntradaDeEdicionDeParte } from "@/core/features/partes/partes.schema";
import { azarDelProceso } from "@/lib/azar";
import { buscarPartes, type FichaEncontrada } from "@/server/lecturas/partes/buscar-partes";
import { conPermisoDeEmpresa } from "../con-permiso";
import { requerirVerDeEmpresa } from "../con-sesion";
import { type ResultadoAccion } from "../tipos";
import { altaDeParteCasoDeUso } from "./casos-de-uso/alta-de-parte";
import { cambiarEstadoDeParteCasoDeUso } from "./casos-de-uso/cambiar-estado-de-parte";
import { editarParteCasoDeUso } from "./casos-de-uso/editar-parte";

/**
 * Las Server Actions de la FICHA DE PARTE (ficha única de personas y empresas; docs/diseno-parte-ficha-unica-2026-11-15.md, etapa P1 (b)): adaptadores finos. Permiso de EMPRESA → formato (`guardComando…`) → caso de uso (`./casos-de-uso/`).
 * El resultado es `ResultadoAccion` MÁS lo que la pantalla necesita para decidir sin adivinar: el `codigo` estable del fallo (la pantalla lo traduce a texto en la etapa (c): acá el mensaje es solo el código), el `parteId` de la ficha creada o con la
 * que se chocó (para usar esa ficha), el aviso de posibles duplicados y el error de cada campo. Ninguna refresca la vista: quien llama es un componente de cliente que lo pide él mismo.
 */
export type ResultadoDeFichaDeParte = ResultadoAccion & {
  codigo?: string;
  parteId?: string;
  yaExistia?: boolean;
  posiblesDuplicados?: readonly string[];
  /** Un código por campo inválido (`DATOS_INVALIDOS`). */
  errores?: Readonly<Record<string, string>>;
  version?: number;
};

const rechazoDeGuard = (r: RechazoDeGuardDeParte): ResultadoDeFichaDeParte => ({
  ok: false,
  codigo: r.codigo,
  mensaje: r.codigo,
  ...(r.errores.length > 0 ? { errores: Object.fromEntries(r.errores.map((e) => [e.campo, e.codigo])) } : {}),
});

/** Lo que la pantalla necesita además del `ok` y el mensaje (`aResultadoAccion` los descarta): el código del fallo, el id de la ficha, el aviso de duplicados y la versión. */
function extrasDeFicha(r: { ok: true; datos: object } | { ok: false; codigo: string; parteId?: string }): Omit<ResultadoDeFichaDeParte, "ok" | "mensaje"> {
  if (!r.ok) return { codigo: r.codigo, ...(r.parteId ? { parteId: r.parteId } : {}) };
  const d = r.datos as Record<string, unknown>;
  return {
    parteId: d.parteId as string,
    ...(typeof d.yaExistia === "boolean" ? { yaExistia: d.yaExistia } : {}),
    ...(Array.isArray(d.posiblesDuplicados) ? { posiblesDuplicados: d.posiblesDuplicados as string[] } : {}),
    ...(typeof d.version === "number" ? { version: d.version } : {}),
  };
}

/** «Alta de una ficha»: la clave de reintento (UUID de la pantalla) y los datos de la persona o empresa. */
export async function altaDeParte(entrada: EntradaDeAltaDeParte): Promise<ResultadoDeFichaDeParte> {
  return conPermisoDeEmpresa("partes_editar", async (ctx) => {
    const comando = guardComandoAltaDeParte(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await altaDeParteCasoDeUso(ctx, comando.valor, azarDelProceso);
    return { ...aResultadoAccion(r), ...extrasDeFicha(r) };
  });
}

/** «Editar una ficha»: la ficha, la versión que se leyó y los datos completos. */
export async function editarParte(entrada: EntradaDeEdicionDeParte): Promise<ResultadoDeFichaDeParte> {
  return conPermisoDeEmpresa("partes_editar", async (ctx) => {
    const comando = guardComandoEditarParte(entrada);
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await editarParteCasoDeUso(ctx, comando.valor);
    return { ...aResultadoAccion(r), ...extrasDeFicha(r) };
  });
}

/** «Desactivar» o «reactivar» una ficha (solo administrador o gerente: `partes_desactivar`). */
export async function cambiarEstadoDeParte(parteId: string, activa: boolean): Promise<ResultadoDeFichaDeParte> {
  return conPermisoDeEmpresa("partes_desactivar", async (ctx) => {
    const comando = guardComandoCambiarEstadoDeParte({ parteId, activa });
    if (!comando.ok) return rechazoDeGuard(comando);
    const r = await cambiarEstadoDeParteCasoDeUso(ctx, comando.valor);
    return { ...aResultadoAccion(r), ...extrasDeFicha(r) };
  });
}

/** «Buscar fichas» por nombre o documento (`partes_ver`): solo nombre, documento y estado de cada una, hasta 50. */
export async function buscarFichasDeParte(texto: string, incluirInactivas = false): Promise<FichaEncontrada[]> {
  const ctx = await requerirVerDeEmpresa("partes_ver");
  return buscarPartes({ empresaId: ctx.empresaId, texto: typeof texto === "string" ? texto : "", incluirInactivas: incluirInactivas === true }, ctx.db);
}
