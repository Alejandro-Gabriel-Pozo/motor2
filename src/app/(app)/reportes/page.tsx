import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerResumenOperativo } from "@/core/reportes/resumen-operativo";
import { TablaTopProductos, TablaTopProveedores, TablaStockBajo } from "./tabla-resumen";
import { AyudaIcono } from "@/components/ayuda-campo";

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
          <p className="flex items-center text-xs text-neutral-500">
            Ventas del mes
            <AyudaIcono texto={r.financiero.avisoVentas} />
          </p>
          <p className="text-lg font-semibold">${r.financiero.ventasTotal.toLocaleString("es-AR")}</p>
          {r.financiero.hayEstimados && <p className="text-xs text-amber-600">incluye estimados</p>}
        </div>
        <div className="rounded border p-4">
          <p className="flex items-center text-xs text-neutral-500">
            Margen del mes
            <AyudaIcono texto={r.financiero.avisoMargen} />
          </p>
          <p className="text-lg font-semibold">
            ${r.financiero.margenTotal.toLocaleString("es-AR")} {r.financiero.margenPct !== null && `(${r.financiero.margenPct}%)`}
          </p>
          {r.financiero.hayCostoIncompleto && (
            <p className="text-xs text-amber-600">
              Costo incompleto en algún producto —{" "}
              <Link href="/reportes/costos" className="underline">
                ver Costos y márgenes
              </Link>
            </p>
          )}
          <p className="mt-1 flex items-center text-xs text-neutral-500">
            Real: {r.financiero.margenRealTotal !== null ? `$${r.financiero.margenRealTotal.toLocaleString("es-AR")} (${r.financiero.margenRealPct}%)` : "sin datos todavía"}
            <AyudaIcono texto={r.financiero.avisoMargenReal} />
          </p>
          <p className="mt-1 flex items-center text-xs text-neutral-500">
            Ajustado IPC: {r.financiero.margenIPCTotal !== null ? `$${r.financiero.margenIPCTotal.toLocaleString("es-AR")} (${r.financiero.margenIPCPct}%)` : "sin datos todavía"}
            <AyudaIcono texto={r.financiero.avisoMargenIPC} />
          </p>
        </div>
        <div className="rounded border p-4">
          <p className="flex items-center text-xs text-neutral-500">
            Gastado en compras
            <AyudaIcono texto={r.financiero.avisoCompras} />
          </p>
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
          <TablaTopProductos filas={r.financiero.topProductos} />
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium">Top proveedores (mes)</h2>
          <TablaTopProveedores filas={r.financiero.topProveedores} />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Stock con saldo en 0 o negativo (top 10)</h2>
        <TablaStockBajo filas={r.topStockBajo} />
      </div>

      <p className="text-xs text-neutral-500">
        Stock: {r.stock.totalItems} combinaciones producto+sección con movimientos, {r.stock.negativos} en negativo. Movimientos totales: {r.movimientos.total}.
      </p>
    </div>
  );
}
