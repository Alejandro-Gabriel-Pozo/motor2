import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarSeccionesActivas } from "@/server/actions/secciones";
import { obtenerHistorialConteosFisicos, resolverConteoPendiente, cancelarConteoFisico } from "@/server/actions/conteo-fisico";
import { listarStockParaConteo } from "@/core/movimientos/stock";
import { ConteoFisicoGrid, type FilaBaseConteo } from "./conteo-fisico-grid";

const ESTADO_COLOR: Record<string, string> = {
  RESUELTO: "text-green-700",
  PENDIENTE: "text-amber-600",
  DESCARTADO: "text-neutral-500",
  CANCELADO: "text-neutral-500",
};

export default async function ConteoFisicoPage({ searchParams }: { searchParams: Promise<{ seccionId?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "proceso_control");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const [secciones, { items: historial }] = await Promise.all([
    listarSeccionesActivas(ctx.sucursalId),
    obtenerHistorialConteosFisicos(ctx.sucursalId),
  ]);

  // Con una sola sección activa, no hace falta elegir — se precarga sola
  // (ver diseño acordado: "sección = sucursal entera" cuando hay una sola).
  const seccionElegida = sp.seccionId && secciones.some((s) => s.id === sp.seccionId) ? sp.seccionId : secciones.length === 1 ? secciones[0].id : "";

  const filasBase: FilaBaseConteo[] = seccionElegida
    ? (await listarStockParaConteo(seccionElegida)).map((f) => ({
        productoId: f.productoId,
        productoCodigo: f.productoCodigo,
        productoNombre: f.productoNombre,
        unidadStockNombre: f.unidadStockNombre,
        loteVencimiento: f.loteVencimiento ? f.loteVencimiento.toISOString().slice(0, 10) : null,
        saldoSistema: f.saldoSistema,
      }))
    : [];

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Conteo físico</h1>
        <p className="mb-4 text-sm text-neutral-500">
          La grilla trae precargado todo lo que ya tiene stock en la sección elegida — tipeá solo lo que difiere, dejá vacío lo que coincide.
        </p>
        <form className="mb-4 flex items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Sección a contar
            <select name="seccionId" defaultValue={seccionElegida} className="rounded border px-3 py-2">
              <option value="">Elegí una sección</option>
              {secciones.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Cargar
          </button>
        </form>

        {seccionElegida ? (
          <ConteoFisicoGrid seccionId={seccionElegida} filasBase={filasBase} />
        ) : (
          <p className="text-sm text-neutral-500">Elegí una sección para ver su grilla de conteo.</p>
        )}
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
