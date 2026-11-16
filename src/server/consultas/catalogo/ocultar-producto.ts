import "server-only";
import { reportarErrorUnaVez } from "@/lib/reportar-error";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { puedeOcultarEnLaEmpresa } from "@/server/acceso/ocultar-en-la-empresa";
import { marcasDeOcultarDelProducto } from "@/server/lecturas/catalogo/ocultamiento";

/**
 * Lo que la tarjeta «Ocultar» de la ficha necesita (docs/diseno-ocultar-como-pedernal-2026-11-15.md, etapa d): dónde está oculto el producto y a qué filas se les ofrece un botón. Todo es cortesía de la interfaz: el servidor
 * (`ocultarProducto`) decide cada pedido. La fila de la empresa pide, además del permiso de la sucursal, ser gerente o administrador con alcance total. FALLA CERRADO: si la lectura falla devuelve `null` (la tarjeta no se
 * muestra y la ficha sigue igual), con el error reportado (Sentry, una vez por arranque); nunca se asume «visible».
 */
export async function cargarLoQueMuestraOcultar(ctx: ContextoUsuario, productoId: string, puedeCambiarDisponibilidad: boolean) {
  try {
    const [marcas, puedeEnLaEmpresa] = await Promise.all([
      marcasDeOcultarDelProducto(ctx.db, productoId, ctx.sucursalId),
      puedeCambiarDisponibilidad ? puedeOcultarEnLaEmpresa(ctx) : Promise.resolve(false),
    ]);
    return { ocultoEnLaSucursal: marcas.local, ocultoEnLaEmpresa: marcas.empresa, puedeEnElLocal: puedeCambiarDisponibilidad, puedeEnLaEmpresa };
  } catch (e) {
    await reportarErrorUnaVez("ocultar-lectura-de-marcas", e, "ocultar-tarjeta"); // no se traga en silencio: queda en Sentry
    return null;
  }
}
