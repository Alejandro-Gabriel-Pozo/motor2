import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { listarProductos } from "@/server/actions/productos";
import { listarSeccionesActivas } from "@/server/actions/secciones";
import { obtenerHistorialProducto } from "@/core/reportes/historial-producto";

export default async function HistorialProductoPage({
  searchParams,
}: {
  searchParams: Promise<{ productoId?: string; seccionId?: string; desde?: string; hasta?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const sp = await searchParams;
  const [productos, secciones] = await Promise.all([listarProductos(), listarSeccionesActivas(ctx.sucursalId)]);

  const historial = sp.productoId
    ? await obtenerHistorialProducto(
        ctx.sucursalId,
        sp.productoId,
        sp.seccionId || undefined,
        sp.desde ? new Date(sp.desde) : undefined,
        sp.hasta ? new Date(sp.hasta) : undefined
      )
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Historial de un producto</h1>
        <form className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Producto
            <select name="productoId" defaultValue={sp.productoId ?? ""} required className="rounded border px-3 py-2">
              <option value="">Elegí un producto</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} — {p.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Sección (opcional)
            <select name="seccionId" defaultValue={sp.seccionId ?? ""} className="rounded border px-3 py-2">
              <option value="">Todas</option>
              {secciones.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Desde
            <input type="date" name="desde" defaultValue={sp.desde ?? ""} className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            Hasta
            <input type="date" name="hasta" defaultValue={sp.hasta ?? ""} className="rounded border px-3 py-2" />
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Ver historial
          </button>
        </form>
      </div>

      {historial && (
        <div>
          <h2 className="mb-2 text-sm font-medium">
            {historial.codigo} — {historial.producto} ({historial.tipo}) — saldo actual: {historial.saldoActual} {historial.unidadStockNombre}
          </h2>
          <p className="mb-2 text-xs text-neutral-500">
            {historial.totalMovimientos} movimiento(s), {historial.totalConteos} conteo(s) en total (el saldo corriente arranca del primer movimiento
            real, no del rango elegido).
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="py-1">Fecha</th>
                <th>Tipo</th>
                <th>Detalle</th>
                <th>Sección</th>
                <th>Cantidad</th>
                <th>Saldo corriente</th>
              </tr>
            </thead>
            <tbody>
              {historial.eventos.map((ev, i) => (
                <tr key={i} className="border-b">
                  <td className="py-1">{ev.fecha.toISOString().slice(0, 10)}</td>
                  <td>{ev.tipo === "movimiento" ? ev.proceso : "Conteo"}</td>
                  <td>{ev.detalle}</td>
                  <td>{ev.seccionNombre}</td>
                  <td>{ev.tipo === "movimiento" ? ev.cantidadConSigno : `${ev.conteoReal} (dif. ${ev.diferencia})`}</td>
                  <td>{ev.tipo === "movimiento" ? ev.saldoCorriente : "—"}</td>
                </tr>
              ))}
              {!historial.eventos.length && (
                <tr>
                  <td className="py-1 text-neutral-500" colSpan={6}>
                    Sin eventos en el rango elegido.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
