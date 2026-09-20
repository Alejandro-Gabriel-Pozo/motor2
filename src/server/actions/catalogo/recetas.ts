"use server";

import { prisma } from "@/lib/db";
import { texto } from "@/core/texto";
import { esNumeroFinito } from "@/core/numero";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { esErrorDeUnicidad } from "@/core/catalogo/generar-codigo";
import { esPermutacionExacta, aplicarSecuencia, insertarEnPosicion } from "@/core/catalogo/pasos-receta";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVer } from "../con-sesion";

export interface IngredienteInput {
  insumoProductoId: string;
  cantidad: number;
  unidadId: string;
  mermaPorcentaje?: number;
  observaciones?: string;
}

/**
 * Un paso de preparación — grounded contra Tandoor (`Step`) y Fudo
 * (docs/grounding-ficha-tecnica-tandoor.md). `insumoProductoIds` referencia
 * por insumo (no por `RecetaIngrediente.id`, que todavía no existe al
 * momento de armar este input) — opcional, la mayoría de los pasos no lo
 * van a usar (§6 del documento: Fudo ni lo ofrece).
 */
export interface PasoInput {
  orden: number;
  nombre?: string;
  instruccion: string;
  minutos?: number;
  insumoProductoIds?: string[];
}

/** Cabecera informativa de la receta — todo opcional, ver docs/grounding-ficha-tecnica-tandoor.md §6. */
export interface CabeceraRecetaInput {
  rendimientoCantidad?: number;
  rendimientoUnidadId?: string;
  racionesCantidad?: number;
  racionTamano?: number;
  racionUnidadId?: string;
  tiempoPreparacionMinutos?: number;
  tiempoCoccionMinutos?: number;
  comentarios?: string;
  presentacionEmplatado?: string;
  notasAdicionales?: string;
  equipamientoNecesario?: string;
}

const INCLUDE_RECETA_COMPLETA = {
  ingredientes: { include: { insumoProducto: true, unidad: true } },
  pasos: { orderBy: { orden: "asc" as const }, include: { ingredientes: { include: { recetaIngrediente: { include: { insumoProducto: true } } } } } },
  rendimientoUnidad: true,
  racionUnidad: true,
};

/** Equivalente de construirMapaRecetas_ (Catalogo.js:1549-1596): vigente = MAX(version), siempre derivado. */
export async function obtenerRecetaVigente(productoId: string) {
  await requerirVer("guardar_receta");
  return prisma.recetaVersion.findFirst({
    where: { productoId },
    orderBy: { version: "desc" },
    include: INCLUDE_RECETA_COMPLETA,
  });
}

/**
 * Todas las versiones de una receta, más reciente primero — el
 * versionado ya era append-only (nunca se pisa ni se borra una versión
 * vieja), esto solo expone ese historial que hasta ahora quedaba
 * guardado pero invisible en la UI (que solo mostraba la vigente).
 */
export async function listarVersionesDeReceta(productoId: string) {
  await requerirVer("guardar_receta");
  return prisma.recetaVersion.findMany({
    where: { productoId },
    orderBy: { version: "desc" },
    include: INCLUDE_RECETA_COMPLETA,
  });
}

type RecetaVigente = Awaited<ReturnType<typeof obtenerRecetaVigente>>;

/** Round-trip de la receta vigente a los inputs de guardarReceta — usado por cada acción puntual (agregar/editar/quitar UN ingrediente o paso) para no pisar lo que no se está tocando. */
function mapIngredientesAInput(vigente: RecetaVigente): IngredienteInput[] {
  if (!vigente) return [];
  return vigente.ingredientes.map((i) => ({
    insumoProductoId: i.insumoProductoId,
    cantidad: Number(i.cantidad),
    unidadId: i.unidadId,
    mermaPorcentaje: Number(i.mermaPorcentaje),
    observaciones: i.observaciones ?? undefined,
  }));
}

function mapPasosAInput(vigente: RecetaVigente): PasoInput[] {
  if (!vigente) return [];
  return vigente.pasos.map((p) => ({
    orden: p.orden,
    nombre: p.nombre ?? undefined,
    instruccion: p.instruccion,
    minutos: p.minutos ?? undefined,
    insumoProductoIds: p.ingredientes.map((pi) => pi.recetaIngrediente.insumoProductoId),
  }));
}

function mapCabeceraAInput(vigente: RecetaVigente): CabeceraRecetaInput {
  if (!vigente) return {};
  return {
    rendimientoCantidad: vigente.rendimientoCantidad ? Number(vigente.rendimientoCantidad) : undefined,
    rendimientoUnidadId: vigente.rendimientoUnidadId ?? undefined,
    racionesCantidad: vigente.racionesCantidad ?? undefined,
    racionTamano: vigente.racionTamano ? Number(vigente.racionTamano) : undefined,
    racionUnidadId: vigente.racionUnidadId ?? undefined,
    tiempoPreparacionMinutos: vigente.tiempoPreparacionMinutos ?? undefined,
    tiempoCoccionMinutos: vigente.tiempoCoccionMinutos ?? undefined,
    comentarios: vigente.comentarios ?? undefined,
    presentacionEmplatado: vigente.presentacionEmplatado ?? undefined,
    notasAdicionales: vigente.notasAdicionales ?? undefined,
    equipamientoNecesario: vigente.equipamientoNecesario ?? undefined,
  };
}

async function validarIngredientes(items: IngredienteInput[]) {
  if (!items.length) return "La receta necesita al menos un ingrediente.";
  for (const item of items) {
    if (!(Number(item.cantidad) > 0)) return "Cada ingrediente necesita una cantidad mayor a 0.";
    if (!esNumeroFinito(item.cantidad)) return "Cada ingrediente necesita una cantidad válida.";
    if (Number(item.mermaPorcentaje ?? 0) < 0) return "La merma no puede ser negativa.";
    if (!esNumeroFinito(item.mermaPorcentaje ?? 0)) return "La merma no es un número válido.";
    const mp = await prisma.producto.findUnique({ where: { id: item.insumoProductoId } });
    if (!mp || mp.tipo !== "MP" || !mp.activo) {
      return `Cada ingrediente tiene que ser una materia prima (MP) activa (${mp?.nombre ?? item.insumoProductoId} no lo es).`;
    }
  }
  return null;
}

function validarPasos(pasos: PasoInput[], items: IngredienteInput[]): string | null {
  const insumoIdsValidos = new Set(items.map((i) => i.insumoProductoId));
  const ordenesVistos = new Set<number>();
  for (const p of pasos) {
    if (!texto(p.instruccion)) return "Cada paso necesita una instrucción.";
    if (!(Number(p.orden) > 0)) return "Cada paso necesita un orden mayor a 0.";
    if (ordenesVistos.has(p.orden)) return `Hay dos pasos con el mismo orden (${p.orden}).`;
    ordenesVistos.add(p.orden);
    if (p.minutos !== undefined && Number(p.minutos) < 0) return "Los minutos de un paso no pueden ser negativos.";
    if (p.minutos !== undefined && !esNumeroFinito(p.minutos)) return "Los minutos de un paso no son un número válido.";
    for (const insumoProductoId of p.insumoProductoIds ?? []) {
      if (!insumoIdsValidos.has(insumoProductoId)) return "Un paso no puede marcar un ingrediente que no está en esta misma receta.";
    }
  }
  return null;
}

/**
 * Equivalente de guardarReceta (Catalogo.js:1711-1779): versionado
 * append-only real — NUNCA pisa ni borra una versión vieja. `version` se
 * calcula de forma optimista (MAX(version)+1); el
 * `@@unique([productoId, version])` es el árbitro final ante dos
 * ediciones simultáneas de la misma receta (se reintenta el cálculo).
 *
 * `pasos`/`cabecera` viajan en la MISMA versión que `items` — reemplazo
 * completo de los tres a la vez, igual criterio que ya tenían los
 * ingredientes (ver docs/grounding-ficha-tecnica-tandoor.md, "Interacción
 * con el versionado append-only"). Todo llamador puntual (agregar/editar/
 * quitar UN ingrediente o paso) tiene que mandar los tres completos —
 * `agregarIngredienteAReceta` y las funciones de pasos/cabecera de abajo
 * hacen ese round-trip por vos.
 */
export async function guardarReceta(
  productoId: string,
  items: IngredienteInput[],
  pasos: PasoInput[] = [],
  cabecera: CabeceraRecetaInput = {}
): Promise<ResultadoAccion> {
  return conPermiso("guardar_receta", async () => {
    const producto = await prisma.producto.findUnique({ where: { id: productoId } });
    if (!producto) return error("No se encontró el producto.");

    const elegible = producto.tipo === "PV" || (producto.tipo === "MP" && producto.seProduce);
    if (!elegible) {
      return error(`"${producto.nombre}" no es elegible para tener receta — tiene que ser PV, o MP con "Se produce" activado.`);
    }

    const invalidoIngredientes = await validarIngredientes(items);
    if (invalidoIngredientes) return error(invalidoIngredientes);

    const invalidoPasos = validarPasos(pasos, items);
    if (invalidoPasos) return error(invalidoPasos);

    const maxIntentos = 5;
    for (let intento = 0; intento < maxIntentos; intento++) {
      const ultima = await prisma.recetaVersion.findFirst({ where: { productoId }, orderBy: { version: "desc" } });
      const version = (ultima?.version ?? 0) + 1;
      try {
        await prisma.$transaction(async (tx) => {
          const creada = await tx.recetaVersion.create({
            data: {
              productoId,
              version,
              rendimientoCantidad: cabecera.rendimientoCantidad,
              rendimientoUnidadId: cabecera.rendimientoUnidadId || null,
              racionesCantidad: cabecera.racionesCantidad,
              racionTamano: cabecera.racionTamano,
              racionUnidadId: cabecera.racionUnidadId || null,
              tiempoPreparacionMinutos: cabecera.tiempoPreparacionMinutos,
              tiempoCoccionMinutos: cabecera.tiempoCoccionMinutos,
              comentarios: texto(cabecera.comentarios ?? "") || null,
              presentacionEmplatado: texto(cabecera.presentacionEmplatado ?? "") || null,
              notasAdicionales: texto(cabecera.notasAdicionales ?? "") || null,
              equipamientoNecesario: texto(cabecera.equipamientoNecesario ?? "") || null,
              ingredientes: {
                create: items.map((it) => ({
                  insumoProductoId: it.insumoProductoId,
                  cantidad: it.cantidad,
                  unidadId: it.unidadId,
                  mermaPorcentaje: it.mermaPorcentaje ?? 0,
                  observaciones: it.observaciones,
                })),
              },
              pasos: {
                create: pasos.map((p) => ({
                  orden: p.orden,
                  nombre: texto(p.nombre ?? "") || null,
                  instruccion: p.instruccion,
                  minutos: p.minutos,
                })),
              },
            },
            include: { ingredientes: true, pasos: true },
          });

          // Los pasos ya existen (con id real), y también los ingredientes
          // — recién ahora se puede armar la tabla puente paso↔ingrediente
          // (no se puede anidar en el create de arriba: no hay ningún id
          // real todavía en el momento de armar ese payload).
          for (const pasoInput of pasos) {
            if (!pasoInput.insumoProductoIds?.length) continue;
            const pasoCreado = creada.pasos.find((p) => p.orden === pasoInput.orden);
            if (!pasoCreado) continue;
            for (const insumoProductoId of pasoInput.insumoProductoIds) {
              const ingredienteCreado = creada.ingredientes.find((i) => i.insumoProductoId === insumoProductoId);
              if (!ingredienteCreado) continue;
              await tx.recetaPasoIngrediente.create({
                data: { recetaPasoId: pasoCreado.id, recetaIngredienteId: ingredienteCreado.id },
              });
            }
          }
        }, { maxWait: 5_000, timeout: 15_000 });
        // Sin esto la página no refleja el cambio en un navegador real hasta
        // recargar a mano (ver src/server/actions/refrescar.ts) — detectado
        // con Playwright, no con Vitest ni con los closures que ya hacían
        // `redirect(volver)` tras un `ok` (una navegación real ya refresca sola).
        refrescarVistaSiHaceFalta();
        return ok(`Receta de "${producto.nombre}" guardada como versión ${version}.`);
      } catch (e) {
        if (esErrorDeUnicidad(e) && intento < maxIntentos - 1) continue;
        throw e;
      }
    }
    return error("No se pudo guardar la receta tras varios intentos (choque de versión concurrente).");
  });
}

/**
 * Equivalente de agregarIngredienteAReceta (Catalogo.js:1817-1843): NO hace
 * un guardado parcial — lee la receta vigente completa, rechaza si el
 * insumo ya está, arma la unión, y delega en guardarReceta (que genera la
 * próxima versión con TODOS los ingredientes juntos, más los pasos y la
 * cabecera vigentes sin tocar).
 */
export async function agregarIngredienteAReceta(productoId: string, ingrediente: IngredienteInput): Promise<ResultadoAccion> {
  const vigente = await obtenerRecetaVigente(productoId);
  const existentes = mapIngredientesAInput(vigente);

  if (existentes.some((i) => i.insumoProductoId === ingrediente.insumoProductoId)) {
    return error("Ese insumo ya está en la receta.");
  }

  return guardarReceta(productoId, [...existentes, ingrediente], mapPasosAInput(vigente), mapCabeceraAInput(vigente));
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
  cambios: { cantidad: number; unidadId: string; mermaPorcentaje?: number }
): Promise<ResultadoAccion> {
  const vigente = await obtenerRecetaVigente(productoId);
  const existentes = mapIngredientesAInput(vigente);

  if (!existentes.some((i) => i.insumoProductoId === insumoProductoId)) {
    return error("Ese insumo no está en la receta vigente.");
  }

  const items = existentes.map((i) =>
    i.insumoProductoId === insumoProductoId
      ? { insumoProductoId, cantidad: cambios.cantidad, unidadId: cambios.unidadId, mermaPorcentaje: cambios.mermaPorcentaje ?? 0, observaciones: i.observaciones }
      : i
  );

  return guardarReceta(productoId, items, mapPasosAInput(vigente), mapCabeceraAInput(vigente));
}

/**
 * Quita un ingrediente de la receta vigente — reemplaza el armado inline
 * que antes vivía en la página (`page.tsx`), ahora centralizado para que
 * también se encargue de sacar ese insumo de cualquier paso que lo
 * mencionara (si no, `validarPasos` rechazaría la nueva versión por
 * referenciar un ingrediente que ya no está).
 */
export async function quitarIngredienteDeReceta(productoId: string, insumoProductoId: string): Promise<ResultadoAccion> {
  const vigente = await obtenerRecetaVigente(productoId);
  const items = mapIngredientesAInput(vigente).filter((i) => i.insumoProductoId !== insumoProductoId);
  const pasos = mapPasosAInput(vigente).map((p) => ({
    ...p,
    insumoProductoIds: p.insumoProductoIds?.filter((id) => id !== insumoProductoId),
  }));

  return guardarReceta(productoId, items, pasos, mapCabeceraAInput(vigente));
}

/** Agrega un paso nuevo — mismo criterio que agregarIngredienteAReceta, preserva ingredientes y cabecera vigentes. */
export async function agregarPasoAReceta(productoId: string, paso: PasoInput): Promise<ResultadoAccion> {
  const vigente = await obtenerRecetaVigente(productoId);
  const pasosExistentes = mapPasosAInput(vigente);

  if (pasosExistentes.some((p) => p.orden === paso.orden)) {
    return error(`Ya hay un paso con el orden ${paso.orden}.`);
  }

  return guardarReceta(productoId, mapIngredientesAInput(vigente), [...pasosExistentes, paso], mapCabeceraAInput(vigente));
}

/** Edita un paso ya cargado (identificado por su `orden` vigente) en un solo paso, mismo criterio que actualizarIngredienteDeReceta. */
export async function actualizarPasoDeReceta(
  productoId: string,
  orden: number,
  cambios: { nombre?: string; instruccion: string; minutos?: number; insumoProductoIds?: string[] }
): Promise<ResultadoAccion> {
  const vigente = await obtenerRecetaVigente(productoId);
  const pasosExistentes = mapPasosAInput(vigente);

  if (!pasosExistentes.some((p) => p.orden === orden)) {
    return error("Ese paso no está en la receta vigente.");
  }

  const pasos = pasosExistentes.map((p) => (p.orden === orden ? { orden, ...cambios } : p));
  return guardarReceta(productoId, mapIngredientesAInput(vigente), pasos, mapCabeceraAInput(vigente));
}

/** Quita un paso de la receta vigente. */
export async function quitarPasoDeReceta(productoId: string, orden: number): Promise<ResultadoAccion> {
  const vigente = await obtenerRecetaVigente(productoId);
  const pasos = mapPasosAInput(vigente).filter((p) => p.orden !== orden);
  return guardarReceta(productoId, mapIngredientesAInput(vigente), pasos, mapCabeceraAInput(vigente));
}

/**
 * Reordena los pasos de la receta vigente según `secuencia` (los `orden`
 * vigentes, en el orden nuevo deseado — no dos updates sueltos: `validarPasos`
 * rechaza dos pasos con el mismo `orden` en el mismo payload, así que un
 * reordenamiento tiene que mandar la permutación completa de una vez). Si la
 * secuencia resultante es idéntica a la vigente no se guarda nada (no
 * ensucia el historial con una versión sin cambios).
 */
export async function reordenarPasosDeReceta(productoId: string, secuencia: number[]): Promise<ResultadoAccion> {
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
  return guardarReceta(productoId, mapIngredientesAInput(vigente), pasos, mapCabeceraAInput(vigente));
}

/**
 * Inserta un paso nuevo en una posición 1-indexada de la receta vigente
 * (corrida a [1, N+1]), corriendo los siguientes y renumerando — a
 * diferencia de `agregarPasoAReceta`, que solo agrega al final y rechaza un
 * `orden` duplicado (esa función queda intacta, es el camino "Al final").
 */
export async function insertarPasoEnReceta(productoId: string, posicion: number, paso: Omit<PasoInput, "orden">): Promise<ResultadoAccion> {
  const vigente = await obtenerRecetaVigente(productoId);
  const pasosExistentes = mapPasosAInput(vigente);

  const pasos = insertarEnPosicion(pasosExistentes, posicion, { ...paso, orden: -1 });
  return guardarReceta(productoId, mapIngredientesAInput(vigente), pasos, mapCabeceraAInput(vigente));
}

/**
 * Actualiza solo la cabecera informativa (rendimiento/raciones/tiempos/
 * comentarios/etc.) — preserva ingredientes y pasos vigentes sin tocar.
 */
export async function actualizarCabeceraDeReceta(productoId: string, cabecera: CabeceraRecetaInput): Promise<ResultadoAccion> {
  const vigente = await obtenerRecetaVigente(productoId);
  if (!vigente) return error('Todavía no hay ninguna receta — agregá al menos un ingrediente antes de completar esto.');

  return guardarReceta(productoId, mapIngredientesAInput(vigente), mapPasosAInput(vigente), cabecera);
}
