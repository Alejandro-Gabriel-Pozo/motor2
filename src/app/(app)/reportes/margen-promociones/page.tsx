import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVer } from "@/core/permisos/gate";
import { obtenerReporteMargenPromociones } from "@/core/reportes/margen-promociones";
import { resolverRangoDeReporte } from "@/core/reportes/rango-por-defecto";
import { SelectorRango } from "@/components/selector-rango";
import { TablaMargenPromociones } from "./tabla-margen-promociones";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

/**
 * Margen de promociones armables (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 12): por cada promo de carta, cuánto
 * entró prorrateado (D3) contra lo que hubiera entrado vendiendo cada componente suelto a precio de carta, y el Margen Real
 * de las dos formas (`src/core/reportes/margen-promociones.ts`). Su propia clave
 * (`reporte_margen_promociones`) y mismo selector de rango que Período/Descuentos por cliente.
 *
 * Sin ninguna venta de una promo armable en el rango: tabla vacía, sin ningún error.
 */
export default async function MargenPromocionesPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"desde" | "hasta" | "rango">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_margen_promociones", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  const rango = resolverRangoDeReporte(sp);
  const rep = await obtenerReporteMargenPromociones(ctx.sucursalId, new Date(rango.desdeISO), new Date(rango.hastaISO), ctx.db);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Margen de promociones</h1>
        <p className="text-sm text-neutral-500">
          Cuánto entró de verdad por cada promo ARMABLE (Catálogo › Carta, cupos) contra lo que hubiera entrado vendiendo cada
          componente suelto a precio de carta — y si el precio de la promo deja un margen sano. Una promo sin ninguna venta en
          el rango no aparece.
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
