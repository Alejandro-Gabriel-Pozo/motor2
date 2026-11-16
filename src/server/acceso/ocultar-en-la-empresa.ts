import "server-only";
import { esGerenteOAdministradorConAlcanceTotal } from "@/core/catalogo/public";
import { esGerenteDeEmpresa } from "@/core/permisos/rol-empresa";
import type { ContextoUsuario } from "@/server/sesion/contexto";

/**
 * ¿Puede quien llama ocultar o volver a mostrar un producto en TODA la empresa? (docs/diseno-ocultar-como-pedernal-2026-11-15.md, O-10 y O-13): gerente de la empresa o administrador, con membresía en TODAS las
 * sucursales activas (`esGerenteOAdministradorConAlcanceTotal`, la regla pura). Una sola lectura de las sucursales activas de la empresa (la tabla `Sucursal` es de la empresa, no depende del alcance por sucursal).
 * La usan la acción (que decide) y la página de la ficha (que solo decide si OFRECE la fila: cortesía de la interfaz, el servidor vuelve a decidir). Falla cerrado: sin sucursales activas, o con cualquier duda, `false`.
 */
export async function puedeOcultarEnLaEmpresa(ctx: Pick<ContextoUsuario, "empresaId" | "db" | "membresias" | "rolEmpresa">): Promise<boolean> {
  const activas = await ctx.db.sucursal.findMany({ where: { empresaId: ctx.empresaId, activo: true }, select: { id: true } });
  return esGerenteOAdministradorConAlcanceTotal(ctx.membresias, activas.map((s) => s.id), esGerenteDeEmpresa(ctx.rolEmpresa));
}
