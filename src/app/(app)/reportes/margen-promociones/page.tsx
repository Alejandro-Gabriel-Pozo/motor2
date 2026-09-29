import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { obtenerReporteMargenPromociones } from "@/core/reportes/margen-promociones";
import { resolverRangoDeReporte } from "@/core/reportes/rango-por-defecto";
import { SelectorRango } from "@/components/selector-rango";
import { EnlaceInterno } from "@/components/enlace-interno";
import { TablaMargenPromociones } from "./tabla-margen-promociones";

/**
 * Margen de promociones armables (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 12): por cada promo de carta, cuánto
 * entró prorrateado (D3) contra lo que hubiera entrado vendiendo cada componente suelto a precio de carta, y el Margen Real
 * de las dos formas (`src/core/reportes/margen-promociones.ts`). Mismo permiso que el resto de los reportes de dinero
 * (`ver_reportes_dinero`) y mismo selector de rango que Período/Descuentos por cliente.
 *
 * Cruza con `/reportes/promociones` (el reporte de promos de PRECIO de siempre, sin componentes): esa es otra cosa —
 * "PromoCarta" armable (Task #16) vs. una promoción de precio de un producto — el link de acá lo aclara para no confundirlas.
 *
 * Sin ninguna venta de una promo armable en el rango: tabla vacía, sin ningún error.
 */
export default async function MargenPromocionesPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; rango?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_dinero", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const rango = resolverRangoDeReporte(sp);
  const rep = await obtenerReporteMargenPromociones(ctx.sucursalId, new Date(rango.desdeISO), new Date(rango.hastaISO));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Margen de promociones</h1>
        <p className="text-sm text-neutral-500">
          Cuánto entró de verdad por cada promo ARMABLE (Catálogo › Carta, cupos) contra lo que hubiera entrado vendiendo cada
          componente suelto a precio de carta — y si el precio de la promo deja un margen sano. Una promo sin ninguna venta en
          el rango no aparece.{" "}
          <EnlaceInterno href="/reportes/promociones" className="underline">
            Ver también «Promociones» (rebajas de precio de un producto, sin componentes) →
          </EnlaceInterno>
        </p>
      </div>

      <SelectorRango opcion={rango.opcion} desdeISO={rango.desdeISO} hastaISO={rango.hastaISO} />

      <h2 className="text-sm font-medium">
        {rep.cantidadInstancias.toLocaleString("es-AR")} promos vendidas — ${rep.ingresoALista.toLocaleString("es-AR")} de carta → $
        {rep.ingresoCobrado.toLocaleString("es-AR")} cobrados (${rep.ahorroCliente.toLocaleString("es-AR")} de ahorro para el cliente)
      </h2>
      <p className="mb-2 text-xs text-neutral-500">{rep.aviso}</p>

      <TablaMargenPromociones filas={rep.promos} />
    </div>
  );
}
