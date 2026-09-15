import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerResumenOperativo } from "@/core/reportes/resumen-operativo";

export default async function ReportesResumenPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const r = await obtenerResumenOperativo(ctx.sucursalId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Resumen operativo</h1>
        <p className="text-sm text-neutral-500">
          Financiero del mes actual ({r.financiero.desde.toISOString().slice(0, 10)} a {r.financiero.hasta.toISOString().slice(0, 10)}).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Ventas del mes</p>
          <p className="text-lg font-semibold">${r.financiero.ventasTotal.toLocaleString("es-AR")}</p>
          {r.financiero.hayEstimados && <p className="text-xs text-amber-600">incluye estimados</p>}
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Margen del mes</p>
          <p className="text-lg font-semibold">
            ${r.financiero.margenTotal.toLocaleString("es-AR")} {r.financiero.margenPct !== null && `(${r.financiero.margenPct}%)`}
          </p>
          {r.financiero.hayCostoIncompleto && <p className="text-xs text-amber-600">costo incompleto en algún producto</p>}
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Gastado en compras</p>
          <p className="text-lg font-semibold">${r.financiero.gastadoTotal.toLocaleString("es-AR")}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Alertas de stock</p>
          <p className="text-lg font-semibold">
            {r.alertas.criticos} crítica(s), {r.alertas.bajos} baja(s)
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium">Top productos vendidos (mes)</h2>
          <table className="w-full text-sm">
            <tbody>
              {r.financiero.topProductos.map((p) => (
                <tr key={p.producto} className="border-b">
                  <td className="py-1">{p.producto}</td>
                  <td className="text-right">${p.importe.toLocaleString("es-AR")}</td>
                </tr>
              ))}
              {!r.financiero.topProductos.length && (
                <tr>
                  <td className="py-1 text-neutral-500">Sin ventas todavía este mes.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium">Top proveedores (mes)</h2>
          <table className="w-full text-sm">
            <tbody>
              {r.financiero.topProveedores.map((p) => (
                <tr key={p.proveedor} className="border-b">
                  <td className="py-1">{p.proveedor}</td>
                  <td className="text-right">${p.importe.toLocaleString("es-AR")}</td>
                </tr>
              ))}
              {!r.financiero.topProveedores.length && (
                <tr>
                  <td className="py-1 text-neutral-500">Sin compras todavía este mes.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Stock con saldo en 0 o negativo (top 10)</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1">Producto</th>
              <th>Sección</th>
              <th>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {r.topStockBajo.map((s, i) => (
              <tr key={i} className="border-b">
                <td className="py-1">{s.producto}</td>
                <td>{s.seccion}</td>
                <td className={s.saldo < 0 ? "text-red-600" : ""}>{s.saldo}</td>
              </tr>
            ))}
            {!r.topStockBajo.length && (
              <tr>
                <td className="py-1 text-neutral-500">Sin productos en 0 o negativo.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-neutral-500">
        Stock: {r.stock.totalItems} combinaciones producto+sección con movimientos, {r.stock.negativos} en negativo. Movimientos totales: {r.movimientos.total}.
      </p>
    </div>
  );
}
