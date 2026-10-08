"use server";

import { texto } from "@/core/texto";
import { guardComandoCrearInsumo, guardComandoCrearOActualizarGrupo, guardComandoRenombrarOFusionarInsumo } from "@/core/features/catalogo/insumos.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirVerAlguna, requerirVerDeEmpresa } from "../con-sesion";
import { actualizarActivoGrupoCasoDeUso } from "./casos-de-uso/actualizar-activo-grupo";
import { actualizarActivoInsumoCasoDeUso } from "./casos-de-uso/actualizar-activo-insumo";
import { actualizarGrupoDeInsumoCasoDeUso } from "./casos-de-uso/actualizar-grupo-de-insumo";
import { crearInsumoCasoDeUso } from "./casos-de-uso/crear-insumo";
import { crearOActualizarGrupoCasoDeUso } from "./casos-de-uso/crear-o-actualizar-grupo";
import { renombrarOFusionarInsumoCasoDeUso } from "./casos-de-uso/renombrar-o-fusionar-insumo";

/**
 * Desde el Hito 4 de la pureza (bloque 4.3, paso H4C-9) las seis mutaciones de insumos y grupos son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{crear-insumo,actualizar-activo-insumo,actualizar-grupo-de-insumo,renombrar-o-fusionar-insumo,crear-o-actualizar-grupo,
 * actualizar-activo-grupo}.ts`; escrituras en server/persistencia/catalogo/{insumos,grupos}.ts): el archivo entero está en `ACCIONES_CON_CASO_DE_USO`. Las
 * lecturas de abajo (H8 y `previsualizarFusionInsumo`) siguen acá.
 */

/** H8: la pantalla de Insumos y Grupos o el formulario de producto (alta o edición). */
export async function listarInsumos() {
  const ctx = await requerirVerAlguna(["grupos_familia", "alta_producto", "producto_ver_catalogo"]);
  return ctx.db.insumo.findMany({ include: { grupo: true }, orderBy: { nombre: "asc" } });
}

/** H8: solo la pantalla de Insumos y Grupos. */
export async function listarGrupos() {
  const ctx = await requerirVerDeEmpresa("grupos_familia");
  return ctx.db.grupo.findMany({ orderBy: { nombre: "asc" } });
}

/**
 * Equivalente de crearFamiliaDesdePanel/crearFamilia_ (Catalogo.js:2939-2967): upsert case/espacio-insensible, reusa en silencio si ya existe. Devuelve el id — lo usa el quick-create inline del form de Producto.
 *
 * NO pide el refresco de la vista: la llaman TRES flujos y a dos les sobraría — la pantalla de Insumos (closure "use server" de la página, que
 * sí lo pide ahí), el alta rápida inline del formulario de Producto (QuickCrear) y el AsistenteHermanar (un modal dentro de ese formulario).
 * Esos dos devuelven el insumo por callback y NO deben re-renderizar la ruta con el formulario a medio llenar (ver la regla en refrescar.ts).
 *
 * Desde el Hito 4 (H4C-9): permiso (`conPermisoDeEmpresa("insumo_alta")`) → formato del nombre (`guardComandoCrearInsumo`, core/features/catalogo/insumos.guard.ts,
 * DENTRO del envoltorio) → caso de uso (`casos-de-uso/crear-insumo.ts`) → `aResultadoAccion`, y si salió bien el id y el nombre del insumo (`okConId`).
 */
export async function crearInsumo(nombre: string): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("insumo_alta", async (ctx) => {
    const comando = guardComandoCrearInsumo({ nombre });
    if (!comando.ok) return error(comando.mensaje);
    const r = await crearInsumoCasoDeUso(ctx, comando.valor);
    const base = aResultadoAccion(r);
    return r.ok ? okConId(base.mensaje, r.datos.id, r.datos.nombre) : error(base.mensaje);
  });
}

/** Desde el Hito 4 (H4C-9): permiso → caso de uso (`casos-de-uso/actualizar-activo-insumo.ts`) → refrescar la vista → `aResultadoAccion`. Sin guard (`SIN_GUARD`). */
export async function actualizarActivoInsumo(insumoId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("grupos_familia", async (ctx) => {
    const resultado = await actualizarActivoInsumoCasoDeUso(ctx, { insumoId, activo });
    // Se llama desde un closure "use server" de la página de Insumos, sin redirigir: sin esto la columna «Activo» no cambia (ver refrescar.ts).
    refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}

/** Desde el Hito 4 (H4C-9): permiso → caso de uso (`casos-de-uso/actualizar-grupo-de-insumo.ts`) → refrescar la vista → `aResultadoAccion`. Sin guard (`SIN_GUARD`). */
export async function actualizarGrupoDeInsumo(insumoId: string, grupoId: string | null): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("grupos_familia", async (ctx) => {
    const resultado = await actualizarGrupoDeInsumoCasoDeUso(ctx, { insumoId, grupoId });
    refrescarVistaSiHaceFalta(); // ver actualizarActivoInsumo
    return aResultadoAccion(resultado);
  });
}

/**
 * Solo lectura — no toca nada. La usa el cliente para decidir, ANTES de
 * llamar a renombrarOFusionarInsumo, si el nombre tipeado va a disparar una
 * fusión (y con qué insumo), para poder mostrar la confirmación explícita
 * que renombrarOFusionarInsumo exige (confirmarFusion) en vez de fusionar
 * de una sin que el usuario se entere de qué está pasando.
 */
export async function previsualizarFusionInsumo(insumoId: string, nombreNuevo: string): Promise<string | null> {
  // H8 (D-5): la pide el renombrar de la pantalla de Insumos y Grupos.
  const ctx = await requerirVerDeEmpresa("grupos_familia");
  const nuevo = texto(nombreNuevo);
  if (!nuevo) return null;
  const existente = await ctx.db.insumo.findFirst({
    where: { nombre: { equals: nuevo, mode: "insensitive" }, id: { not: insumoId } },
  });
  return existente?.nombre ?? null;
}

/**
 * Equivalente de renombrarFamilia (Catalogo.js:2565-2618) — mucho más
 * simple que en Sheets: como Producto.insumoId es FK real (no texto
 * duplicado en Hoja listado), fusionar es un UPDATE ... WHERE insumoId,
 * no un "buscar y reemplazar" fila por fila. Nunca toca Receta/Kardex —
 * Insumo nunca viajó a esas hojas (Catalogo.js:2557-2559).
 *
 * Cuando el nombre nuevo matchea un insumo existente, esto FUSIONA (mueve
 * todos los productos y borra el insumo viejo) en vez de solo renombrar —
 * por eso exige confirmarFusion=true explícito (ver previsualizarFusionInsumo
 * y validarFusionInsumos, que además bloquea fusionar unidades de stock
 * mezcladas bajo el mismo Insumo).
 *
 * Desde el Hito 4 (H4C-9): permiso (`conPermisoDeEmpresa("insumo_renombrar_fusionar")`) → formato del nombre nuevo (`guardComandoRenombrarOFusionarInsumo`,
 * DENTRO del envoltorio) → caso de uso (`casos-de-uso/renombrar-o-fusionar-insumo.ts`: los dos insumos, el choque de unidades, la confirmación, y la fusión en
 * UNA transacción o el renombre) → `aResultadoAccion`.
 */
export async function renombrarOFusionarInsumo(
  insumoId: string,
  nombreNuevo: string,
  confirmarFusion = false
): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("insumo_renombrar_fusionar", async (ctx) => {
    const comando = guardComandoRenombrarOFusionarInsumo({ insumoId, nombreNuevo, confirmarFusion });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await renombrarOFusionarInsumoCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Equivalente de crearOActualizarGrupo/actualizarGrupoPadre_ (Catalogo.js:2483-2519), con la misma validación de ciclo.
 *
 * Desde el Hito 4 (H4C-9): permiso (`conPermisoDeEmpresa("grupos_familia")`) → formato del nombre (`guardComandoCrearOActualizarGrupo`, DENTRO del envoltorio) →
 * caso de uso (`casos-de-uso/crear-o-actualizar-grupo.ts`) → refrescar la vista si salió bien (la «Cadena» de cada grupo se calcula en el servidor: sin refresco no
 * cambia hasta recargar) → `aResultadoAccion`.
 */
export async function crearOActualizarGrupo(nombre: string, grupoPadreId: string | null): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("grupos_familia", async (ctx) => {
    const comando = guardComandoCrearOActualizarGrupo({ nombre, grupoPadreId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await crearOActualizarGrupoCasoDeUso(ctx, comando.valor);
    if (resultado.ok) refrescarVistaSiHaceFalta(); // ver actualizarActivoInsumo
    return aResultadoAccion(resultado);
  });
}

/** Desde el Hito 4 (H4C-9): permiso → caso de uso (`casos-de-uso/actualizar-activo-grupo.ts`) → refrescar la vista → `aResultadoAccion`. Sin guard (`SIN_GUARD`). */
export async function actualizarActivoGrupo(grupoId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("grupos_familia", async (ctx) => {
    const resultado = await actualizarActivoGrupoCasoDeUso(ctx, { grupoId, activo });
    refrescarVistaSiHaceFalta(); // ver actualizarActivoInsumo
    return aResultadoAccion(resultado);
  });
}
