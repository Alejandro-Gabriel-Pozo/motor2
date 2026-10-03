import { IconoDeAccion } from "@/components/iconos";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/core/permisos/gate";
import { crearDestinoConsumo, actualizarActivoDestinoConsumo, listarDestinosConsumoParaPanel } from "@/server/actions/movimientos/motivos";
import { FormConResultado } from "@/components/form-con-resultado";

/**
 * Administración del catálogo Destino de Consumo (antes una lista fija en el código, ui-config.ts; plan "motivos de Consumo/Merma como
 * catálogo administrable", 2026-09-23). Gateada por su propia clave `motivos_destino_consumo` (una clave por catálogo, 2026-09-30). Mismo
 * patrón que /catalogo/categorias: activar/desactivar en vez de borrar (Operacion.destinoId referencia estas filas con ON DELETE RESTRICT).
 */
export default async function DestinosConsumoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "motivos_destino_consumo", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [destinos, { editar: puedeEditar }] = await Promise.all([
    listarDestinosConsumoParaPanel(),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "motivos_destino_consumo", ctx.db),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Destinos de Consumo</h1>

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
            {destinos.map((d) => (
              <tr key={d.id} className="border-b align-top">
                <td className="py-2">
                  <div>{d.nombre}</div>
                  {d.descripcion && <div className="text-xs text-neutral-500">{d.descripcion}</div>}
                </td>
                <td>{d.activo ? "Sí" : "No"}</td>
                <td>
                  {puedeEditar && (
                    <FormConResultado
                      accion={async () => {
                        "use server";
                        return actualizarActivoDestinoConsumo(d.id, !d.activo);
                      }}
                    >
                      <button type="submit" className="text-sm underline inline-flex items-center gap-1">
                        <IconoDeAccion id="activar" />
                        {d.activo ? "Desactivar" : "Activar"}
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
              return crearDestinoConsumo(String(formData.get("nombre") ?? ""), String(formData.get("descripcion") ?? ""));
            }}
            className="max-w-md space-y-1"
          >
            <div className="flex gap-2">
              <input name="nombre" placeholder="nombre del destino" required className="flex-1 rounded border px-3 py-2" />
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
