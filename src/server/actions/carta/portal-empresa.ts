"use server";

import { guardComandoGuardarPortalEmpresa } from "@/core/features/carta/portal-empresa.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { revalidarCartasPublicas } from "./revalidar";
import { error, type ResultadoAccion } from "../tipos";
import { guardarPortalEmpresaCasoDeUso } from "./casos-de-uso/guardar-portal-empresa";/**
 * Apariencia del portal de sucursales de la empresa (ADR-006): colores, textos, imagen del mapa y tamaños de las tarjetas.
 * Escribe SOLO en `PortalCartaEmpresa` (lo fija test/arquitectura/carta-solo-lectura.test.ts). Gate: `carta_portal` (empresa), como el resto del
 * admin de la carta. El portal público lee la fila en cada pedido (no usa caché); la carta de cada sucursal sí se cachea y lleva el nombre público de la empresa en sus títulos, así que al guardar se invalida la de ESA empresa (`revalidarCartasPublicas`).
 *
 * Desde el Hito 5 de la pureza (bloque D, `docs/plan-hito-5-pureza.md` §6.1) la acción es un adaptador fino de su caso de uso
 * (`./casos-de-uso/guardar-portal-empresa.ts`; escritura en server/persistencia/carta/portal-empresa.ts; el formato en core/features/carta/portal-empresa.guard.ts):
 * el archivo entero está en `ACCIONES_CON_CASO_DE_USO`. Desde el PR 2 del nombre público revalida las cartas públicas de su empresa tras guardar.
 */

/**
 * Guarda los valores del portal (reemplaza TODO lo guardado por lo que llega: el formulario manda todas las claves). Permiso
 * (`conPermisoDeEmpresa("carta_portal")`) → formato (`guardComandoGuardarPortalEmpresa`, DENTRO del envoltorio: normaliza, ignora lo que no es del catálogo y, si hay
 * errores, devuelve hasta 5 juntos sin escribir) → caso de uso (`casos-de-uso/guardar-portal-empresa.ts`: `upsert` por `empresaId`, así guardar dos veces es
 * idempotente) → `aResultadoAccion`.
 */
export async function guardarPortalEmpresa(valores: Readonly<Record<string, unknown>>): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_portal", async (ctx) => {
    const comando = guardComandoGuardarPortalEmpresa(valores);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = aResultadoAccion(await guardarPortalEmpresaCasoDeUso(ctx, comando.valor));
    // El nombre público de la empresa sale en los títulos de la carta de CADA sucursal (ISR de 60 s con la etiqueta de la empresa): se invalida la de ESA empresa para que el cambio se vea ya.
    if (resultado.ok) revalidarCartasPublicas(ctx.empresaSlug);
    return resultado;
  });
}
