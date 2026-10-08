"use server";

import { refrescarVistaSiHaceFalta } from "../refrescar";
import { esPermutacionExacta, aplicarSecuencia, insertarEnPosicion } from "@/core/catalogo/public";
import { INCLUDE_RECETA_COMPLETA, mapCabeceraAInput, mapIngredientesAInput, mapPasosAInput } from "@/core/catalogo/public-servidor";
import { ALCANCE_CENTRAL } from "@/core/catalogo/public";
import { cargarHistorialDeVersiones, cargarRecetaVigente } from "@/server/lecturas/catalogo/recetas-vigentes";
import { type CabeceraRecetaInput, type IngredienteInput, type PasoInput } from "@/core/catalogo/public";
import { guardComandoGuardarVersionDeReceta } from "@/core/features/catalogo/receta-version.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
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

/**
 * Equivalente de guardarReceta (Catalogo.js:1711-1779): versionado
 * append-only real — NUNCA pisa ni borra una versión vieja. `version` se
 * calcula de forma optimista (MAX(version)+1); el
 * `@@unique([productoId, version])` es el árbitro final ante dos
 * ediciones simultáneas de la misma receta (se reintenta el cálculo, con
 * backoff y jitter entre intentos — `conReintento`).
 *
 * `pasos`/`cabecera` viajan en la MISMA versión que `items` — reemplazo
 * completo de los tres a la vez, igual criterio que ya tenían los
 * ingredientes (ver docs/grounding-ficha-tecnica-tandoor.md, "Interacción
 * con el versionado append-only"). Todo llamador puntual (agregar/editar/
 * quitar UN ingrediente o paso) tiene que mandar los tres completos —
 * `agregarIngredienteAReceta` y las funciones de pasos/cabecera de abajo
 * hacen ese round-trip por vos.
 *
 * `versionEsperada` (H7, Pureza Fase 4): la versión de la receta sobre la que quien llama armó este reemplazo (`0` = todavía no había). Si la receta ya va por otra, alguien guardó en el medio y
 * esto pisaría su cambio: se rechaza con un mensaje. Las funciones puntuales de abajo (agregar/editar/quitar un ingrediente o un paso, la cabecera) piden `versionVista`: la versión que la PANTALLA
 * mostraba cuando la persona armó su cambio (no la que se lee al ejecutar, que ya sería la nueva).
 *
 * O.1 (Hito 4, paso H4C-23, autorizado por el dueño): la versión es OBLIGATORIA en esta acción pública (un entero ≥ 0; `undefined`, `null` u omitida se rechazan con
 * «La versión de la receta que se esperaba no es válida.» — `guardComandoGuardarVersionDeReceta` con `exigirVersion`). El reemplazo completo a ciegas (seeds,
 * scripts, tests) ya no es alcanzable desde la red: vive en `guardarRecetaACiegas` (`./receta-a-ciegas.ts`, `server-only` y SIN `"use server"`).
 *
 * Desde la Task #41 (P1, docs/arquitectura-casos-de-uso-2026-09-27.md) esta Server Action es un adaptador fino: permiso
 * (`conPermiso`) → formato (`guardComandoGuardarVersionDeReceta`) → caso de uso (`casos-de-uso/guardar-version-de-receta.ts`:
 * validación, versionado con reintento, transacción SERIALIZABLE, arrastre de calibraciones locales y auditoría) →
 * `aResultadoAccion`. El resto de las funciones de este archivo (agregar/editar/quitar ingrediente o paso, cabecera) siguen
 * delegando en `guardarReceta`, sin migrar: por eso el archivo NO está en `ACCIONES_CON_CASO_DE_USO`.
 */
export async function guardarReceta(
  productoId: string,
  items: IngredienteInput[],
  pasos: PasoInput[],
  cabecera: CabeceraRecetaInput,
  versionEsperada: number
): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("guardar_receta", async (ctx) => {
    // Desde la red puede llegar cualquier cosa: un `pasos`/`cabecera` ausente sigue valiendo «sin pasos» / «sin cabecera», como cuando tenían valor por defecto.
    const comando = guardComandoGuardarVersionDeReceta({ productoId, items, pasos: pasos ?? [], cabecera: cabecera ?? {}, versionEsperada }, { exigirVersion: true });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await guardarVersionDeRecetaCasoDeUso(ctx, comando.valor);
    // Sin esto la página no refleja el cambio en un navegador real hasta
    // recargar a mano (ver src/server/actions/refrescar.ts) — detectado
    // con Playwright, no con Vitest ni con los closures que ya hacían
    // `redirect(volver)` tras un `ok` (una navegación real ya refresca sola).
    if (resultado.ok) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}

/**
 * Equivalente de agregarIngredienteAReceta (Catalogo.js:1817-1843): NO hace
 * un guardado parcial — lee la receta vigente completa, rechaza si el
 * insumo ya está, arma la unión, y delega en guardarReceta (que genera la
 * próxima versión con TODOS los ingredientes juntos, más los pasos y la
 * cabecera vigentes sin tocar).
 */
export async function agregarIngredienteAReceta(productoId: string, ingrediente: IngredienteInput, versionVista: number): Promise<ResultadoAccion> {
  const vigente = await obtenerRecetaVigente(productoId);
  const existentes = mapIngredientesAInput(vigente);

  if (existentes.some((i) => i.insumoProductoId === ingrediente.insumoProductoId)) {
    return error("Ese insumo ya está en la receta.");
  }

  return guardarReceta(productoId, [...existentes, ingrediente], mapPasosAInput(vigente), mapCabeceraAInput(vigente), versionVista);
}

/**
 * Edita cantidad/unidad/merma de un ingrediente YA cargado, en un solo
 * paso — antes la única forma de corregir, por ejemplo, "ahora lleva 150g
 * de harina en vez de 100g" era Quitar (una versión) + Agregar de nuevo
 * (otra versión), dos pasos sueltos por un solo cambio real. Mismo
 * criterio que agregarIngredienteAReceta: lee la receta vigente completa,
 * reemplaza ese ingrediente puntual, y delega en guardarReceta.
 */
export async function actualizarIngredienteDeReceta(
  productoId: string,
  insumoProductoId: string,
  cambios: { cantidad: number; unidadId: string; mermaPorcentaje?: number; insumoSustitutoIds?: string[] },
  versionVista: number
): Promise<ResultadoAccion> {
  const vigente = await obtenerRecetaVigente(productoId);
  const existentes = mapIngredientesAInput(vigente);

  if (!existentes.some((i) => i.insumoProductoId === insumoProductoId)) {
    return error("Ese insumo no está en la receta vigente.");
  }

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

  return guardarReceta(productoId, items, mapPasosAInput(vigente), mapCabeceraAInput(vigente), versionVista);
}

/**
 * Quita un ingrediente de la receta vigente — reemplaza el armado inline
 * que antes vivía en la página (`page.tsx`), ahora centralizado para que
 * también se encargue de sacar ese insumo de cualquier paso que lo
 * mencionara (si no, `validarPasos` rechazaría la nueva versión por
 * referenciar un ingrediente que ya no está).
 */
export async function quitarIngredienteDeReceta(productoId: string, insumoProductoId: string, versionVista: number): Promise<ResultadoAccion> {
  const vigente = await obtenerRecetaVigente(productoId);
  const items = mapIngredientesAInput(vigente).filter((i) => i.insumoProductoId !== insumoProductoId);
  const pasos = mapPasosAInput(vigente).map((p) => ({
    ...p,
    insumoProductoIds: p.insumoProductoIds?.filter((id) => id !== insumoProductoId),
  }));

  return guardarReceta(productoId, items, pasos, mapCabeceraAInput(vigente), versionVista);
}

/** Agrega un paso nuevo — mismo criterio que agregarIngredienteAReceta, preserva ingredientes y cabecera vigentes. */
export async function agregarPasoAReceta(productoId: string, paso: PasoInput, versionVista: number): Promise<ResultadoAccion> {
  const vigente = await obtenerRecetaVigente(productoId);
  const pasosExistentes = mapPasosAInput(vigente);

  if (pasosExistentes.some((p) => p.orden === paso.orden)) {
    return error(`Ya hay un paso con el orden ${paso.orden}.`);
  }

  return guardarReceta(productoId, mapIngredientesAInput(vigente), [...pasosExistentes, paso], mapCabeceraAInput(vigente), versionVista);
}

/** Edita un paso ya cargado (identificado por su `orden` vigente) en un solo paso, mismo criterio que actualizarIngredienteDeReceta. */
export async function actualizarPasoDeReceta(
  productoId: string,
  orden: number,
  cambios: { nombre?: string; instruccion: string; minutos?: number; insumoProductoIds?: string[] },
  versionVista: number
): Promise<ResultadoAccion> {
  const vigente = await obtenerRecetaVigente(productoId);
  const pasosExistentes = mapPasosAInput(vigente);

  if (!pasosExistentes.some((p) => p.orden === orden)) {
    return error("Ese paso no está en la receta vigente.");
  }

  const pasos = pasosExistentes.map((p) => (p.orden === orden ? { orden, ...cambios } : p));
  return guardarReceta(productoId, mapIngredientesAInput(vigente), pasos, mapCabeceraAInput(vigente), versionVista);
}

/** Quita un paso de la receta vigente. */
export async function quitarPasoDeReceta(productoId: string, orden: number, versionVista: number): Promise<ResultadoAccion> {
  if (!Number.isInteger(orden)) return error("El número de paso no es válido.");
  const vigente = await obtenerRecetaVigente(productoId);
  const pasos = mapPasosAInput(vigente).filter((p) => p.orden !== orden);
  return guardarReceta(productoId, mapIngredientesAInput(vigente), pasos, mapCabeceraAInput(vigente), versionVista);
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
  const vigente = await obtenerRecetaVigente(productoId);
  const pasosExistentes = mapPasosAInput(vigente);
  const ordenesVigentes = pasosExistentes.map((p) => p.orden);

  if (!esPermutacionExacta(secuencia, ordenesVigentes)) {
    return error("La secuencia de pasos no es válida (faltan, sobran o se repiten pasos).");
  }
  if (secuencia.every((orden, i) => orden === ordenesVigentes[i])) {
    return ok("No hubo cambios en el orden.");
  }

  const pasos = aplicarSecuencia(pasosExistentes, secuencia);
  return guardarReceta(productoId, mapIngredientesAInput(vigente), pasos, mapCabeceraAInput(vigente), versionVista);
}

/**
 * Inserta un paso nuevo en una posición 1-indexada de la receta vigente
 * (corrida a [1, N+1]), corriendo los siguientes y renumerando — a
 * diferencia de `agregarPasoAReceta`, que solo agrega al final y rechaza un
 * `orden` duplicado (esa función queda intacta, es el camino "Al final").
 */
export async function insertarPasoEnReceta(productoId: string, posicion: number, paso: Omit<PasoInput, "orden">, versionVista: number): Promise<ResultadoAccion> {
  // `insertarEnPosicion` recorta una posición fuera de rango (0, 99), pero un NaN lo dejaría en silencio al principio.
  if (!Number.isInteger(posicion)) return error("La posición del paso no es válida.");
  const vigente = await obtenerRecetaVigente(productoId);
  const pasosExistentes = mapPasosAInput(vigente);

  const pasos = insertarEnPosicion(pasosExistentes, posicion, { ...paso, orden: -1 });
  return guardarReceta(productoId, mapIngredientesAInput(vigente), pasos, mapCabeceraAInput(vigente), versionVista);
}

/**
 * Actualiza solo la cabecera informativa (rendimiento/raciones/tiempos/
 * comentarios/etc.) — preserva ingredientes y pasos vigentes sin tocar.
 */
export async function actualizarCabeceraDeReceta(productoId: string, cabecera: CabeceraRecetaInput, versionVista: number): Promise<ResultadoAccion> {
  const vigente = await obtenerRecetaVigente(productoId);
  if (!vigente) return error('Todavía no hay ninguna receta — agregá al menos un ingrediente antes de completar esto.');

  return guardarReceta(productoId, mapIngredientesAInput(vigente), mapPasosAInput(vigente), cabecera, versionVista);
}
