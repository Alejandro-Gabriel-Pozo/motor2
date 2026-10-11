import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { resolverRangoDeReporte } from "@/core/reportes/public";
import { rangoDeDias } from "@/core/tiempo/zona-horaria";
import { obtenerReporteDescuentosProductos } from "@/server/consultas/reportes/descuentos-productos";
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
  // S-28 (I-3): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_descuentos_productos", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  const rango = resolverRangoDeReporte(sp, new Date(), ctx.empresaZonaHoraria);
  // La consulta filtra `gte`/`lte` sobre lo que recibe: los días del rango se expanden acá, en la zona de la empresa (P1, O.251), para que el último día entre entero.
  const { desde, hasta } = rangoDeDias(new Date(rango.desdeISO), new Date(rango.hastaISO), ctx.empresaZonaHoraria);
  const rep = await obtenerReporteDescuentosProductos(ctx.sucursalId, desde, hasta, ctx.db);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Descuentos de productos</h1>
        <p className="text-sm text-neutral-500">
          Cuánto se ahorraron los clientes por el descuento que la carta le pone a un producto (Carta › producto › «Descuento»), sobre las ventas de mesa. Una
          venta con un cliente con descuento propio mayor no se cuenta acá: va en «Descuentos por cliente» (rige solo el mayor).
        </p>
      </div>

      <SelectorRango opcion={rango.opcion} desdeISO={rango.desdeISO} hastaISO={rango.hastaISO} recortadoDesde={rango.recortadoDesde} />

      <h2 className="text-sm font-medium">
        ${rep.ahorro.toLocaleString("es-AR")} de ahorro{rep.descuentoEfectivoPct !== null ? ` (${rep.descuentoEfectivoPct}% del precio de lista)` : ""} — $
        {rep.importeALista.toLocaleString("es-AR")} de lista → ${rep.importeCobrado.toLocaleString("es-AR")} cobrados
      </h2>

      <TablaDescuentosProductos filas={rep.productos} />
    </div>
  );
}
