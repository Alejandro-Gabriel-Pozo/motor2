"use server";

import { aResultadoAccion } from "@/core/resultado-caso";
import { MENSAJE_GENERICO } from "@/core/textos/texto-de";
import { azarDelProceso } from "@/lib/azar";
import { puedeOcultarEnLaEmpresa } from "@/server/acceso/ocultar-en-la-empresa";
import { revalidarCartasPublicas } from "../carta/revalidar";
import { conPermiso } from "../con-permiso";
import { type ResultadoAccion } from "../tipos";
import { ocultarProductoCasoDeUso } from "./casos-de-uso/ocultar-producto";

/**
 * «Ocultar» / «Volver a mostrar» un producto en la sucursal activa o en toda la empresa (docs/diseno-ocultar-como-pedernal-2026-11-15.md, etapa d; Pedernal A15). Fija un ESTADO (`oculto`), no alterna: un doble clic o un
 * reintento da el mismo resultado (la segunda llamada ve «ya estaba» y no escribe ni audita). Permiso (el servidor lo decide, nunca la pantalla): `producto_disponibilidad` EDITAR en la sucursal activa (`conPermiso`) y,
 * para `EMPRESA`, además gerente o administrador con membresía en todas las sucursales activas (`puedeOcultarEnLaEmpresa`); sin eso, el caso de uso rechaza sin tocar nada. La sucursal sale de la sesión, nunca de un
 * parámetro. El id de la marca lo genera el servidor (`azarDelProceso`). Lo que llega del navegador se valida acá (todo nace cerrado): cualquier cosa que no sea exactamente lo permitido se rechaza.
 * Los códigos del caso de uso son internos: a la persona le llega un texto del catálogo, nunca el código; el éxito no se muestra (la tarjeta se redibuja con el estado nuevo).
 */
export async function ocultarProducto(productoId: string, alcance: "LOCAL" | "EMPRESA", oculto: boolean): Promise<ResultadoAccion> {
  return conPermiso("producto_disponibilidad", async (ctx) => {
    if (typeof productoId !== "string" || productoId.length === 0 || (alcance !== "LOCAL" && alcance !== "EMPRESA") || typeof oculto !== "boolean") return { ok: false, mensaje: MENSAJE_GENERICO };
    const puedeEnLaEmpresa = alcance === "EMPRESA" ? await puedeOcultarEnLaEmpresa(ctx) : false;
    const resultado = await ocultarProductoCasoDeUso(ctx, { productoId, alcance, oculto, marcaId: azarDelProceso.uuid(), puedeEnLaEmpresa });
    if (resultado.ok) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}
