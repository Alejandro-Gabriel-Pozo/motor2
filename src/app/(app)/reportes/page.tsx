import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { obtenerResumenOperativo } from "@/core/reportes/resumen-operativo";
import { resolverRangoDeReporte } from "@/core/reportes/rango-por-defecto";
import { TablaTopProductos, TablaTopProveedores, TablaStockBajo } from "./tabla-resumen";
import { AyudaIcono } from "@/components/ayuda-campo";
import { EnDolares } from "@/components/en-dolares";
import { SelectorRango } from "@/components/selector-rango";
import { obtenerUltimaCotizacion } from "@/core/reportes/cotizacion-dolar";

export default async function ReportesResumenPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; rango?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_dinero");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const rango = resolverRangoDeReporte(sp);
  const [r, cotizacion] = await Promise.all([
    obtenerResumenOperativo(ctx.sucursalId, undefined, { desde: new Date(rango.desdeISO), hasta: new Date(rango.hastaISO) }),
    obtenerUltimaCotizacion().catch(() => null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Resumen operativo</h1>
        <p className="mb-2 text-sm text-neutral-500">
          Financiero de {r.financiero.desde.toISOString().slice(0, 10)} a {r.financiero.hasta.toISOString().slice(0, 10)}.
        </p>
        <SelectorRango opcion={rango.opcion} desdeISO={rango.desdeISO} hastaISO={rango.hastaISO} />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded border p-4">
          <p className="flex items-center text-xs text-neutral-500">
            Ventas
            <AyudaIcono texto={r.financiero.avisoVentas} />
          </p>
          <p className="text-lg font-semibold">${r.financiero.ventasTotal.toLocaleString("es-AR")}</p>
          <EnDolares pesos={r.financiero.ventasTotal} cotizacion={cotizacion} />
          {r.financiero.hayEstimados && <p className="text-xs text-amber-700 dark:text-amber-600">incluye estimados</p>}
        </div>
        <div className="rounded border p-4">
          <p className="flex items-center text-xs text-neutral-500">
            Margen
            <AyudaIcono texto={r.financiero.avisoMargen} />
          </p>
          <p className="text-lg font-semibold">
            ${r.financiero.margenTotal.toLocaleString("es-AR")} {r.financiero.margenPct !== null && `(${r.financiero.margenPct}%)`}
          </p>
          {r.financiero.hayCostoIncompleto && (
            <p className="text-xs text-amber-700 dark:text-amber-600">
              Costo incompleto en algún producto —{" "}
              <Link href="/reportes/costos" className="underline">
                ver Costos y márgenes
              </Link>
            </p>
          )}
          <p className="mt-1 flex items-center text-xs text-neutral-500">
            Real: {r.financiero.margenRealTotal !== null ? `$${r.financiero.margenRealTotal.toLocaleString("es-AR")} (${r.financiero.margenRealPct}%)${r.financiero.margenRealReconstruido ? " · reconstruido" : ""}` : "sin datos todavía"}
            <AyudaIcono texto={r.financiero.avisoMargenReal} />
          </p>
          <p className="mt-1 flex items-center text-xs text-neutral-500">
            Ajustado IPC: {r.financiero.margenIPCTotal !== null ? `$${r.financiero.margenIPCTotal.toLocaleString("es-AR")} (${r.financiero.margenIPCPct}%)${r.financiero.ipcVencido ? " · IPC desactualizado" : r.financiero.margenIPCProvisorio ? " · provisorio" : ""}` : "sin datos todavía"}
            <AyudaIcono texto={r.financiero.avisoMargenIPC} />
          </p>
        </div>
        <div className="rounded border p-4">
          <p className="flex items-center text-xs text-neutral-500">
            Gastado en compras
            <AyudaIcono texto={r.financiero.avisoCompras} />
          </p>
          <p className="text-lg font-semibold">${r.financiero.gastadoTotal.toLocaleString("es-AR")}</p>
          <EnDolares pesos={r.financiero.gastadoTotal} cotizacion={cotizacion} />
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
          <h2 className="mb-2 text-sm font-medium">Top productos vendidos</h2>
          <TablaTopProductos filas={r.financiero.topProductos} />
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium">Top proveedores</h2>
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
