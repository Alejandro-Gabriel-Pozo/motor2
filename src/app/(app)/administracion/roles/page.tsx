import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { MENSAJE_PERMISOS_DE_PLATAFORMA } from "@/core/permisos/politica-de-empresa";
import { politicaDeEmpresa } from "@/server/acceso/politica-de-empresa";
import { listarRoles } from "@/server/actions/permisos/roles";
import { RolesTabla } from "./roles-tabla";

export default async function RolesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "gestion_roles", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  if (!(await politicaDeEmpresa(ctx.empresaId, ctx.db)).permisosEditables) return <p role="status">{MENSAJE_PERMISOS_DE_PLATAFORMA}</p>;

  const roles = await listarRoles();
  const { editar: puedeRenombrar } = await obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "renombrar_rol", ctx.db);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Roles (catálogo único para todo el negocio)</h1>
      <RolesTabla rolesIniciales={roles} puedeRenombrar={puedeRenombrar} />
    </div>
  );
}
