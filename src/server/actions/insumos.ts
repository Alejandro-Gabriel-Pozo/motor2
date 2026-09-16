"use server";

import { prisma } from "@/lib/db";
import { texto, validarTextoCatalogo } from "@/core/texto";
import { creariaCiclo } from "@/core/catalogo/grupo";
import { validarFusionInsumos } from "@/core/catalogo/producto";
import { conPermiso } from "./con-permiso";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "./tipos";

export async function listarInsumos() {
  return prisma.insumo.findMany({ include: { grupo: true }, orderBy: { nombre: "asc" } });
}

export async function listarGrupos() {
  return prisma.grupo.findMany({ orderBy: { nombre: "asc" } });
}

/** Equivalente de crearFamiliaDesdePanel/crearFamilia_ (Catalogo.js:2939-2967): upsert case/espacio-insensible, reusa en silencio si ya existe. Devuelve el id — lo usa el quick-create inline del form de Producto. */
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
    return ok(`Insumo ${activo ? "activado" : "desactivado"}.`);
  });
}

export async function actualizarGrupoDeInsumo(insumoId: string, grupoId: string | null): Promise<ResultadoAccion> {
  return conPermiso("grupos_familia", async () => {
    await prisma.insumo.update({ where: { id: insumoId }, data: { grupoId } });
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

      await prisma.$transaction([
        prisma.producto.updateMany({ where: { insumoId }, data: { insumoId: existente.id } }),
        prisma.insumo.delete({ where: { id: insumoId } }),
      ]);
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
      return ok(`Grupo "${n}" actualizado.`);
    }

    // Un grupo recién creado nunca puede formar un ciclo consigo mismo
    // (su id todavía no existe), así que no hace falta validar acá.
    const creado = await prisma.grupo.create({ data: { nombre: n, grupoPadreId } });
    return ok(`Grupo "${creado.nombre}" creado.`);
  });
}

export async function actualizarActivoGrupo(grupoId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermiso("grupos_familia", async () => {
    await prisma.grupo.update({ where: { id: grupoId }, data: { activo } });
    return ok(`Grupo ${activo ? "activado" : "desactivado"}.`);
  });
}
