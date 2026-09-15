import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerReporteVencimientosDatos } from "@/core/reportes/vencimientos";

export default async function VencimientosPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const sp = await searchParams;
  const dias = Number(sp.dias) > 0 ? Number(sp.dias) : 7;
  const rep = await obtenerReporteVencimientosDatos(ctx.sucursalId, dias);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Vencimientos</h1>
        <form className="flex items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Próximos (días)
            <input type="number" name="dias" min={1} defaultValue={rep.diasUsados} className="w-24 rounded border px-3 py-2" />
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Actualizar
          </button>
        </form>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Lotes próximos a vencer (incluye ya vencidos)</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1">Producto</th>
              <th>Sección</th>
              <th>Vence</th>
              <th>Días</th>
              <th>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rep.proximosAVencer.map((l, i) => (
              <tr key={i} className="border-b">
                <td className="py-1">{l.productoCodigo} — {l.productoNombre}</td>
                <td>{l.seccionNombre}</td>
                <td>{l.loteVencimiento.toISOString().slice(0, 10)}</td>
                <td className={l.diasParaVencer < 0 ? "text-red-600" : ""}>{l.diasParaVencer}</td>
                <td>
                  {l.saldo} {l.unidadStockNombre}
                </td>
              </tr>
            ))}
            {!rep.proximosAVencer.length && (
              <tr>
                <td className="py-1 text-neutral-500" colSpan={5}>
                  Sin lotes próximos a vencer.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Conciliación (lotes contados que desaparecieron entre dos conteos)</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1">Producto</th>
              <th>Sección</th>
              <th>Lote</th>
              <th>Cantidad</th>
              <th>Período</th>
              <th>Ventas+consumos</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rep.conciliacion.map((c, i) => (
              <tr key={i} className="border-b">
                <td className="py-1">{c.productoNombre}</td>
                <td>{c.seccionNombre}</td>
                <td>{c.loteVencimiento.toISOString().slice(0, 10)}</td>
                <td>{c.cantidadDesaparecida}</td>
                <td>
                  {c.conteoAnteriorFecha} → {c.conteoActualFecha}
                </td>
                <td>{c.ventasPeriodo}</td>
                <td className={c.estado === "revisar" ? "text-red-600 font-medium" : "text-neutral-500"}>{c.estado}</td>
              </tr>
            ))}
            {!rep.conciliacion.length && (
              <tr>
                <td className="py-1 text-neutral-500" colSpan={7}>
                  Sin lotes para conciliar (necesita al menos dos conteos por lote consecutivos en la misma sección).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
