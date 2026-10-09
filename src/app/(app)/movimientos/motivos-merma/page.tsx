import { IconoDeAccion } from "@/components/iconos";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { crearMotivoMerma, actualizarActivoMotivoMerma, listarMotivosMermaParaPanel } from "@/server/actions/movimientos/motivos";
import { FormConResultado } from "@/components/form-con-resultado";

/**
 * Administración del catálogo Motivo de Merma (antes una lista fija en el código, ui-config.ts; plan "motivos de Consumo/Merma como
 * catálogo administrable", 2026-09-23). Gateada por su propia clave `motivos_merma` (una clave por catálogo, 2026-09-30). Mismo patrón
 * que /catalogo/categorias: activar/desactivar en vez de borrar (Operacion.motivoId referencia estas filas con ON DELETE RESTRICT).
 */
export default async function MotivosMermaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "motivos_merma", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [motivos, { editar: puedeEditar }] = await Promise.all([
    listarMotivosMermaParaPanel(),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "motivos_merma", ctx.db),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Motivos de Merma</h1>

      <section className="space-y-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2">Nombre</th>
              <th>Activo</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {motivos.map((m) => (
              <tr key={m.id} className="border-b align-top">
                <td className="py-2">
                  <div>{m.nombre}</div>
                  {m.descripcion && <div className="text-xs text-neutral-500">{m.descripcion}</div>}
                </td>
                <td>{m.activo ? "Sí" : "No"}</td>
                <td>
                  {puedeEditar && (
                    <FormConResultado
                      accion={async () => {
                        "use server";
                        return actualizarActivoMotivoMerma(m.id, !m.activo);
                      }}
                    >
                      <button type="submit" className="text-sm underline inline-flex items-center gap-1">
                        <IconoDeAccion id="activar" />
                        {m.activo ? "Desactivar" : "Activar"}
                      </button>
                    </FormConResultado>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {puedeEditar && (
          <FormConResultado
            accion={async (formData: FormData) => {
              "use server";
              return crearMotivoMerma(String(formData.get("nombre") ?? ""), String(formData.get("descripcion") ?? ""));
            }}
            className="max-w-md space-y-1"
          >
            <div className="flex gap-2">
              <input name="nombre" placeholder="nombre del motivo" required className="flex-1 rounded border px-3 py-2" />
              <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
                Crear
              </button>
            </div>
            <input name="descripcion" placeholder="descripción (opcional)" className="w-full rounded border px-3 py-2" />
          </FormConResultado>
        )}
      </section>
    </div>
  );
}
