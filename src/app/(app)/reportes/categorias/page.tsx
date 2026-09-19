import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { generarReporteVentasPorCategoria } from "@/core/reportes/periodo";
import { TablaProductosCategoria } from "./tabla-categorias";

function primerDiaDelMesISO() {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function CategoriasPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_dinero");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const desdeStr = sp.desde || primerDiaDelMesISO();
  const hastaStr = sp.hasta || hoyISO();
  const rep = await generarReporteVentasPorCategoria(ctx.sucursalId, new Date(desdeStr), new Date(hastaStr));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Ventas por categoría</h1>
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
        <p className="mt-2 text-sm text-neutral-500">Total facturado: ${rep.totalFacturado.toLocaleString("es-AR")}</p>
      </div>

      {rep.porCategoria.map((c) => (
        <div key={c.categoria}>
          <h2 className="mb-2 text-sm font-medium">
            {c.categoria} — ${c.importe.toLocaleString("es-AR")} ({c.cantidad} unid.)
          </h2>
          <TablaProductosCategoria filas={c.productos} nombreExport={`ventas-categoria-${c.categoria}`} />
        </div>
      ))}
      {!rep.porCategoria.length && <p className="text-sm text-neutral-500">Sin ventas en el período.</p>}

      {rep.pvSinCategoria.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-amber-600">PV activos sin categoría asignada</h2>
          <ul className="list-disc pl-5 text-sm">
            {rep.pvSinCategoria.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
