import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarSeccionesActivas } from "@/server/actions/secciones";
import { obtenerHistorialConteosFisicos, resolverConteoPendiente, cancelarConteoFisico } from "@/server/actions/conteo-fisico";
import { ConteoFisicoForm } from "./conteo-fisico-form";

const ESTADO_COLOR: Record<string, string> = {
  RESUELTO: "text-green-700",
  PENDIENTE: "text-amber-600",
  DESCARTADO: "text-neutral-500",
  CANCELADO: "text-neutral-500",
};

export default async function ConteoFisicoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "proceso_control");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [secciones, { items: historial }] = await Promise.all([
    listarSeccionesActivas(ctx.sucursalId),
    obtenerHistorialConteosFisicos(ctx.sucursalId),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <div className="max-w-2xl">
        <h1 className="mb-4 text-xl font-semibold">Conteo físico</h1>
        <ConteoFisicoForm secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))} />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Historial reciente</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2">Fecha</th>
              <th>Producto</th>
              <th>Sección</th>
              <th>Sistema</th>
              <th>Contado</th>
              <th>Diferencia</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {historial.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="py-2">{c.fecha.toISOString().slice(0, 10)}</td>
                <td>{c.producto.nombre}</td>
                <td>{c.seccion.nombre}</td>
                <td>{Number(c.saldoSistema)}</td>
                <td>{Number(c.conteoReal)}</td>
                <td>{Number(c.diferencia) > 0 ? "+" : ""}{Number(c.diferencia)}</td>
                <td className={ESTADO_COLOR[c.estado]}>{c.estado}</td>
                <td className="flex gap-2 py-2">
                  {c.estado === "PENDIENTE" && (
                    <>
                      <form
                        action={async () => {
                          "use server";
                          await resolverConteoPendiente(c.id, "resuelto");
                        }}
                      >
                        <button type="submit" className="text-sm underline">
                          Ya se cargó
                        </button>
                      </form>
                      <form
                        action={async () => {
                          "use server";
                          await resolverConteoPendiente(c.id, "ajustar");
                        }}
                      >
                        <button type="submit" className="text-sm underline">
                          Ajustar ahora
                        </button>
                      </form>
                    </>
                  )}
                  {c.estado === "RESUELTO" && (
                    <form
                      action={async () => {
                        "use server";
                        await cancelarConteoFisico(c.id);
                      }}
                    >
                      <button type="submit" className="text-sm underline">
                        Cancelar
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
