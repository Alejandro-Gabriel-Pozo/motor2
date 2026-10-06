import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/server/acceso/gate";
import { listarInvitacionesPendientes, listarUsuariosDeSucursal } from "@/server/actions/auth/usuarios";
import { listarSucursales } from "@/server/actions/auth/sucursales";
import { listarRolesActivos } from "@/server/consultas/permisos/roles";
import { UsuariosTabla } from "./usuarios-tabla";

export default async function UsuariosPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin(); // el layout ya redirige

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "gestion_usuarios", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  // La pantalla se abre con `gestion_usuarios`; activar o desactivar a alguien es otra acción y pide su propia clave.
  const [membresias, invitaciones, roles, sucursales, activar] = await Promise.all([
    listarUsuariosDeSucursal(ctx.sucursalId),
    listarInvitacionesPendientes(ctx.sucursalId),
    listarRolesActivos(ctx.db),
    listarSucursales(),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "activar_usuario_sucursal", ctx.db),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Usuarios — {ctx.sucursalNombre}</h1>
      <UsuariosTabla membresiasIniciales={membresias} invitaciones={invitaciones} roles={roles} sucursales={sucursales} sucursalActualId={ctx.sucursalId} puedeActivar={activar.editar} />
    </div>
  );
}
