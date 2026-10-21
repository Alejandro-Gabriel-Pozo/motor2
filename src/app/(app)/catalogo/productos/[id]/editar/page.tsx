import { redirect } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { Aviso } from "@/ui/primitivas/aviso";
import { requierePermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { rutaDelPaso } from "@/core/catalogo/public";

/**
 * La ruta VIEJA de la edición de un producto (Fase 6, 6.13; DEC-12): el editor vive ahora en el paso 1 del espacio, `/catalogo/productos/[id]/datos`, para todos los tipos de producto. Esta página queda para que los
 * enlaces, los favoritos y las pestañas viejas sigan funcionando: pasa las MISMAS guardas de siempre (quien no puede editar recibe acá el mismo «No tenés permiso» y no se le revela nada) y recién después redirige (307),
 * sin leer el producto y sin condición por tipo. Un id que no existe llega a `/datos`, que da el 404.
 */
export default async function EditarProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <Aviso variante="error" forma="en-linea">{MENSAJE_DEMASIADAS_LECTURAS}</Aviso>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_ver_catalogo", ctx.db);
  if (!gate.ok) return <Aviso variante="error" forma="en-linea">{gate.mensaje}</Aviso>;
  const gateEditar = await requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_editar", ctx.db);
  if (!gateEditar.ok) return <Aviso variante="error" forma="en-linea">{gateEditar.mensaje}</Aviso>;

  const { id } = await params;
  redirect(rutaDelPaso(id, "datos"));
}
