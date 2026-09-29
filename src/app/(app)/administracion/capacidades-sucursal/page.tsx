import { Fragment } from "react";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { actualizarCapacidad, listarCapacidades } from "@/server/actions/permisos/capacidades-sucursal";
import type { AccionClave } from "@/core/permisos/acciones";
import { AvisosDeAccion, FormConAviso } from "@/components/avisos-de-accion";

export default async function CapacidadesSucursalPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "capacidades_sucursal", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { acciones, sucursales, capacidades } = await listarCapacidades();
  const capacidadDe = (accionClave: string, sucursalId: string | null) =>
    capacidades.find((c) => c.accionClave === accionClave && c.sucursalId === sucursalId);

  return (
    <AvisosDeAccion className="space-y-4">
      <h1 className="text-xl font-semibold">Capacidades por sucursal (matriz de la Central)</h1>
      <p className="text-xs text-neutral-500">
        Columna &quot;Default&quot; = comportamiento para cualquier sucursal sin fila propia. Sin ninguna fila, la acción está habilitada.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2 pr-4">Acción</th>
              <th className="pr-4">Default</th>
              {sucursales.map((s) => (
                <th key={s.id} className="pr-4">
                  {s.nombre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {acciones.map((a) => (
              <tr key={a.clave} className="border-b">
                <td className="py-2 pr-4">{a.clave}</td>
                {[null, ...sucursales.map((s) => s.id)].map((sucursalId) => {
                  const cap = capacidadDe(a.clave, sucursalId);
                  const habilitado = cap ? cap.habilitado : true;
                  return (
                    <Fragment key={sucursalId ?? "default"}>
                      <td>
                        <FormConAviso
                          accion={async () => {
                            "use server";
                            return actualizarCapacidad(a.clave as AccionClave, sucursalId, !habilitado);
                          }}
                        >
                          <button type="submit">{habilitado ? "✅" : "⛔"}</button>
                        </FormConAviso>
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AvisosDeAccion>
  );
}
