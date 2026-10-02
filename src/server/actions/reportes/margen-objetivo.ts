"use server";

import { validarFoodCostObjetivo } from "@/core/datos/food-cost-objetivo";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, ok, type ResultadoAccion } from "../tipos";

/**
 * Food cost objetivo (decisión del dueño, 2026-10-01): lo fija SOLO administración, para toda la empresa (`categoriaId` null) o para una categoría
 * (que gana sobre el de la empresa). Vacío borra el objetivo propio: la categoría vuelve al de la empresa y la empresa al de por defecto
 * (`FOOD_COST_OBJETIVO_PCT`). Gate: `margen_objetivo_editar` (empresa). Es lo que el reporte de Costos usa para «Food cost alto» y el precio sugerido.
 */
export async function guardarMargenObjetivo(categoriaId: string | null, porcentaje: number | string | null): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("margen_objetivo_editar", async (ctx) => {
    const validado = validarFoodCostObjetivo(porcentaje);
    if (!validado.ok) return error(validado.mensaje);
    const valor = validado.valor;

    let alcance = "la empresa";
    if (categoriaId !== null) {
      const categoria = await ctx.db.categoriaProducto.findUnique({ where: { id: categoriaId }, select: { nombre: true } });
      if (!categoria) return error("No se encontró la categoría.");
      alcance = `la categoría «${categoria.nombre}»`;
    }

    const existente = await ctx.db.margenObjetivo.findFirst({ where: { categoriaId } });
    const anterior = existente ? Number(existente.foodCostObjetivoPct) : null;
    if (valor === anterior) {
      return ok(valor === null ? `${capitalizar(alcance)} no tenía un food cost objetivo propio.` : `${capitalizar(alcance)} ya tenía ${valor} % de food cost objetivo.`);
    }

    await ctx.transaccion(async (tx) => {
      if (valor === null) {
        await tx.margenObjetivo.delete({ where: { id: existente!.id } });
      } else if (existente) {
        await tx.margenObjetivo.update({ where: { id: existente.id }, data: { foodCostObjetivoPct: valor } });
      } else {
        await tx.margenObjetivo.create({ data: { categoriaId, foodCostObjetivoPct: valor } });
      }
      await registrarCambioAuditado(tx, {
        entidad: "MargenObjetivo",
        entidadId: categoriaId ?? "empresa",
        campo: "foodCostObjetivoPct",
        descripcion: `Food cost objetivo de ${alcance}`,
        valorAnterior: anterior,
        valorNuevo: valor,
        actorId: ctx.usuarioId,
        sucursalId: null,
      });
    });
    refrescarVistaSiHaceFalta();
    return ok(valor === null ? `${capitalizar(alcance)} vuelve al objetivo que le corresponde por defecto.` : `Food cost objetivo de ${alcance}: ${valor} %.`);
  });
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
