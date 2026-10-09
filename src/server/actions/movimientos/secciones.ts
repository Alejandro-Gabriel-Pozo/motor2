"use server";

import { guardComandoActualizarRespaldoSeccion, guardComandoCrearSeccion, guardComandoRenombrarSeccion } from "@/core/features/movimientos/secciones.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirVerAlgunaEnSucursal, requerirVerEnSucursal } from "../con-sesion";
import { actualizarActivaSeccionCasoDeUso } from "./casos-de-uso/actualizar-activa-seccion";
import { actualizarRespaldoSeccionCasoDeUso } from "./casos-de-uso/actualizar-respaldo-seccion";
import { crearSeccionCasoDeUso } from "./casos-de-uso/crear-seccion";
import { renombrarSeccionCasoDeUso } from "./casos-de-uso/renombrar-seccion";

/**
 * Port de HOJA_SECCIONES (Stock.js:1316-1415) — antes una hoja POR
 * CONTENEDOR (cada sucursal ya tenía sus propias Secciones porque cada una
 * era un spreadsheet separado); acá sucursalId es una columna real. Las
 * secciones activas pueblan los <select> de muchas pantallas (los paneles de
 * Movimientos, venta, conteo físico, stock, traspasos, reportes y el salón):
 * desde H8 (decisión del dueño) exigen membresía en la sucursal pedida y el
 * «Ver» de ALGUNA de esas 20 pantallas, evaluado en esa sucursal (antes
 * bastaba la sesión, como `obtenerSeccionesParaCarga` en Apps Script).
 *
 * Desde el Hito 4 de la pureza (bloque C de la pieza carta/catálogo/stock, paso H4C-18) las cuatro mutaciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{crear-seccion,renombrar-seccion,actualizar-activa-seccion,actualizar-respaldo-seccion}.ts`; escrituras en
 * server/persistencia/movimientos/secciones.ts; el formato en core/features/movimientos/secciones.guard.ts): el archivo entero está en `ACCIONES_CON_CASO_DE_USO`.
 * Las lecturas (H8) siguen acá con sus guardas. La acción refresca la vista en los mismos caminos que antes (solo si salió bien).
 */
export async function listarSeccionesActivas(sucursalId: string) {
  const ctx = await requerirVerAlgunaEnSucursal(sucursalId, [
    "proceso_compra",
    "proceso_produccion",
    "proceso_consumo",
    "proceso_ajuste",
    "proceso_transferencia",
    "proceso_merma",
    "proceso_devolucion_consignacion",
    "proceso_devolucion_cliente",
    "proceso_devolucion_proveedor",
    "proceso_venta",
    "proceso_control",
    "reporte_conteos",
    "reporte_historial",
    "stock_minimo",
    "stock_reclasificar",
    "stock_seccion_habitual",
    "traspaso_ver_bandeja",
    "traspaso_solicitar",
    "traspaso_enviar_directo",
    "pos_mesas",
  ]);
  return ctx.db.seccion.findMany({ where: { sucursalId, activa: true }, orderBy: { nombre: "asc" } });
}

/** Todas (activas e inactivas) — para el panel de administración. */
export async function listarSeccionesParaPanel(sucursalId: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "secciones");
  return ctx.db.seccion.findMany({ where: { sucursalId }, orderBy: { nombre: "asc" } });
}

/** Alta de una sección nueva. Admin-only ('secciones'): define el catálogo cerrado que van a usar todos los operadores de esa sucursal. */
export async function crearSeccion(nombre: string): Promise<ResultadoConId> {
  return conPermiso<ResultadoConId>("secciones", async (ctx) => {
    const comando = guardComandoCrearSeccion({ nombre });
    if (!comando.ok) return error(comando.mensaje);
    const r = await crearSeccionCasoDeUso(ctx, comando.valor);
    // Se llama desde un closure "use server" de la página, sin redirigir: sin esto la tabla no cambia en un navegador real (ver refrescar.ts).
    if (r.ok) refrescarVistaSiHaceFalta();
    const base = aResultadoAccion(r);
    return r.ok ? okConId(base.mensaje, r.datos.id, r.datos.nombre) : error(base.mensaje);
  });
}

/**
 * Renombrar una sección existente — antes solo se podía elegir el nombre
 * una vez, al crearla; la única salida era desactivarla y crear una
 * nueva, fragmentando el historial del Kardex (mismo hueco ya señalado
 * para Proveedores). El Kardex ya escrito referencia la sección por FK,
 * así que renombrarla no rompe nada de lo ya cargado.
 */
export async function renombrarSeccion(seccionId: string, nombreNuevo: string): Promise<ResultadoAccion> {
  return conPermiso("secciones", async (ctx) => {
    const comando = guardComandoRenombrarSeccion({ seccionId, nombreNuevo });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await renombrarSeccionCasoDeUso(ctx, comando.valor);
    if (resultado.ok) refrescarVistaSiHaceFalta(); // ver crearSeccion
    return aResultadoAccion(resultado);
  });
}

/**
 * Activa/desactiva una sección. No se borra: el Kardex ya escrito con esa sección sigue siendo válido, solo deja de ofrecerse para cargas nuevas. Sin guard
 * (`SIN_GUARD`: solo recibe un id y un booleano).
 */
export async function actualizarActivaSeccion(seccionId: string, activa: boolean): Promise<ResultadoAccion> {
  return conPermiso("secciones", async (ctx) => {
    const resultado = await actualizarActivaSeccionCasoDeUso(ctx, { seccionId, activa });
    if (resultado.ok) refrescarVistaSiHaceFalta(); // ver crearSeccion
    return aResultadoAccion(resultado);
  });
}

/**
 * ¿Sirve de RESPALDO automático al cerrar una cuenta del salón? (`Seccion.sirveDeRespaldoEnVentas`, docs/plan-seccion-habitual-stock-
 * 2026-09-25.md, B5/C10). Con `false`, el cierre solo descuenta de acá cuando es la sección habitual de un producto; la venta de mostrador
 * no cambia (ahí la sección la elige una persona). No se borra ni desactiva nada.
 */
export async function actualizarRespaldoSeccion(seccionId: string, sirveDeRespaldoEnVentas: boolean): Promise<ResultadoAccion> {
  return conPermiso("secciones", async (ctx) => {
    const comando = guardComandoActualizarRespaldoSeccion({ seccionId, sirveDeRespaldoEnVentas });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await actualizarRespaldoSeccionCasoDeUso(ctx, comando.valor);
    if (resultado.ok) refrescarVistaSiHaceFalta(); // ver crearSeccion
    return aResultadoAccion(resultado);
  });
}
