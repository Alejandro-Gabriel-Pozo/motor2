import { Fragment } from "react";
import { MATRICES_AYUDAS_VISIBLES } from "@/core/permisos/matrices-ayudas-visibles";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { actualizarCapacidad, listarCapacidades } from "@/server/actions/permisos/capacidades-sucursal";
import type { AccionClave } from "@/core/permisos/acciones";
import { agruparAccionesPorModulo } from "@/core/permisos/agrupar-acciones-por-modulo";
import { CAPACIDADES_PLEGADAS } from "@/core/permisos/matrices-plegadas";
import { capacidadEfectiva } from "@/core/permisos/capacidades-sucursal";
import { AvisosDeAccion, FormConAviso } from "@/components/avisos-de-accion";

export default async function CapacidadesSucursalPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "capacidades_sucursal", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const { acciones, sucursales, capacidades } = await listarCapacidades();
  // `CAPACIDADES_PLEGADAS`: un bloque plegado por módulo; apagado, una sola tabla con todas las acciones (como siempre).
  const grupos = CAPACIDADES_PLEGADAS ? agruparAccionesPorModulo(acciones) : [{ id: "todas", nombre: "", acciones }];

  return (
    <AvisosDeAccion className="space-y-4">
      <h1 className="text-xl font-semibold">Capacidades por sucursal (matriz de la Central)</h1>
      {MATRICES_AYUDAS_VISIBLES && (<p className="text-xs text-tinta-tenue">
        Columna &quot;Default&quot; = comportamiento para cualquier sucursal sin fila propia. Sin ninguna fila, la acción está habilitada. Una sucursal sin fila propia toma el valor del Default: la casilla muestra ese valor y lo marca con «hereda del Default».
      </p>)}
      {grupos.map((g) => {
        const tabla = (
          <div className={CAPACIDADES_PLEGADAS ? "overflow-x-auto px-3 pb-3" : "overflow-x-auto"}>
            <table className="w-full text-sm">
              <thead>
            <tr className="border-b text-left text-tinta-tenue">
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
              {g.acciones.map((a) => (
              <tr key={a.clave} className="border-b">
                <td className="py-2 pr-4">{a.clave}</td>
                {[null, ...sucursales.map((s) => s.id)].map((sucursalId) => {
                  // El valor EFECTIVO, con la misma regla que decide el acceso (`resolverCapacidad`): una sucursal sin fila propia toma el Default.
                  const { habilitado, heredaDelDefault } = capacidadEfectiva(a.clave, capacidades, sucursalId);
                  return (
                    <Fragment key={sucursalId ?? "default"}>
                      <td>
                        <FormConAviso
                          accion={async () => {
                            "use server";
                            return actualizarCapacidad(a.clave as AccionClave, sucursalId, !habilitado);
                          }}
                        >
                          <button type="submit" aria-pressed={habilitado} aria-label={`${a.clave}: ${sucursalId ? (sucursales.find((s) => s.id === sucursalId)?.nombre ?? "sucursal") : "valor por defecto"}`}>{habilitado ? "✅" : "⛔"}</button>
                        </FormConAviso>
                        {heredaDelDefault && <div className={MATRICES_AYUDAS_VISIBLES ? "text-xs text-tinta-tenue" : "sr-only"}>hereda del Default</div>}
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
              </tbody>
            </table>
          </div>
        );
        // Plegado: un `<details>` por módulo. Apagado: la tabla de siempre, sin envoltorio (el DOM de antes).
        return CAPACIDADES_PLEGADAS ? (
          <details key={g.id} className="rounded border" data-modulo-de-capacidades={g.id}>
            <summary className="min-h-11 cursor-pointer px-3 py-2 font-medium">
              {g.nombre} · {g.acciones.length}
            </summary>
            {tabla}
          </details>
        ) : (
          <Fragment key={g.id}>{tabla}</Fragment>
        );
      })}
    </AvisosDeAccion>
  );
}
