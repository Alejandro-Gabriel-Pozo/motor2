import { Fragment } from "react";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { actualizarPermiso, listarMatrizPermisos } from "@/server/actions/permisos";
import type { AccionClave } from "@/core/permisos/acciones";

export default async function PermisosPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "gestion_permisos");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { acciones, roles, permisos } = await listarMatrizPermisos();
  const permisoDe = (rolId: string, accionClave: string) => permisos.find((p) => p.rolId === rolId && p.accionClave === accionClave);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Matriz de permisos (acción × rol)</h1>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2 pr-4">Acción</th>
              {roles.map((r) => (
                <th key={r.id} colSpan={2} className="pr-4 text-center">
                  {r.nombre}
                </th>
              ))}
            </tr>
            <tr className="border-b text-left text-neutral-400 text-xs">
              <th />
              {roles.map((r) => (
                <Fragment key={r.id}>
                  <th>Ver</th>
                  <th>Editar</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {acciones.map((a) => (
              <tr key={a.clave} className="border-b">
                <td className="py-2 pr-4">
                  <div className="font-medium">{a.clave}</div>
                  <div className="text-xs text-neutral-500">{a.descripcion}</div>
                </td>
                {roles.map((r) => {
                  const permiso = permisoDe(r.id, a.clave);
                  return (
                    <Fragment key={r.id}>
                      <td>
                        <form
                          action={async () => {
                            "use server";
                            await actualizarPermiso(r.id, a.clave as AccionClave, permiso?.puedeEditar ?? false, !(permiso?.puedeVer ?? false));
                          }}
                        >
                          <button type="submit">{permiso?.puedeVer ? "✅" : "⬜"}</button>
                        </form>
                      </td>
                      <td>
                        <form
                          action={async () => {
                            "use server";
                            await actualizarPermiso(r.id, a.clave as AccionClave, !(permiso?.puedeEditar ?? false), permiso?.puedeVer ?? false);
                          }}
                        >
                          <button type="submit">{permiso?.puedeEditar ? "✅" : "⬜"}</button>
                        </form>
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-500">
        Tocar &quot;Editar&quot; también prende &quot;Ver&quot; (Ver ⊇ Editar). &quot;gestion_permisos&quot;/&quot;gestion_usuarios&quot; siempre conservan Editar=✅ para admin.
      </p>
    </div>
  );
}
