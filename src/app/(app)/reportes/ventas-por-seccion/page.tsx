import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVer } from "@/core/permisos/gate";
import { generarReporteVentasPorSeccion } from "@/server/consultas/carta/ventas-por-seccion";
import { resolverRangoDeReporte } from "@/core/reportes/public";
import { TablaCategoriasDeSeccion } from "./tabla-seccion";
import { SelectorRango } from "@/components/selector-rango";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

/**
 * Ventas por sección de carta (docs/plan-carta-catalogo-2026-09-24.md, M7): las mismas ventas que «Por categoría», agrupadas
 * como las ve el cliente en la carta pública — por la sección donde se ve CADA producto (docs/plan-carta-seccion-directa-2026-09-25.md,
 * M5), y dentro de cada sección, por categoría. Mismo permiso que «Por categoría» (dinero).
 */
export default async function VentasPorSeccionPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"desde" | "hasta" | "rango">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_ventas_por_seccion", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  const rango = resolverRangoDeReporte(sp, new Date());
  const desdeStr = rango.desdeISO;
  const hastaStr = rango.hastaISO;
  const rep = await generarReporteVentasPorSeccion(ctx.sucursalId, new Date(desdeStr), new Date(hastaStr), ctx.db);

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

      {rep.productosSinSeccion.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-amber-700 dark:text-amber-600">Productos con ventas que no se ven en ninguna sección de carta</h2>
          <ul className="list-disc pl-5 text-sm">
            {rep.productosSinSeccion.map((c) => (
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
