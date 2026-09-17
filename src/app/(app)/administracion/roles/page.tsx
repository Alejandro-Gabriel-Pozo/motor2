import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarRoles } from "@/server/actions/permisos/roles";
import { RolesTabla } from "./roles-tabla";

export default async function RolesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "gestion_permisos");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const roles = await listarRoles();

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Roles (catálogo único para todo el negocio)</h1>
      <RolesTabla rolesIniciales={roles} />
    </div>
  );
}
