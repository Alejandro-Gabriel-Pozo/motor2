import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerReportePorPeriodo } from "@/core/reportes/periodo";
import { TablaVentasPorProducto, TablaComprasPorProveedor } from "./tabla-periodo";
import { AyudaIcono } from "@/components/ayuda-campo";

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
          <p className="flex items-center text-xs text-neutral-500">
            Ventas
            <AyudaIcono texto={rep.ventas.aviso} />
          </p>
          <p className="text-lg font-semibold">${rep.ventas.totalFacturado.toLocaleString("es-AR")}</p>
        </div>
        <div className="rounded border p-4">
          <p className="flex items-center text-xs text-neutral-500">
            Margen
            <AyudaIcono texto={rep.margen.aviso} />
          </p>
          <p className="text-lg font-semibold">
            ${rep.margen.margenTotal.toLocaleString("es-AR")} {rep.margen.margenPctTotal !== null && `(${rep.margen.margenPctTotal}%)`}
          </p>
          <p className="mt-1 flex items-center text-xs text-neutral-500">
            Real: {rep.margen.margenRealTotal !== null ? `$${rep.margen.margenRealTotal.toLocaleString("es-AR")} (${rep.margen.margenRealPctTotal}%)` : "sin datos todavía"}
            <AyudaIcono texto={rep.margen.avisoReal} />
          </p>
          <p className="mt-1 flex items-center text-xs text-neutral-500">
            Ajustado IPC: {rep.margen.margenIPCTotal !== null ? `$${rep.margen.margenIPCTotal.toLocaleString("es-AR")} (${rep.margen.margenIPCPctTotal}%)` : "sin datos todavía"}
            <AyudaIcono texto={rep.margen.avisoIPC} />
          </p>
        </div>
        <div className="rounded border p-4">
          <p className="flex items-center text-xs text-neutral-500">
            Compras
            <AyudaIcono texto={rep.compras.aviso} />
          </p>
          <p className="text-lg font-semibold">${rep.compras.totalGastado.toLocaleString("es-AR")}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Movimientos</p>
          <p className="text-lg font-semibold">{rep.total}</p>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Ventas por producto</h2>
        <TablaVentasPorProducto filas={rep.margen.porProducto} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Compras por proveedor</h2>
        <TablaComprasPorProveedor filas={rep.compras.porProveedor} />
      </div>
    </div>
  );
}
