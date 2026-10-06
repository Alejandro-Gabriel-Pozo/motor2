import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVer } from "@/server/acceso/gate";
import { resolverRangoDeReporte } from "@/core/reportes/public";
import { obtenerReporteDescuentosClientes } from "@/server/consultas/reportes/descuentos-clientes";
import { SelectorRango } from "@/components/selector-rango";
import { TablaDescuentosClientes } from "./tabla-descuentos-clientes";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

/**
 * Descuentos por cliente (Task #14, docs/plan-clientes-descuento-2026-09-26.md, punto 10 — último del plan): cuánto se "regaló"
 * en el rango, por cliente, y si ese descuento dejó el margen sano — comparando el Margen Real de lo COBRADO contra el que hubiera
 * dado la misma venta a precio de lista (`src/core/reportes/descuentos-clientes.ts`). Mismo permiso que el resto de los reportes
 * de dinero (`reporte_descuentos_clientes`) y mismo selector de rango que Período/Promociones.
 *
 * Sin ninguna venta con cliente asignado en el rango: tabla vacía, sin ningún error — un cliente que existe pero no compró en el
 * rango simplemente no sale listado (no hay ninguna fila "en 0" que mostrar).
 */
export default async function DescuentosClientesPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"desde" | "hasta" | "rango">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_descuentos_clientes", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  const rango = resolverRangoDeReporte(sp, new Date());
  const rep = await obtenerReporteDescuentosClientes(ctx.sucursalId, new Date(rango.desdeISO), new Date(rango.hastaISO), ctx.db);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Descuentos por cliente</h1>
        <p className="text-sm text-neutral-500">
          Cuánto se descontó, por cliente, sobre las ventas de mesa con un cliente asignado (Salón › mesa › «Cliente») — y si ese
          descuento dejó el margen sano. Un cliente sin ninguna venta en el rango no aparece.
        </p>
      </div>

      <SelectorRango opcion={rango.opcion} desdeISO={rango.desdeISO} hastaISO={rango.hastaISO} />

      <h2 className="text-sm font-medium">
        ${rep.totalDescontado.toLocaleString("es-AR")} descontados{rep.descuentoEfectivoPct !== null ? ` (${rep.descuentoEfectivoPct}% del precio de lista)` : ""} — $
        {rep.ingresoALista.toLocaleString("es-AR")} de lista → ${rep.ingresoCobrado.toLocaleString("es-AR")} cobrados
      </h2>
      <p className="mb-2 text-xs text-neutral-500">{rep.aviso}</p>

      <TablaDescuentosClientes filas={rep.clientes} />
    </div>
  );
}
