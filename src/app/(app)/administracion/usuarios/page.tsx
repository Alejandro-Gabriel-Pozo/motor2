import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarUsuariosDeSucursal } from "@/server/actions/auth/usuarios";
import { listarSucursales } from "@/server/actions/auth/sucursales";
import { listarRolesActivos } from "@/server/consultas/permisos/roles";
import { UsuariosTabla } from "./usuarios-tabla";

export default async function UsuariosPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null; // el layout ya redirige

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "gestion_usuarios", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [membresias, roles, sucursales] = await Promise.all([
    listarUsuariosDeSucursal(ctx.sucursalId),
    listarRolesActivos(ctx.db),
    listarSucursales(),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Usuarios — {ctx.sucursalNombre}</h1>
      <UsuariosTabla membresiasIniciales={membresias} roles={roles} sucursales={sucursales} sucursalActualId={ctx.sucursalId} />
    </div>
  );
}
