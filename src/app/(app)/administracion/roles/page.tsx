import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVerDeEmpresa } from "@/core/permisos/gate";
import { MENSAJE_PERMISOS_DE_PLATAFORMA, politicaDeEmpresa } from "@/core/permisos/politica-de-empresa";
import { listarRoles } from "@/server/actions/permisos/roles";
import { RolesTabla } from "./roles-tabla";

export default async function RolesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "gestion_roles", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  if (!(await politicaDeEmpresa(ctx.empresaId, ctx.db)).permisosEditables) return <p role="status">{MENSAJE_PERMISOS_DE_PLATAFORMA}</p>;

  const roles = await listarRoles();

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Roles (catálogo único para todo el negocio)</h1>
      <RolesTabla rolesIniciales={roles} />
    </div>
  );
}
