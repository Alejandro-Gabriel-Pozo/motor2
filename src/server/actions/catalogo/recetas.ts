"use server";

import { prisma } from "@/lib/db";
import { texto } from "@/core/texto";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { conReintento, conTransaccionSerializable, esConflictoDeEscritura } from "@/core/movimientos/public-servidor";
import {
  esPermutacionExacta,
  aplicarSecuencia,
  insertarEnPosicion,
  describirCambioVersionReceta,
  describirDescarteArrastre,
} from "@/core/catalogo/public";
import {
  esErrorDeUnicidad,
  validarIngredientes,
  validarPasos,
  validarCabecera,
  type IngredienteInput,
  type PasoInput,
  type CabeceraRecetaInput,
} from "@/core/catalogo/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVer } from "../con-sesion";

const INCLUDE_RECETA_COMPLETA = {
  ingredientes: {
    include: { insumoProducto: true, unidad: true, sustitutos: { orderBy: { orden: "asc" as const }, include: { insumoSustituto: true } } },
  },
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

/**
 * Round-trip de la receta vigente a los inputs de guardarReceta — usado por cada acción puntual (agregar/editar/quitar UN
 * ingrediente o paso) para no pisar lo que no se está tocando. Copia `insumoSustitutoIds` (ya en su `orden` — la ida y vuelta
 * CRÍTICA de docs/plan-sustitucion-insumos-receta-2026-09-26.md §0.6/D1: sin esto, cualquier edición puntual que no toque el
 * ingrediente sustituido igual le borraría los sustitutos en la próxima versión).
 */
function mapIngredientesAInput(vigente: RecetaVigente): IngredienteInput[] {
  if (!vigente) return [];
  return vigente.ingredientes.map((i) => ({
    insumoProductoId: i.insumoProductoId,
    cantidad: Number(i.cantidad),
    unidadId: i.unidadId,
    mermaPorcentaje: Number(i.mermaPorcentaje),
    observaciones: i.observaciones ?? undefined,
    insumoSustitutoIds: i.sustitutos.map((s) => s.insumoSustitutoId),
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
 */
export async function guardarReceta(
  productoId: string,
  items: IngredienteInput[],
  pasos: PasoInput[] = [],
  cabecera: CabeceraRecetaInput = {}
): Promise<ResultadoAccion> {
  return conPermiso("guardar_receta", async (ctx) => {
    const producto = await prisma.producto.findUnique({ where: { id: productoId } });
    if (!producto) return error("No se encontró el producto.");

    const elegible = producto.tipo === "PV" || (producto.tipo === "MP" && producto.seProduce);
    if (!elegible) {
      return error(`"${producto.nombre}" no es elegible para tener receta — tiene que ser PV, o MP con "Se produce" activado.`);
    }

    const invalidoIngredientes = await validarIngredientes(items, producto);
    if (invalidoIngredientes) return error(invalidoIngredientes);

    const invalidoPasos = validarPasos(pasos, items);
    if (invalidoPasos) return error(invalidoPasos);

    const invalidoCabecera = await validarCabecera(cabecera);
    if (invalidoCabecera) return error(invalidoCabecera);

    // Reintento con backoff y jitter (mismo ciclo de siempre, core/movimientos/reintentar.ts): dos ediciones simultáneas de la
    // MISMA receta calculan la misma `version` y una choca con el UNIQUE (productoId, version) — se relee el máximo y se
    // reintenta. Desde D3 (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 6) la transacción pasa a
    // SERIALIZABLE (el arrastre de calibraciones locales lee/escribe `RendimientoLocalIngrediente`, que una calibración
    // concurrente también puede estar tocando): se reintenta tanto el choque de UNIQUE como un conflicto de escritura
    // (esErrorDeUnicidad(e) || esConflictoDeEscritura(e)).
    let version = 0;
    let descartes: string[] = [];
    await conReintento(
      async () => {
        descartes = [];
        // La versión anterior COMPLETA (con sus overrides locales) — D3: se arrastra a la versión nueva, salvo que el
        // ingrediente haya cambiado de unidad o haya salido de la receta.
        const ultima = await prisma.recetaVersion.findFirst({
          where: { productoId },
          orderBy: { version: "desc" },
          include: { ingredientes: { include: { rendimientosLocales: true, unidad: { select: { nombre: true } }, insumoProducto: { select: { nombre: true } } } } },
        });
        version = (ultima?.version ?? 0) + 1;
        await conTransaccionSerializable(async (tx) => {
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
                  sustitutos: it.insumoSustitutoIds?.length
                    ? { create: it.insumoSustitutoIds.map((insumoSustitutoId, i) => ({ insumoSustitutoId, orden: i + 1 })) }
                    : undefined,
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
            include: { ingredientes: { include: { unidad: { select: { nombre: true } } } }, pasos: true },
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

          // D3 — arrastre de calibraciones locales (RendimientoLocalIngrediente) de la versión vieja a la nueva, por
          // insumoProductoId. Si cambió la unidad, o el ingrediente salió de la receta, la calibración se DESCARTA
          // (nunca se arrastra "resucitada" con otra unidad) y se audita. Un cambio de cantidad/merma CENTRAL no
          // descarta nada — la calibración es de la sucursal, no del valor central.
          if (ultima) {
            const sucursalIds = new Set<string>();
            for (const viejoIng of ultima.ingredientes) for (const r of viejoIng.rendimientosLocales) sucursalIds.add(r.sucursalId);
            const sucursales = sucursalIds.size ? await tx.sucursal.findMany({ where: { id: { in: Array.from(sucursalIds) } }, select: { id: true, nombre: true } }) : [];
            const nombreSucursal = new Map(sucursales.map((s) => [s.id, s.nombre]));

            for (const viejoIng of ultima.ingredientes) {
              if (!viejoIng.rendimientosLocales.length) continue; // nada calibrado en ninguna sucursal: nada que arrastrar ni descartar.
              const nuevoIng = creada.ingredientes.find((i) => i.insumoProductoId === viejoIng.insumoProductoId);

              if (nuevoIng && nuevoIng.unidadId === viejoIng.unidadId) {
                await tx.rendimientoLocalIngrediente.createMany({
                  data: viejoIng.rendimientosLocales.map((r) => ({
                    recetaIngredienteId: nuevoIng.id,
                    sucursalId: r.sucursalId,
                    cantidad: r.cantidad,
                    mermaPorcentaje: r.mermaPorcentaje,
                  })),
                });
                continue;
              }

              const motivo = !nuevoIng ? "se quitó de la receta" : `cambió la unidad de ${viejoIng.unidad.nombre} a ${nuevoIng.unidad.nombre}`;
              for (const r of viejoIng.rendimientosLocales) {
                const sucNombre = nombreSucursal.get(r.sucursalId) ?? r.sucursalId;
                const entidadId = `${r.sucursalId}:${productoId}:${viejoIng.insumoProductoId}`;
                const descripcion = describirDescarteArrastre({ insumoNombre: viejoIng.insumoProducto.nombre, sucursalNombre: sucNombre, version, motivo });
                await registrarCambioAuditado(tx, {
                  entidad: "RendimientoLocalIngrediente", entidadId, campo: "cantidad", descripcion,
                  valorAnterior: r.cantidad !== null ? Number(r.cantidad) : null, valorNuevo: null,
                  actorId: ctx.usuarioId, sucursalId: r.sucursalId,
                });
                await registrarCambioAuditado(tx, {
                  entidad: "RendimientoLocalIngrediente", entidadId, campo: "mermaPorcentaje", descripcion,
                  valorAnterior: r.mermaPorcentaje !== null ? Number(r.mermaPorcentaje) : null, valorNuevo: null,
                  actorId: ctx.usuarioId, sucursalId: r.sucursalId,
                });
                descartes.push(`«${sucNombre}» para "${viejoIng.insumoProducto.nombre}" (${motivo})`);
              }
            }
          }

          // Auditoría (D6(b), docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 2): un registro por versión
          // nueva de la receta CENTRAL — sucursalId siempre null (Catálogo Central, no un dato por sucursal). El origen
          // es siempre manual: guardarReceta no recibe ningún parámetro `origen`.
          await registrarCambioAuditado(tx, {
            entidad: "RecetaVersion",
            entidadId: creada.id,
            campo: "version",
            descripcion: describirCambioVersionReceta(producto.nombre, ctx.sucursalNombre),
            valorAnterior: ultima ? ultima.version : null,
            valorNuevo: version,
            actorId: ctx.usuarioId,
            sucursalId: null,
          });
        });
      },
      { maxIntentos: 5, esReintentable: (e) => esErrorDeUnicidad(e) || esConflictoDeEscritura(e) }
    );
    // Sin esto la página no refleja el cambio en un navegador real hasta
    // recargar a mano (ver src/server/actions/refrescar.ts) — detectado
    // con Playwright, no con Vitest ni con los closures que ya hacían
    // `redirect(volver)` tras un `ok` (una navegación real ya refresca sola).
    refrescarVistaSiHaceFalta();
    const avisoDescartes = descartes.length ? ` Se descartó la calibración local de ${descartes.join(", ")}.` : "";
    return ok(`Receta de "${producto.nombre}" guardada como versión ${version}.${avisoDescartes}`);
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
  cambios: { cantidad: number; unidadId: string; mermaPorcentaje?: number; insumoSustitutoIds?: string[] }
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
