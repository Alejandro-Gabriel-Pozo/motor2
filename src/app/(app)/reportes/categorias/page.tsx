import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { generarReporteVentasPorCategoria } from "@/core/reportes/periodo";
import { resolverRangoDeReporte } from "@/core/reportes/rango-por-defecto";
import { TablaProductosCategoria } from "./tabla-categorias";
import { SelectorRango } from "@/components/selector-rango";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

export default async function CategoriasPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"desde" | "hasta" | "rango">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_categorias", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  const rango = resolverRangoDeReporte(sp);
  const desdeStr = rango.desdeISO;
  const hastaStr = rango.hastaISO;
  const rep = await generarReporteVentasPorCategoria(ctx.sucursalId, new Date(desdeStr), new Date(hastaStr), ctx.db);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Ventas por categoría</h1>
        <SelectorRango opcion={rango.opcion} desdeISO={desdeStr} hastaISO={hastaStr} />
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
          <h2 className="mb-2 text-sm font-medium text-amber-700 dark:text-amber-600">PV disponibles acá sin categoría asignada</h2>
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
