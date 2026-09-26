"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { texto, validarTextoCatalogo } from "@/core/texto";
import { creariaCiclo } from "@/core/catalogo/grupo";
import { validarFusionInsumos } from "@/core/catalogo/producto";
import { conPermiso } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirSesion } from "../con-sesion";

/**
 * D9 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): antes de borrar el Insumo `origenId` en una fusión, reapunta cada
 * `SustitutoRecetaIngrediente` que lo declaraba como sustituto hacia `destinoId` — la FK es RESTRICT, así que sin esto la fusión de
 * un Insumo usado como sustituto en alguna receta fallaba en vez de arrastrarlo (mismo criterio que ya aplica
 * `producto.updateMany` con `Producto.insumoId` unas líneas arriba). Por cada línea de receta afectada:
 * - si YA tenía un sustituto apuntando a `destinoId` (duplicado tras la fusión), se borra el del origen y se conserva el otro;
 * - si el destino termina siendo el mismo Insumo que el propio ingrediente principal de esa línea (redundante — D8 nunca lo
 *   permitiría al guardar), se borra;
 * - se renumera `orden` de lo que quede, sin huecos.
 */
async function reapuntarSustitutosDeInsumoFusionado(tx: Prisma.TransactionClient, origenId: string, destinoId: string): Promise<void> {
  const afectados = await tx.sustitutoRecetaIngrediente.findMany({
    where: { insumoSustitutoId: { in: [origenId, destinoId] } },
    include: { recetaIngrediente: { include: { insumoProducto: true } } },
  });
  const porIngrediente = new Map<string, typeof afectados>();
  for (const fila of afectados) {
    const lista = porIngrediente.get(fila.recetaIngredienteId) ?? [];
    lista.push(fila);
    porIngrediente.set(fila.recetaIngredienteId, lista);
  }

  for (const [, filas] of porIngrediente) {
    const principalInsumoId = filas[0].recetaIngrediente.insumoProducto.insumoId;
    // Como mucho una fila por (ingrediente, insumo) — el UNIQUE ya lo garantiza — así que hay a lo sumo una del origen y una del
    // destino. La del destino (si existía) sobrevive tal cual; si no, sobrevive la del origen, reapuntada.
    const delDestino = filas.find((f) => f.insumoSustitutoId === destinoId);
    const delOrigen = filas.find((f) => f.insumoSustitutoId === origenId);
    const sobrevive = delDestino ?? delOrigen;
    const aBorrar = filas.filter((f) => f.id !== sobrevive?.id);
    if (aBorrar.length) await tx.sustitutoRecetaIngrediente.deleteMany({ where: { id: { in: aBorrar.map((f) => f.id) } } });

    if (!sobrevive) continue;
    if (destinoId === principalInsumoId) {
      // Redundante: el destino de la fusión ES el Insumo del propio ingrediente principal — ya no tiene sentido como sustituto.
      await tx.sustitutoRecetaIngrediente.delete({ where: { id: sobrevive.id } });
      continue;
    }
    if (sobrevive.insumoSustitutoId !== destinoId) {
      await tx.sustitutoRecetaIngrediente.update({ where: { id: sobrevive.id }, data: { insumoSustitutoId: destinoId } });
    }
  }

  // Renumerar sin huecos — en orden ascendente para no chocar nunca con el UNIQUE (recetaIngredienteId, orden) a mitad de camino.
  for (const recetaIngredienteId of porIngrediente.keys()) {
    const restantes = await tx.sustitutoRecetaIngrediente.findMany({ where: { recetaIngredienteId }, orderBy: { orden: "asc" } });
    for (let i = 0; i < restantes.length; i++) {
      if (restantes[i].orden !== i + 1) await tx.sustitutoRecetaIngrediente.update({ where: { id: restantes[i].id }, data: { orden: i + 1 } });
    }
  }
}

export async function listarInsumos() {
  await requerirSesion();
  return prisma.insumo.findMany({ include: { grupo: true }, orderBy: { nombre: "asc" } });
}

export async function listarGrupos() {
  await requerirSesion();
  return prisma.grupo.findMany({ orderBy: { nombre: "asc" } });
}

/**
 * Equivalente de crearFamiliaDesdePanel/crearFamilia_ (Catalogo.js:2939-2967): upsert case/espacio-insensible, reusa en silencio si ya existe. Devuelve el id — lo usa el quick-create inline del form de Producto.
 *
 * NO pide el refresco de la vista: la llaman TRES flujos y a dos les sobraría — la pantalla de Insumos (closure "use server" de la página, que
 * sí lo pide ahí), el alta rápida inline del formulario de Producto (QuickCrear) y el AsistenteHermanar (un modal dentro de ese formulario).
 * Esos dos devuelven el insumo por callback y NO deben re-renderizar la ruta con el formulario a medio llenar (ver la regla en refrescar.ts).
 */
export async function crearInsumo(nombre: string): Promise<ResultadoConId> {
  return conPermiso<ResultadoConId>("alta_producto", async () => {
    const n = texto(nombre);
    if (!n) return error("El nombre del insumo no puede estar vacío.");
    const invalido = validarTextoCatalogo(n, "El nombre del insumo");
    if (invalido) return error(invalido);

    const existente = await prisma.insumo.findFirst({ where: { nombre: { equals: n, mode: "insensitive" } } });
    if (existente) return okConId(`Ya existía el insumo "${existente.nombre}" — se reusa.`, existente.id, existente.nombre);

    const creado = await prisma.insumo.create({ data: { nombre: n } });
    return okConId(`Insumo "${creado.nombre}" creado.`, creado.id, creado.nombre);
  });
}

export async function actualizarActivoInsumo(insumoId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermiso("grupos_familia", async () => {
    await prisma.insumo.update({ where: { id: insumoId }, data: { activo } });
    // Se llama desde un closure "use server" de la página de Insumos, sin redirigir: sin esto la columna «Activo» no cambia (ver refrescar.ts).
    refrescarVistaSiHaceFalta();
    return ok(`Insumo ${activo ? "activado" : "desactivado"}.`);
  });
}

export async function actualizarGrupoDeInsumo(insumoId: string, grupoId: string | null): Promise<ResultadoAccion> {
  return conPermiso("grupos_familia", async () => {
    await prisma.insumo.update({ where: { id: insumoId }, data: { grupoId } });
    refrescarVistaSiHaceFalta(); // ver actualizarActivoInsumo
    return ok("Grupo del insumo actualizado.");
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
  await requerirSesion();
  const nuevo = texto(nombreNuevo);
  if (!nuevo) return null;
  const existente = await prisma.insumo.findFirst({
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
 */
export async function renombrarOFusionarInsumo(
  insumoId: string,
  nombreNuevo: string,
  confirmarFusion = false
): Promise<ResultadoAccion> {
  return conPermiso("grupos_familia", async () => {
    const nuevo = texto(nombreNuevo);
    if (!nuevo) return error("El nombre nuevo no puede estar vacío.");
    const invalido = validarTextoCatalogo(nuevo, "El nombre del insumo");
    if (invalido) return error(invalido);

    const actual = await prisma.insumo.findUnique({ where: { id: insumoId } });
    if (!actual) return error("No se encontró el insumo.");

    const existente = await prisma.insumo.findFirst({
      where: { nombre: { equals: nuevo, mode: "insensitive" }, id: { not: insumoId } },
    });

    if (existente) {
      const chocaUnidad = await validarFusionInsumos(insumoId, existente.id);
      if (chocaUnidad) return error(chocaUnidad);

      if (!confirmarFusion) {
        return error(`Ya existe el insumo "${existente.nombre}" — hace falta confirmar la fusión antes de aplicarla.`);
      }

      await prisma.$transaction(async (tx) => {
        await tx.producto.updateMany({ where: { insumoId }, data: { insumoId: existente.id } });
        await reapuntarSustitutosDeInsumoFusionado(tx, insumoId, existente.id);
        // DESPUÉS de reapuntar los sustitutos (FK RESTRICT: docs/plan-sustitucion-insumos-receta-2026-09-26.md, D9) — sin esto, la
        // fusión de un Insumo usado como sustituto en alguna receta fallaba por la FK en vez de arrastrarlo como corresponde.
        await tx.insumo.delete({ where: { id: insumoId } });
      });
      return ok(`"${actual.nombre}" se fusionó con el insumo existente "${existente.nombre}".`);
    }

    await prisma.insumo.update({ where: { id: insumoId }, data: { nombre: nuevo } });
    return ok(`Insumo renombrado a "${nuevo}".`);
  });
}

/** Equivalente de crearOActualizarGrupo/actualizarGrupoPadre_ (Catalogo.js:2483-2519), con la misma validación de ciclo. */
export async function crearOActualizarGrupo(nombre: string, grupoPadreId: string | null): Promise<ResultadoAccion> {
  return conPermiso("grupos_familia", async () => {
    const n = texto(nombre);
    if (!n) return error("El nombre del grupo no puede estar vacío.");
    const invalido = validarTextoCatalogo(n, "El nombre del grupo");
    if (invalido) return error(invalido);

    const existente = await prisma.grupo.findFirst({ where: { nombre: { equals: n, mode: "insensitive" } } });

    if (existente) {
      if (grupoPadreId && (await creariaCiclo(existente.id, grupoPadreId))) {
        return error(`Ese padre ya desciende de "${n}", o es el mismo grupo — crearía un ciclo.`);
      }
      await prisma.grupo.update({ where: { id: existente.id }, data: { grupoPadreId } });
      // La «Cadena» de cada grupo se calcula en el servidor: sin refresco no cambia hasta recargar (ver actualizarActivoInsumo).
      refrescarVistaSiHaceFalta();
      return ok(`Grupo "${n}" actualizado.`);
    }

    // Un grupo recién creado nunca puede formar un ciclo consigo mismo
    // (su id todavía no existe), así que no hace falta validar acá.
    const creado = await prisma.grupo.create({ data: { nombre: n, grupoPadreId } });
    refrescarVistaSiHaceFalta(); // ver actualizarActivoInsumo
    return ok(`Grupo "${creado.nombre}" creado.`);
  });
}

export async function actualizarActivoGrupo(grupoId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermiso("grupos_familia", async () => {
    await prisma.grupo.update({ where: { id: grupoId }, data: { activo } });
    refrescarVistaSiHaceFalta(); // ver actualizarActivoInsumo
    return ok(`Grupo ${activo ? "activado" : "desactivado"}.`);
  });
}
