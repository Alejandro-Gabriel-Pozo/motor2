"use server";

import type { Prisma } from "@prisma/client";
import { validarValoresPortal } from "@/core/carta/portal";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";

/**
 * Apariencia del portal de sucursales de la empresa (ADR-006): colores, textos, imagen del mapa y tamaños de las tarjetas.
 * Escribe SOLO en `PortalCartaEmpresa` (lo fija test/arquitectura/carta-solo-lectura.test.ts). Gate: `carta`, como el resto del
 * admin de la carta. El portal público lee la fila en cada pedido (no usa caché), así que no hace falta revalidar nada.
 */

/**
 * Guarda los valores del portal (reemplaza TODO lo guardado por lo que llega: el formulario manda todas las claves). Valida con
 * `validarValoresPortal`: normaliza, ignora lo que no es del catálogo y, si hay errores, devuelve hasta 5 juntos sin escribir. Una
 * fila por empresa (`empresaId` único): `upsert`, así guardar dos veces es idempotente.
 */
export async function guardarPortalEmpresa(valores: Readonly<Record<string, unknown>>): Promise<ResultadoAccion> {
  return conPermiso("carta", async (ctx) => {
    const validados = validarValoresPortal(valores);
    if (!validados.ok) return error(validados.mensaje);

    const json = validados.valor as Prisma.InputJsonObject;
    await ctx.db.portalCartaEmpresa.upsert({
      where: { empresaId: ctx.empresaId },
      create: { valores: json },
      update: { valores: json },
      select: { id: true },
    });
    const cantidad = Object.keys(validados.valor).length;
    return ok(`Apariencia del portal guardada (${cantidad} ${cantidad === 1 ? "valor cargado" : "valores cargados"}; el resto usa el default). El portal la toma al recargarlo.`);
  });
}
