"use server";

import { generarCodigoDePortal } from "@/core/carta/public";
import { guardComandoGuardarPortalDeEmpresa } from "@/core/features/carta/portal-de-empresa.guard";
import { guardComandoGuardarColoresDelPortal } from "@/core/features/carta/portal-colores.guard";
import { guardComandoGuardarPortalEmpresa } from "@/core/features/carta/portal-empresa.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { azarDelProceso } from "@/lib/azar";
import { COOKIE_PORTAL_SIMPLE_PRUEBA, portalSimpleVisible } from "@/lib/portal-simple-visible";
import { cookies } from "next/headers";
import { conPermisoDeEmpresa } from "../con-permiso";
import { revalidarCartasPublicas } from "./revalidar";
import { error, type ResultadoAccion } from "../tipos";
import { guardarColoresDelPortalCasoDeUso } from "./casos-de-uso/guardar-colores-del-portal";
import { guardarPortalDeEmpresaCasoDeUso } from "./casos-de-uso/guardar-portal-de-empresa";
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

/**
 * «Guardar el portal de la empresa» como Pedernal (PR-A del portal; docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md §7): variante A/B, textos, colores, imagen de fondo, logo visible, tarjetas y zonas, en UNA transacción SERIALIZABLE con auditoría y con la
 * versión que vio la pantalla (`versionEsperada`; sin ella es un alta). Convive con `guardarPortalEmpresa` (el Json de siempre): la lectura pública usa el portal nuevo solo si la empresa ya tiene el suyo (lectura dual). La empresa sale del contexto del servidor, nunca del pedido.
 * Permiso (`conPermisoDeEmpresa("carta_portal")`: gerente y administrador) → formato (`guardComandoGuardarPortalDeEmpresa`, DENTRO del envoltorio) → caso de uso (`casos-de-uso/guardar-portal-de-empresa.ts`) → `aResultadoAccion`. El id del portal, el código del QR (128 bits de azar) y los ids de
 * las zonas nuevas los genera el SERVIDOR, acá en el borde (un reintento no puede crear dos portales: la base tiene un único por empresa). No revalida las cartas públicas: el portal se lee en cada pedido, sin caché.
 */
export async function guardarPortalDeEmpresa(entrada: unknown): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_portal", async (ctx) => {
    const pedido = guardComandoGuardarPortalDeEmpresa(entrada);
    if (!pedido.ok) return error(pedido.mensaje);
    const zonas = pedido.valor.zonas.map((z) => ({ ...z, id: azarDelProceso.uuid() }));
    return aResultadoAccion(await guardarPortalDeEmpresaCasoDeUso(ctx, { ...pedido.valor, zonas, portalId: azarDelProceso.uuid(), codigoNuevo: generarCodigoDePortal(azarDelProceso) }));
  });
}

/** El texto cuando el interruptor está apagado (el servidor rechaza aunque el pedido se arme a mano: todo nace cerrado). */
const MENSAJE_PORTAL_SIMPLE_APAGADO = "La pantalla simple de los colores del portal todavía no está disponible.";

/**
 * Guarda la pantalla SIMPLE del portal (colores como Pedernal: tres fondos, línea superior, título, logo e imagen; decisión del dueño 2026-11-17: «Sí, los tres fondos elegibles.»). MEZCLA: no toca la variante, las tarjetas, las zonas ni el código del QR. Permiso
 * (`conPermisoDeEmpresa("carta_portal")`: gerente y administrador) → interruptor (`portalSimpleVisible`: apagado, el servidor rechaza) → formato (`guardComandoGuardarColoresDelPortal`, DENTRO del envoltorio; un color que no se lee NO se rechaza: se ajusta al mostrar) → caso de uso
 * (`casos-de-uso/guardar-colores-del-portal.ts`: SERIALIZABLE, con `versionEsperada`; si la empresa no tiene portal nuevo lo crea sembrando sus tarjetas desde lo ya cargado, para que el portal se vea igual) → `aResultadoAccion`. El id y el código del QR los genera el SERVIDOR acá en el borde.
 * No revalida las cartas públicas: el portal se lee en cada pedido, sin caché.
 */
export async function guardarColoresDelPortal(entrada: unknown): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_portal", async (ctx) => {
    if (!portalSimpleVisible((await cookies()).get(COOKIE_PORTAL_SIMPLE_PRUEBA)?.value)) return error(MENSAJE_PORTAL_SIMPLE_APAGADO);
    const pedido = guardComandoGuardarColoresDelPortal(entrada);
    if (!pedido.ok) return error(pedido.mensaje);
    return aResultadoAccion(await guardarColoresDelPortalCasoDeUso(ctx, { ...pedido.valor, portalId: azarDelProceso.uuid(), codigoNuevo: generarCodigoDePortal(azarDelProceso) }));
  });
}
