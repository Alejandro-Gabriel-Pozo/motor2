"use server";

import { refrescarVistaSiHaceFalta } from "../refrescar";
import { esPermutacionExacta, aplicarSecuencia, insertarEnPosicion } from "@/core/catalogo/public";
import { INCLUDE_RECETA_COMPLETA, mapCabeceraAInput, mapIngredientesAInput, mapPasosAInput } from "@/core/catalogo/public-servidor";
import { ALCANCE_CENTRAL } from "@/core/catalogo/public";
import { cargarHistorialDeVersiones, cargarRecetaVigente } from "@/server/lecturas/catalogo/recetas-vigentes";
import { type CabeceraRecetaInput, type IngredienteInput, type PasoInput } from "@/core/catalogo/public";
import {
  guardComandoActualizarCabeceraDeReceta,
  guardComandoActualizarIngredienteDeReceta,
  guardComandoActualizarPasoDeReceta,
  guardComandoAgregarIngredienteAReceta,
  guardComandoGuardarVersionDeReceta,
  guardComandoInsertarPasoEnReceta,
  guardComandoQuitarIngredienteDeReceta,
  guardComandoQuitarPasoDeReceta,
  guardComandoReordenarPasosDeReceta,
} from "@/core/features/catalogo/receta-version.guard";
import type { PuertaDeReceta, RechazoDeLaPuertaDeReceta } from "@/core/features/catalogo/receta-version.schema";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, ok, type ResultadoAccion, type ResultadoConConfirmacion } from "../tipos";
import { conPedidoDeConfirmacion } from "./pedido-de-confirmacion";
import { requerirVerDeEmpresa } from "../con-sesion";
import { guardarVersionDeRecetaCasoDeUso } from "./casos-de-uso/guardar-version-de-receta";

/** Equivalente de construirMapaRecetas_ (Catalogo.js:1549-1596): vigente = MAX(version), siempre derivado. */
export async function obtenerRecetaVigente(productoId: string) {
  const ctx = await requerirVerDeEmpresa("guardar_receta");
  return cargarRecetaVigente(ctx.db, ALCANCE_CENTRAL, productoId, { include: INCLUDE_RECETA_COMPLETA });
}

/**
 * Todas las versiones de una receta, más reciente primero — el
 * versionado ya era append-only (nunca se pisa ni se borra una versión
 * vieja), esto solo expone ese historial que hasta ahora quedaba
 * guardado pero invisible en la UI (que solo mostraba la vigente).
 */
export async function listarVersionesDeReceta(productoId: string) {
  const ctx = await requerirVerDeEmpresa("guardar_receta");
  return cargarHistorialDeVersiones(ctx.db, ALCANCE_CENTRAL, productoId, INCLUDE_RECETA_COMPLETA);
}

/** La etapa a la que pertenece el dato de una acción puntual, y lo que su guard decidió (S-52). */
interface PuertaDeLaAccion {
  guard: PuertaDeReceta;
  etapa: RechazoDeLaPuertaDeReceta["codigo"];
}

/**
 * El reemplazo completo de la receta (desde la poda del 2026-11-06 ya no es una acción pública: el reemplazo a ciegas o con versión vive en `guardarRecetaACiegas`, solo servidor), que usan las acciones puntuales de abajo (agregar, editar o quitar UN ingrediente o paso, reordenar, insertar, la cabecera). No se exporta: este
 * archivo es `"use server"` y toda función exportada es un endpoint. Con `puerta` (S-52): dentro del permiso y antes de cualquier otra cosa se devuelve la etapa `inmediata` del guard de la
 * acción (el producto y la versión que vio la pantalla: lo mismo y en el mismo orden que `guardComandoGuardarVersionDeReceta`), y el rechazo del `rango` viaja al caso de uso, que lo aplica
 * después de leer el producto (un producto inexistente o no elegible gana sobre un dato fuera de rango).
 */
async function guardarRecetaConPuerta(
  productoId: string,
  items: IngredienteInput[],
  pasos: PasoInput[],
  cabecera: CabeceraRecetaInput,
  versionEsperada: number,
  puerta: PuertaDeLaAccion | null,
  confirmaCantidadDesproporcionada?: boolean
): Promise<ResultadoConConfirmacion> {
  return conPermisoDeEmpresa("guardar_receta", async (ctx) => {
    if (puerta && !puerta.guard.inmediata.ok) return error(puerta.guard.inmediata.mensaje);
    // Desde la red puede llegar cualquier cosa: un `pasos`/`cabecera` ausente sigue valiendo «sin pasos» / «sin cabecera», como cuando tenían valor por defecto.
    const comando = guardComandoGuardarVersionDeReceta({ productoId, items, pasos: pasos ?? [], cabecera: cabecera ?? {}, versionEsperada }, { exigirVersion: true });
    if (!comando.ok) return error(comando.mensaje);
    const rechazoDeLaPuerta = puerta && !puerta.guard.rango.ok ? { codigo: puerta.etapa, mensaje: puerta.guard.rango.mensaje } : null;
    // Guardia de unidad (docs/diseno-guardia-de-unidad-receta-2026-11-09.md): la confirmación viaja con el pedido; solo un `true` estricto confirma y la valida el caso de uso.
    const resultado = await guardarVersionDeRecetaCasoDeUso(ctx, { ...comando.valor, ...(rechazoDeLaPuerta ? { puerta: rechazoDeLaPuerta } : {}), confirmaCantidadDesproporcionada: confirmaCantidadDesproporcionada === true });
    // Sin esto la página no refleja el cambio en un navegador real hasta
    // recargar a mano (ver src/server/actions/refrescar.ts) — detectado
    // con Playwright, no con Vitest ni con los closures que ya hacían
    // `redirect(volver)` tras un `ok` (una navegación real ya refresca sola).
    if (resultado.ok) refrescarVistaSiHaceFalta();
    return conPedidoDeConfirmacion(resultado, aResultadoAccion(resultado));
  });
}

/**
 * Equivalente de agregarIngredienteAReceta (Catalogo.js:1817-1843): NO hace
 * un guardado parcial — lee la receta vigente completa, rechaza si el
 * insumo ya está, arma la unión, y delega en guardarRecetaConPuerta (que genera la
 * próxima versión con TODOS los ingredientes juntos, más los pasos y la
 * cabecera vigentes sin tocar).
 */
export async function agregarIngredienteAReceta(productoId: string, ingrediente: IngredienteInput, versionVista: number, confirmaCantidadDesproporcionada?: boolean): Promise<ResultadoConConfirmacion> {
  // S-52: el guard de la puerta (forma y rango del ingrediente, producto y versión) se CALCULA acá; cada etapa se aplica en su lugar (ver `guardarRecetaConPuerta`).
  const guard = guardComandoAgregarIngredienteAReceta({ productoId, ingrediente, versionVista });
  if (!guard.forma.ok) return error(guard.forma.mensaje);
  const vigente = await obtenerRecetaVigente(productoId);
  const existentes = mapIngredientesAInput(vigente);

  if (existentes.some((i) => i.insumoProductoId === ingrediente.insumoProductoId)) {
    return error("Ese insumo ya está en la receta.");
  }

  return guardarRecetaConPuerta(productoId, [...existentes, ingrediente], mapPasosAInput(vigente), mapCabeceraAInput(vigente), versionVista, { guard, etapa: "INGREDIENTES_INVALIDOS" }, confirmaCantidadDesproporcionada);
}

/**
 * Edita cantidad/unidad/merma de un ingrediente YA cargado, en un solo
 * paso — antes la única forma de corregir, por ejemplo, "ahora lleva 150g
 * de harina en vez de 100g" era Quitar (una versión) + Agregar de nuevo
 * (otra versión), dos pasos sueltos por un solo cambio real. Mismo
 * criterio que agregarIngredienteAReceta: lee la receta vigente completa,
 * reemplaza ese ingrediente puntual, y delega en guardarRecetaConPuerta.
 */
export async function actualizarIngredienteDeReceta(
  productoId: string,
  insumoProductoId: string,
  cambios: { cantidad: number; unidadId: string; mermaPorcentaje?: number; insumoSustitutoIds?: string[] },
  versionVista: number,
  confirmaCantidadDesproporcionada?: boolean
): Promise<ResultadoConConfirmacion> {
  const guard = guardComandoActualizarIngredienteDeReceta({ productoId, cambios, versionVista });
  const vigente = await obtenerRecetaVigente(productoId);
  const existentes = mapIngredientesAInput(vigente);

  if (!existentes.some((i) => i.insumoProductoId === insumoProductoId)) {
    return error("Ese insumo no está en la receta vigente.");
  }
  // S-52: la forma de los cambios se aplica DESPUÉS de comprobar que el insumo está en la receta (un insumo que no está gana sobre unos cambios mal armados).
  if (!guard.forma.ok) return error(guard.forma.mensaje);

  const items = existentes.map((i) =>
    i.insumoProductoId === insumoProductoId
      ? {
          insumoProductoId,
          cantidad: cambios.cantidad,
          unidadId: cambios.unidadId,
          mermaPorcentaje: cambios.mermaPorcentaje ?? 0,
          observaciones: i.observaciones,
          // undefined = conservar los sustitutos vigentes (docs/plan-sustitucion-insumos-receta-2026-09-26.md, paso 6) — solo se
          // reemplazan cuando quien llama manda la lista explícita (incluso `[]` para vaciarla).
          insumoSustitutoIds: cambios.insumoSustitutoIds ?? i.insumoSustitutoIds,
        }
      : i
  );

  return guardarRecetaConPuerta(productoId, items, mapPasosAInput(vigente), mapCabeceraAInput(vigente), versionVista, { guard, etapa: "INGREDIENTES_INVALIDOS" }, confirmaCantidadDesproporcionada);
}

/**
 * Quita un ingrediente de la receta vigente — reemplaza el armado inline
 * que antes vivía en la página (`page.tsx`), ahora centralizado para que
 * también se encargue de sacar ese insumo de cualquier paso que lo
 * mencionara (si no, `validarPasos` rechazaría la nueva versión por
 * referenciar un ingrediente que ya no está).
 */
export async function quitarIngredienteDeReceta(productoId: string, insumoProductoId: string, versionVista: number): Promise<ResultadoAccion> {
  // S-52: el guard de la puerta se CALCULA acá (el insumo a quitar, el producto y la versión); la forma se aplica de entrada y el resto en su lugar (ver `guardarRecetaConPuerta`).
  const guard = guardComandoQuitarIngredienteDeReceta({ productoId, insumoProductoId, versionVista });
  if (!guard.forma.ok) return error(guard.forma.mensaje);
  const vigente = await obtenerRecetaVigente(productoId);
  const items = mapIngredientesAInput(vigente).filter((i) => i.insumoProductoId !== insumoProductoId);
  const pasos = mapPasosAInput(vigente).map((p) => ({
    ...p,
    insumoProductoIds: p.insumoProductoIds?.filter((id) => id !== insumoProductoId),
  }));

  return guardarRecetaConPuerta(productoId, items, pasos, mapCabeceraAInput(vigente), versionVista, { guard, etapa: "INGREDIENTES_INVALIDOS" });
}

/** Edita un paso ya cargado (identificado por su `orden` vigente) en un solo paso, mismo criterio que actualizarIngredienteDeReceta. */
export async function actualizarPasoDeReceta(
  productoId: string,
  orden: number,
  cambios: { nombre?: string; instruccion: string; minutos?: number; insumoProductoIds?: string[] },
  versionVista: number
): Promise<ResultadoAccion> {
  const guard = guardComandoActualizarPasoDeReceta({ productoId, orden, cambios, versionVista });
  const vigente = await obtenerRecetaVigente(productoId);
  const pasosExistentes = mapPasosAInput(vigente);

  if (!pasosExistentes.some((p) => p.orden === orden)) {
    return error("Ese paso no está en la receta vigente.");
  }
  // S-52: la forma de los cambios se aplica DESPUÉS de comprobar que el paso está en la receta (un paso que no está gana sobre unos cambios mal armados).
  if (!guard.forma.ok) return error(guard.forma.mensaje);

  const pasos = pasosExistentes.map((p) => (p.orden === orden ? { orden, ...cambios } : p));
  return guardarRecetaConPuerta(productoId, mapIngredientesAInput(vigente), pasos, mapCabeceraAInput(vigente), versionVista, { guard, etapa: "PASOS_INVALIDOS" });
}

/** Quita un paso de la receta vigente. */
export async function quitarPasoDeReceta(productoId: string, orden: number, versionVista: number): Promise<ResultadoAccion> {
  // S-52: el orden del paso (un entero entre 1 y el tope) lo decide el guard de la puerta, primero de todo como antes; el producto y la versión se aplican en `guardarRecetaConPuerta`.
  const guard = guardComandoQuitarPasoDeReceta({ productoId, orden, versionVista });
  if (!guard.forma.ok) return error(guard.forma.mensaje);
  const vigente = await obtenerRecetaVigente(productoId);
  const pasos = mapPasosAInput(vigente).filter((p) => p.orden !== orden);
  return guardarRecetaConPuerta(productoId, mapIngredientesAInput(vigente), pasos, mapCabeceraAInput(vigente), versionVista, { guard, etapa: "PASOS_INVALIDOS" });
}

/**
 * Reordena los pasos de la receta vigente según `secuencia` (los `orden`
 * vigentes, en el orden nuevo deseado — no dos updates sueltos: `validarPasos`
 * rechaza dos pasos con el mismo `orden` en el mismo payload, así que un
 * reordenamiento tiene que mandar la permutación completa de una vez). Si la
 * secuencia resultante es idéntica a la vigente no se guarda nada (no
 * ensucia el historial con una versión sin cambios).
 */
export async function reordenarPasosDeReceta(productoId: string, secuencia: number[], versionVista: number): Promise<ResultadoAccion> {
  const guard = guardComandoReordenarPasosDeReceta({ productoId, secuencia, versionVista });
  const vigente = await obtenerRecetaVigente(productoId);
  const pasosExistentes = mapPasosAInput(vigente);
  const ordenesVigentes = pasosExistentes.map((p) => p.orden);

  // S-52: una secuencia mal formada (no es una lista, es larguísima o trae algo que no es un orden) se rechaza con el MISMO texto que una que no es permutación; `forma` va primero para que
  // `esPermutacionExacta` no ordene un arreglo cualquiera.
  if (!guard.forma.ok) return error(guard.forma.mensaje);
  if (!esPermutacionExacta(secuencia, ordenesVigentes)) {
    return error("La secuencia de pasos no es válida (faltan, sobran o se repiten pasos).");
  }
  if (secuencia.every((orden, i) => orden === ordenesVigentes[i])) {
    return ok("No hubo cambios en el orden.");
  }

  const pasos = aplicarSecuencia(pasosExistentes, secuencia);
  return guardarRecetaConPuerta(productoId, mapIngredientesAInput(vigente), pasos, mapCabeceraAInput(vigente), versionVista, { guard, etapa: "PASOS_INVALIDOS" });
}

/**
 * Inserta un paso nuevo en una posición 1-indexada de la receta vigente
 * (corrida a [1, N+1]), corriendo los siguientes y renumerando. Agregar «al
 * final» es pasar N+1 (la pantalla sabe cuántos pasos vigentes hay).
 */
export async function insertarPasoEnReceta(productoId: string, posicion: number, paso: Omit<PasoInput, "orden">, versionVista: number): Promise<ResultadoAccion> {
  // S-52: la posición (un entero entre 0 y el tope: `insertarEnPosicion` recorta una fuera de rango, pero un NaN lo dejaría en silencio al principio) y la forma del paso las decide el guard
  // de la puerta, primero de todo como antes; el producto y la versión se aplican en `guardarRecetaConPuerta`, y el rango de los textos y los minutos del paso, en el caso de uso.
  const guard = guardComandoInsertarPasoEnReceta({ productoId, posicion, paso, versionVista });
  if (!guard.forma.ok) return error(guard.forma.mensaje);
  const vigente = await obtenerRecetaVigente(productoId);
  const pasosExistentes = mapPasosAInput(vigente);

  const pasos = insertarEnPosicion(pasosExistentes, posicion, { ...paso, orden: -1 });
  return guardarRecetaConPuerta(productoId, mapIngredientesAInput(vigente), pasos, mapCabeceraAInput(vigente), versionVista, { guard, etapa: "PASOS_INVALIDOS" });
}

/**
 * Actualiza solo la cabecera informativa (rendimiento/raciones/tiempos/
 * comentarios/etc.) — preserva ingredientes y pasos vigentes sin tocar.
 */
export async function actualizarCabeceraDeReceta(productoId: string, cabecera: CabeceraRecetaInput, versionVista: number): Promise<ResultadoAccion> {
  const guard = guardComandoActualizarCabeceraDeReceta({ productoId, cabecera, versionVista });
  const vigente = await obtenerRecetaVigente(productoId);
  if (!vigente) return error('Todavía no hay ninguna receta — agregá al menos un ingrediente antes de completar esto.');
  // S-52: la forma de la cabecera se aplica DESPUÉS de comprobar que hay receta (sin receta gana sobre una cabecera mal armada).
  if (!guard.forma.ok) return error(guard.forma.mensaje);

  return guardarRecetaConPuerta(productoId, mapIngredientesAInput(vigente), mapPasosAInput(vigente), cabecera, versionVista, { guard, etapa: "CABECERA_INVALIDA" });
}
