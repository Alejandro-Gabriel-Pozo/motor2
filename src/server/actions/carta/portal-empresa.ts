"use server";

import { guardComandoGuardarPortalEmpresa } from "@/core/features/carta/portal-empresa.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { guardarPortalEmpresaCasoDeUso } from "./casos-de-uso/guardar-portal-empresa";/**
 * Apariencia del portal de sucursales de la empresa (ADR-006): colores, textos, imagen del mapa y tamaños de las tarjetas.
 * Escribe SOLO en `PortalCartaEmpresa` (lo fija test/arquitectura/carta-solo-lectura.test.ts). Gate: `carta_portal` (empresa), como el resto del
 * admin de la carta. El portal público lee la fila en cada pedido (no usa caché), así que no hace falta revalidar nada.
 *
 * Desde el Hito 5 de la pureza (bloque D, `docs/plan-hito-5-pureza.md` §6.1) la acción es un adaptador fino de su caso de uso
 * (`./casos-de-uso/guardar-portal-empresa.ts`; escritura en server/persistencia/carta/portal-empresa.ts; el formato en core/features/carta/portal-empresa.guard.ts):
 * el archivo entero está en `ACCIONES_CON_CASO_DE_USO`. NO revalida la carta pública, como antes.
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
    return aResultadoAccion(await guardarPortalEmpresaCasoDeUso(ctx, comando.valor));
  });
}
