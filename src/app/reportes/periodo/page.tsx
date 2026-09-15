import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerReportePorPeriodo } from "@/core/reportes/periodo";

function primerDiaDelMesISO() {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function PeriodoPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const sp = await searchParams;
  const desdeStr = sp.desde || primerDiaDelMesISO();
  const hastaStr = sp.hasta || hoyISO();
  const rep = await obtenerReportePorPeriodo(ctx.sucursalId, new Date(desdeStr), new Date(hastaStr));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Reporte por período</h1>
        <form className="flex items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Desde
            <input type="date" name="desde" defaultValue={desdeStr} className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            Hasta
            <input type="date" name="hasta" defaultValue={hastaStr} className="rounded border px-3 py-2" />
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Actualizar
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Ventas</p>
          <p className="text-lg font-semibold">${rep.ventas.totalFacturado.toLocaleString("es-AR")}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Margen</p>
          <p className="text-lg font-semibold">
            ${rep.margen.margenTotal.toLocaleString("es-AR")} {rep.margen.margenPctTotal !== null && `(${rep.margen.margenPctTotal}%)`}
          </p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Compras</p>
          <p className="text-lg font-semibold">${rep.compras.totalGastado.toLocaleString("es-AR")}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Movimientos</p>
          <p className="text-lg font-semibold">{rep.total}</p>
        </div>
      </div>

      <p className="text-xs text-neutral-500">{rep.ventas.aviso}</p>
      <p className="text-xs text-neutral-500">{rep.margen.aviso}</p>

      <div>
        <h2 className="mb-2 text-sm font-medium">Ventas por producto</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1">Producto</th>
              <th>Cantidad</th>
              <th>Importe</th>
              <th>Margen</th>
            </tr>
          </thead>
          <tbody>
            {rep.margen.porProducto.map((v) => (
              <tr key={v.productoId} className="border-b">
                <td className="py-1">
                  {v.producto} {v.ingresoEstimado && <span className="text-amber-600">(estimado)</span>}
                </td>
                <td>{v.cantidad}</td>
                <td>${v.ingreso.toLocaleString("es-AR")}</td>
                <td>{v.margen === null ? <span className="text-amber-600">costo incompleto</span> : `$${v.margen.toLocaleString("es-AR")} (${v.margenPct}%)`}</td>
              </tr>
            ))}
            {!rep.margen.porProducto.length && (
              <tr>
                <td className="py-1 text-neutral-500" colSpan={4}>
                  Sin ventas en el período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Compras por proveedor</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1">Proveedor</th>
              <th>Líneas</th>
              <th>Importe</th>
            </tr>
          </thead>
          <tbody>
            {rep.compras.porProveedor.map((p) => (
              <tr key={p.proveedor} className="border-b">
                <td className="py-1">{p.proveedor}</td>
                <td>{p.lineas}</td>
                <td>${p.importe.toLocaleString("es-AR")}</td>
              </tr>
            ))}
            {!rep.compras.porProveedor.length && (
              <tr>
                <td className="py-1 text-neutral-500" colSpan={3}>
                  Sin compras en el período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
