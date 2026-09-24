import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { generarReporteVentasPorSeccion } from "@/core/carta/reporte-secciones";
import { resolverRangoDeReporte } from "@/core/reportes/rango-por-defecto";
import { TablaCategoriasDeSeccion } from "./tabla-seccion";
import { SelectorRango } from "@/components/selector-rango";

/**
 * Ventas por sección de carta (docs/plan-carta-catalogo-2026-09-24.md, M7): las mismas ventas que «Por categoría», agrupadas
 * como las ve el cliente en la carta pública. Mismo permiso que «Por categoría» (dinero).
 */
export default async function VentasPorSeccionPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; rango?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_dinero");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const rango = resolverRangoDeReporte(sp);
  const desdeStr = rango.desdeISO;
  const hastaStr = rango.hastaISO;
  const rep = await generarReporteVentasPorSeccion(ctx.sucursalId, new Date(desdeStr), new Date(hastaStr));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Ventas por sección de carta</h1>
        <SelectorRango opcion={rango.opcion} desdeISO={desdeStr} hastaISO={hastaStr} />
        <p className="mt-2 text-sm text-neutral-500">Total facturado: ${rep.totalFacturado.toLocaleString("es-AR")}</p>
      </div>

      {rep.porSeccion.map((s) => (
        <div key={s.seccion}>
          <h2 className="mb-2 text-sm font-medium">
            {s.seccion} — ${s.importe.toLocaleString("es-AR")} ({s.cantidad} unid.)
          </h2>
          <TablaCategoriasDeSeccion filas={s.categorias.map((c) => ({ categoria: c.categoria, cantidad: c.cantidad, importe: c.importe }))} nombreExport={`ventas-seccion-${s.seccion}`} />
        </div>
      ))}
      {!rep.porSeccion.length && <p className="text-sm text-neutral-500">Sin ventas en el período.</p>}

      {rep.categoriasSinSeccion.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-amber-700 dark:text-amber-600">Categorías con ventas que no están en ninguna sección de carta</h2>
          <ul className="list-disc pl-5 text-sm">
            {rep.categoriasSinSeccion.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

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
