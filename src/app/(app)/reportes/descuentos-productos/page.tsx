import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVer } from "@/server/acceso/gate";
import { resolverRangoDeReporte } from "@/core/reportes/public";
import { obtenerReporteDescuentosProductos } from "@/core/reportes/public-servidor";
import { SelectorRango } from "@/components/selector-rango";
import { TablaDescuentosProductos } from "./tabla-descuentos-productos";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

/**
 * Descuentos de productos (Fase 2 de promociones): cuánto se ahorraron los clientes en el rango por el descuento porcentual que la carta le pone a un
 * producto en esta sucursal (`src/core/reportes/descuentos-productos.ts`). Mismo permiso que el resto de los reportes de dinero
 * (`reporte_descuentos_productos`) y mismo selector de rango que «Descuentos por cliente».
 */
export default async function DescuentosProductosPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"desde" | "hasta" | "rango">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_descuentos_productos", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  const rango = resolverRangoDeReporte(sp, new Date());
  const rep = await obtenerReporteDescuentosProductos(ctx.sucursalId, new Date(rango.desdeISO), new Date(rango.hastaISO), ctx.db);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Descuentos de productos</h1>
        <p className="text-sm text-neutral-500">
          Cuánto se ahorraron los clientes por el descuento que la carta le pone a un producto (Carta › producto › «Descuento»), sobre las ventas de mesa. Una
          venta con un cliente con descuento propio mayor no se cuenta acá: va en «Descuentos por cliente» (rige solo el mayor).
        </p>
      </div>

      <SelectorRango opcion={rango.opcion} desdeISO={rango.desdeISO} hastaISO={rango.hastaISO} />

      <h2 className="text-sm font-medium">
        ${rep.ahorro.toLocaleString("es-AR")} de ahorro{rep.descuentoEfectivoPct !== null ? ` (${rep.descuentoEfectivoPct}% del precio de lista)` : ""} — $
        {rep.importeALista.toLocaleString("es-AR")} de lista → ${rep.importeCobrado.toLocaleString("es-AR")} cobrados
      </h2>

      <TablaDescuentosProductos filas={rep.productos} />
    </div>
  );
}
