import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarMatrizPermisos } from "@/server/actions/permisos";
import { PermisosMatriz } from "./permisos-matriz";

export default async function PermisosPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "gestion_permisos");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { acciones, roles, permisos } = await listarMatrizPermisos();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Matriz de permisos (acción × rol)</h1>
      <PermisosMatriz acciones={acciones} roles={roles} permisosIniciales={permisos} />
    </div>
  );
}
