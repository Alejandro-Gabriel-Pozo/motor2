import "server-only";
import type { PrismaClient } from "@prisma/client";
import { obtenerMiNivelPermisoDeEmpresa } from "@/server/acceso/gate";

/**
 * M.2: ¿puede quien llama cambiar el precio de venta, el factor de conversión y las unidades de un producto (y definir el factor de sus presentaciones de compra)? Es `producto_campos_sensibles` EDITAR: una clave de EMPRESA
 * (piso operario, semilla solo admin) que se SUMA a `producto_editar`, `alta_producto`, `producto_presentaciones` y `producto_sincronizar_precio_carta`, no las reemplaza.
 *
 * UNA SOLA FUENTE (M.2-A4): la calculan las Server Actions de `src/server/actions/catalogo/productos.ts` (con ella decide el servidor) y las páginas de alta y edición (con ella la pantalla dibuja campos editables o
 * en solo lectura). Antes cada una tenía su copia y podían divergir en silencio: la pantalla ofrecía lo que el servidor rechazaba. `test/arquitectura/pares-de-piso-equivalentes.test.ts` exige que ningún otro archivo
 * consulte esta clave.
 *
 * No es una Server Action ni lleva `"use server"`: una función exportada de un archivo `"use server"` es un endpoint. El resultado de la pantalla es cortesía de la interfaz; la barrera es la del servidor
 * (`SIN_PERMISO_CAMPOS_SENSIBLES` en cada caso de uso).
 */
export async function puedeEditarCamposSensiblesDelProducto(ctx: { usuarioId: string; empresaId: string; db: PrismaClient }): Promise<boolean> {
  return (await obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_campos_sensibles", ctx.db)).editar;
}
