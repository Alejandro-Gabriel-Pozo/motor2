import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVer } from "@/core/permisos/gate";
import { calcularValuacionInventario, obtenerUltimaCotizacionSinRomper } from "@/core/reportes/public-servidor";
import { EnDolares } from "@/components/en-dolares";
import { TablaValuacionConCosto, TablaValuacionSinCosto } from "./tabla-valuacion";

export default async function ValuacionPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_valuacion", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [rep, cotizacion] = await Promise.all([calcularValuacionInventario(ctx.sucursalId, ctx.db), obtenerUltimaCotizacionSinRomper(ctx.db)]);
  const sinCosto = rep.filas.filter((f) => f.sinCosto);
  const conCosto = rep.filas.filter((f) => !f.sinCosto);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Valuación de inventario</h1>
        <p className="text-sm text-neutral-500">
          Stock actual de esta sucursal valorizado al costo de reposición (misma fuente que Costos y márgenes: la compra local más reciente de
          cada producto).
        </p>
      </div>

      <div className="rounded border px-4 py-3">
        <div className="text-xs uppercase text-neutral-500">Total valorizado</div>
        <div className="text-2xl font-semibold">${rep.totalValorizado.toLocaleString("es-AR")}</div>
        <EnDolares pesos={rep.totalValorizado} cotizacion={cotizacion} className="text-sm text-neutral-500" />
        {rep.cantidadSinCosto > 0 && (
          <div className="mt-1 text-xs text-amber-700 dark:text-amber-600">
            {rep.cantidadSinCosto} producto{rep.cantidadSinCosto === 1 ? "" : "s"} con stock pero sin ninguna compra registrada — no incluido
            {rep.cantidadSinCosto === 1 ? "" : "s"} en el total (ver abajo).
          </div>
        )}
      </div>

      <TablaValuacionConCosto filas={conCosto} />

      {sinCosto.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium">Con stock, sin costo conocido (no valorizado)</h2>
          <TablaValuacionSinCosto filas={sinCosto} />
        </div>
      )}
    </div>
  );
}
