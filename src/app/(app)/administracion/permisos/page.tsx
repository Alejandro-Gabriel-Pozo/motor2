import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { MENSAJE_PERMISOS_DE_PLATAFORMA } from "@/core/permisos/politica-de-empresa";
import { politicaDeEmpresa } from "@/server/acceso/politica-de-empresa";
import { listarMatrizPermisos } from "@/server/actions/permisos/permisos";
import { PermisosMatriz } from "./permisos-matriz";

export default async function PermisosPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "gestion_permisos", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  if (!(await politicaDeEmpresa(ctx.empresaId, ctx.db)).permisosEditables) return <p role="status">{MENSAJE_PERMISOS_DE_PLATAFORMA}</p>;

  const { acciones, roles, permisos } = await listarMatrizPermisos();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Matriz de permisos (acción × rol)</h1>
      <PermisosMatriz acciones={acciones} roles={roles} permisosIniciales={permisos} />
    </div>
  );
}
