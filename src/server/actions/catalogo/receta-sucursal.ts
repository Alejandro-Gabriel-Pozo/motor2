"use server";

import { INCLUDE_RECETA_COMPLETA, mapCabeceraAInput, mapIngredientesAInput, mapPasosAInput, type RecetaCompleta } from "@/core/catalogo/public-servidor";
import { ALCANCE_CENTRAL } from "@/core/catalogo/public";
import { cargarRecetaVigente } from "@/server/lecturas/catalogo/recetas-vigentes";
import { type IngredienteInput, type PasoInput } from "@/core/catalogo/public";
import { obtenerEstadoDeRecetaPropia } from "@/server/lecturas/catalogo/receta-propia";
import { guardComandoGuardarVersionDeReceta } from "@/core/features/catalogo/receta-version.guard";
import { guardComandoVolverALaRecetaCentral } from "@/core/features/catalogo/receta-sucursal.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { leerOrigenDeCopia } from "@/server/acceso/origen-de-copia";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { guardarVersionDeRecetaCasoDeUso, type DestinoDeVersionDeReceta } from "./casos-de-uso/guardar-version-de-receta";
import { volverALaRecetaCentralCasoDeUso } from "./casos-de-uso/volver-a-la-receta-central";

/**
 * Receta PROPIA de la sucursal activa (ADR-009, familia override, R3/R4): una serie de versiones de la receta de un producto que
 * pertenece a UNA sucursal y que, mientras está habilitada, es la receta que rige ahí (venta, consumo, costeo, reportes de esa sucursal) en
 * lugar de la central. Nunca recibe la sucursal por parámetro — siempre la de la sesión (`ctx.sucursalId`) — y cada acción tiene SU
 * permiso (una clave por acción): `receta_sucursal_editar`, `receta_sucursal_copiar`, `receta_sucursal_volver_central`.
 *
 * Nada de acá toca la receta central ni la aplica sola: la central sigue siendo de `guardar_receta` (`recetas.ts`), y cuando cambia solo se
 * AVISA («la central cambió», `obtenerEstadoDeRecetaPropia`). Volver a la central deshabilita la propia sin borrar nada: sus versiones quedan
 * como historial. Las calibraciones por sucursal (`RendimientoLocalIngrediente`) se conservan pero no rigen mientras haya receta propia.
 *
 * El editor de la propia cubre los ingredientes (agregar, editar, quitar); los pasos y la ficha técnica viajan tal cual estaban en la receta
 * de la que se partió.
 *
 * Las cinco que guardan una versión de la propia (crear, agregar, actualizar, quitar, copiar) piden, además de la versión que la pantalla mostraba
 * (`versionVista`, H7), si la mostraba HABILITADA (`habilitadaVista`, D.4, obligatorio en las cinco por decisión del dueño): volver a la central deshabilita la
 * propia sin crear una versión, y sin esto una pantalla vieja la volvía a habilitar con una versión armada sobre otra base. El caso de uso lo compara dentro
 * de su transacción.
 *
 * O.45 (cierre del Hito 4, mismo hueco que cerró O.1 en la central): la versión vista es OBLIGATORIA en las cinco. Antes `guardarEnLaPropia` llamaba al guard SIN
 * `exigirVersion`, así que una llamada armada a mano con `versionVista` `undefined`/`null` (u omitida) guardaba «a ciegas» sobre la serie propia, sin chequeo de
 * versión. Ahora cada una la valida con `versionVistaExigida` (el MISMO guard con `exigirVersion` y el MISMO texto que la acción pública `guardarReceta`: «La versión de
 * la receta que se esperaba no es válida.») DENTRO del envoltorio de permiso y ANTES de su primera lectura; la receta propia no tiene modo a ciegas (ningún seed,
 * script ni test lo usaba, así que no hay función interna como `guardarRecetaACiegas`).
 */

type OpcionesDeDestino = Omit<Extract<DestinoDeVersionDeReceta, { sucursalId: string }>, "sucursalId" | "habilitadaEsperada">;

/** Cuando `habilitadaVista` no es un booleano (una llamada armada a mano: la pantalla siempre lo manda). */
const MENSAJE_SIN_HABILITADA_VISTA = "No se pudo saber qué receta mostraba la pantalla. Recargá la pantalla y volvé a hacer el cambio.";

/**
 * O.45: la versión que mostraba la pantalla, EXIGIDA (un entero ≥ 0; `undefined`, `null`, omitida, negativa o no entera → el texto de versión inválida). Va antes de
 * cualquier lectura, así que también mira el `productoId` como el guard de siempre (uno que no es texto → «No se encontró el producto.», en lugar del error crudo de
 * Prisma que daba la primera lectura). Después `guardarEnLaPropia` recibe una versión ya validada.
 */
function versionVistaExigida(productoId: string, versionVista: number) {
  return guardComandoGuardarVersionDeReceta({ productoId, versionEsperada: versionVista }, { exigirVersion: true });
}

async function guardarEnLaPropia(
  ctx: ContextoUsuario,
  productoId: string,
  items: IngredienteInput[],
  base: RecetaCompleta,
  versionEsperada: number,
  habilitadaEsperada: boolean,
  opciones: OpcionesDeDestino & { pasos?: PasoInput[] } = {}
): Promise<ResultadoAccion> {
  const { pasos, ...destino } = opciones;
  const comando = guardComandoGuardarVersionDeReceta({ productoId, items, pasos: pasos ?? mapPasosAInput(base), cabecera: mapCabeceraAInput(base), versionEsperada });
  if (!comando.ok) return error(comando.mensaje);
  if (typeof habilitadaEsperada !== "boolean") return error(MENSAJE_SIN_HABILITADA_VISTA);
  const resultado = await guardarVersionDeRecetaCasoDeUso(ctx, comando.valor, { sucursalId: ctx.sucursalId, habilitadaEsperada, ...destino });
  if (resultado.ok) refrescarVistaSiHaceFalta();
  return aResultadoAccion(resultado);
}

/** Crea la receta propia de la sucursal partiendo de la central vigente (una copia que de acá en más se edita por su lado). */
export async function crearRecetaPropiaDesdeLaCentral(productoId: string, versionVista: number, habilitadaVista: boolean): Promise<ResultadoAccion> {
  return conPermiso("receta_sucursal_editar", async (ctx) => {
    const vista = versionVistaExigida(productoId, versionVista);
    if (!vista.ok) return error(vista.mensaje);
    const estado = await obtenerEstadoDeRecetaPropia(productoId, ctx.sucursalId, ctx.db);
    if (estado.habilitada) return error("Esta sucursal ya tiene receta propia para este producto.");
    const central = await cargarRecetaVigente(ctx.db, ALCANCE_CENTRAL, productoId, { include: INCLUDE_RECETA_COMPLETA });
    if (!central) return error("Este producto no tiene receta central de la que partir: agregá el primer ingrediente para armar la receta de la sucursal desde cero.");
    return guardarEnLaPropia(ctx, productoId, mapIngredientesAInput(central), central, versionVista, habilitadaVista, { basadaEnVersionId: central.id });
  });
}

/**
 * Agrega un ingrediente a la receta propia habilitada. Si la sucursal todavía no tiene una y el producto tampoco tiene receta central, la
 * crea desde cero con ese ingrediente; si hay central, hay que crear la propia desde ella primero (no se parte de una receta vacía por descuido).
 */
export async function agregarIngredienteARecetaPropia(productoId: string, ingrediente: IngredienteInput, versionVista: number, habilitadaVista: boolean): Promise<ResultadoAccion> {
  return conPermiso("receta_sucursal_editar", async (ctx) => {
    const vista = versionVistaExigida(productoId, versionVista);
    if (!vista.ok) return error(vista.mensaje);
    const estado = await obtenerEstadoDeRecetaPropia(productoId, ctx.sucursalId, ctx.db);
    if (!estado.habilitada && estado.centralVigente) return error("Primero creá la receta propia de la sucursal a partir de la central.");
    const base = estado.habilitada ? estado.propia : null;
    const existentes = mapIngredientesAInput(base);
    if (existentes.some((i) => i.insumoProductoId === ingrediente.insumoProductoId)) return error("Ese insumo ya está en la receta.");
    return guardarEnLaPropia(ctx, productoId, [...existentes, ingrediente], base, versionVista, habilitadaVista);
  });
}

/** Edita cantidad/unidad/merma de un ingrediente de la receta propia habilitada. */
export async function actualizarIngredienteDeRecetaPropia(
  productoId: string,
  insumoProductoId: string,
  cambios: { cantidad: number; unidadId: string; mermaPorcentaje?: number },
  versionVista: number,
  habilitadaVista: boolean
): Promise<ResultadoAccion> {
  return conPermiso("receta_sucursal_editar", async (ctx) => {
    const vista = versionVistaExigida(productoId, versionVista);
    if (!vista.ok) return error(vista.mensaje);
    const estado = await obtenerEstadoDeRecetaPropia(productoId, ctx.sucursalId, ctx.db);
    if (!estado.habilitada) return error("Esta sucursal no tiene receta propia para este producto.");
    const existentes = mapIngredientesAInput(estado.propia);
    if (!existentes.some((i) => i.insumoProductoId === insumoProductoId)) return error("Ese insumo no está en la receta propia vigente.");
    const items = existentes.map((i) => (i.insumoProductoId === insumoProductoId ? { ...i, cantidad: cambios.cantidad, unidadId: cambios.unidadId, mermaPorcentaje: cambios.mermaPorcentaje ?? 0 } : i));
    return guardarEnLaPropia(ctx, productoId, items, estado.propia, versionVista, habilitadaVista);
  });
}

/** Quita un ingrediente de la receta propia habilitada (y lo saca de los pasos que lo mencionaran, como en la central). */
export async function quitarIngredienteDeRecetaPropia(productoId: string, insumoProductoId: string, versionVista: number, habilitadaVista: boolean): Promise<ResultadoAccion> {
  return conPermiso("receta_sucursal_editar", async (ctx) => {
    const vista = versionVistaExigida(productoId, versionVista);
    if (!vista.ok) return error(vista.mensaje);
    const estado = await obtenerEstadoDeRecetaPropia(productoId, ctx.sucursalId, ctx.db);
    if (!estado.habilitada) return error("Esta sucursal no tiene receta propia para este producto.");
    const existentes = mapIngredientesAInput(estado.propia);
    const items = existentes.filter((i) => i.insumoProductoId !== insumoProductoId);
    if (items.length === existentes.length) return error("Ese insumo no está en la receta propia vigente.");
    // validarPasos rechaza un paso que referencie un ingrediente que ya no está: el round-trip de los pasos lo saca de ahí.
    const pasos = mapPasosAInput(estado.propia).map((p) => ({ ...p, insumoProductoIds: p.insumoProductoIds?.filter((id) => id !== insumoProductoId) }));
    return guardarEnLaPropia(ctx, productoId, items, estado.propia, versionVista, habilitadaVista, { pasos });
  });
}

/**
 * Copia la receta propia de OTRA sucursal a la de la activa (que queda habilitada con esa copia como versión nueva). Solo se copia de la receta
 * propia habilitada de otra sucursal — nunca de la central, que ya es la base de la propia — y pisa la propia que hubiera: por eso exige la
 * confirmación explícita. Conserva la versión central en la que se basaba el original, así el aviso «la central cambió» sigue siendo cierto.
 *
 * S-07 (O.56 de `docs/pureza-integracion.md`, nota de ADR-009): el origen exige membresía vigente y el «Ver» de `receta_sucursal_copiar` en ESA sucursal
 * (`leerOrigenDeCopia`), además de que esté activa. Antes se buscaba solo por id bajo la RLS de empresa y se copiaba desde una sucursal sin membresía.
 */
export async function copiarRecetaPropiaDeOtraSucursal(
  productoId: string,
  sucursalOrigenId: string,
  confirmado: boolean,
  versionVista: number,
  habilitadaVista: boolean
): Promise<ResultadoAccion> {
  return conPermiso("receta_sucursal_copiar", async (ctx) => {
    if (!confirmado) return error("Confirmá que querés reemplazar la receta de esta sucursal por la copia.");
    if (sucursalOrigenId === ctx.sucursalId) return error("Elegí otra sucursal: no se puede copiar de la misma.");
    // Después de las dos comprobaciones que no leen nada (su orden de mensajes no cambia) y antes de la primera lectura.
    const vista = versionVistaExigida(productoId, versionVista);
    if (!vista.ok) return error(vista.mensaje);
    // S-07 (O.56): el origen se lee SOLO con membresía y «Ver» de la copia allá, antes de mirar qué receta tiene (la RLS separa empresas, no sucursales).
    const origen = await leerOrigenDeCopia(ctx, sucursalOrigenId, "receta_sucursal_copiar");
    if (!origen.ok) return error(origen.mensaje);
    const estadoOrigen = await obtenerEstadoDeRecetaPropia(productoId, sucursalOrigenId, ctx.db);
    if (!estadoOrigen.habilitada || !estadoOrigen.propia) return error(`«${origen.nombre}» no tiene receta propia para este producto: no hay nada que copiar.`);
    return guardarEnLaPropia(ctx, productoId, mapIngredientesAInput(estadoOrigen.propia), estadoOrigen.propia, versionVista, habilitadaVista, {
      basadaEnVersionId: estadoOrigen.propia.basadaEnVersionId,
      copiadaDeSucursal: origen.nombre,
    });
  });
}

/**
 * Vuelve a la receta central: deshabilita la propia (sus versiones quedan como historial, no se borra nada). Pide confirmación explícita.
 *
 * Desde el Hito 4 de la pureza (bloque 4.2, paso H4C-6) es un adaptador fino: permiso (`conPermiso("receta_sucursal_volver_central")`) → la confirmación
 * (`guardComandoVolverALaRecetaCentral`, core/features/catalogo/receta-sucursal.guard.ts, DENTRO del envoltorio) → caso de uso
 * (`casos-de-uso/volver-a-la-receta-central.ts`: la transacción serializable, la propia habilitada, la escritura en server/persistencia/catalogo/receta-sucursal.ts,
 * la auditoría y el conflicto agotado) → refrescar la vista si salió bien (antes se refrescaba dentro del callback, en ese mismo camino) → `aResultadoAccion`.
 * Con esta, las seis acciones del archivo pasan por un caso de uso: está entero en `ACCIONES_CON_CASO_DE_USO`.
 */
export async function volverALaRecetaCentral(productoId: string, confirmado: boolean): Promise<ResultadoAccion> {
  return conPermiso("receta_sucursal_volver_central", async (ctx) => {
    const comando = guardComandoVolverALaRecetaCentral({ productoId, confirmado });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await volverALaRecetaCentralCasoDeUso(ctx, comando.valor);
    if (resultado.ok) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}
