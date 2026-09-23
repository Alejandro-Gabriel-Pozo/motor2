import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import {
  crearMotivoMerma,
  crearDestinoConsumo,
  actualizarActivoMotivoMerma,
  actualizarActivoDestinoConsumo,
  listarMotivosMermaParaPanel,
  listarDestinosConsumoParaPanel,
} from "@/server/actions/movimientos/motivos";
import { FormConResultado } from "@/components/form-con-resultado";

/**
 * Administración de los catálogos Motivo de Merma / Destino de Consumo (plan "motivos de Consumo/Merma como catálogo
 * administrable", 2026-09-23, P6) — antes una lista fija en el código (ui-config.ts), ahora dos tablas editables acá,
 * gateadas por la acción 'motivos_movimiento' (admin-only, P1). Mismo patrón que /catalogo/categorias: activar/
 * desactivar en vez de borrar (Operacion.motivoId/destinoId referencian estas filas con ON DELETE RESTRICT — un motivo
 * ya usado no se puede borrar, solo dejar de ofrecer).
 */
export default async function MotivosPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "motivos_movimiento");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [motivos, destinos] = await Promise.all([listarMotivosMermaParaPanel(), listarDestinosConsumoParaPanel()]);

  return (
    <div className="space-y-12">
      <h1 className="text-xl font-semibold">Motivos de Merma / Destinos de Consumo</h1>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Motivo de Merma</h2>
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
                  <FormConResultado
                    accion={async () => {
                      "use server";
                      return actualizarActivoMotivoMerma(m.id, !m.activo);
                    }}
                  >
                    <button type="submit" className="text-sm underline">
                      {m.activo ? "Desactivar" : "Activar"}
                    </button>
                  </FormConResultado>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

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
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Destino de Consumo</h2>
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
                  <FormConResultado
                    accion={async () => {
                      "use server";
                      return actualizarActivoDestinoConsumo(d.id, !d.activo);
                    }}
                  >
                    <button type="submit" className="text-sm underline">
                      {d.activo ? "Desactivar" : "Activar"}
                    </button>
                  </FormConResultado>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

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
      </section>
    </div>
  );
}
