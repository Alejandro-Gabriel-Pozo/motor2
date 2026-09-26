import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { obtenerReporteDescuentosClientes } from "@/core/reportes/descuentos-clientes";
import { resolverRangoDeReporte } from "@/core/reportes/rango-por-defecto";
import { SelectorRango } from "@/components/selector-rango";
import { TablaDescuentosClientes } from "./tabla-descuentos-clientes";

/**
 * Descuentos por cliente (Task #14, docs/plan-clientes-descuento-2026-09-26.md, punto 10 — último del plan): cuánto se "regaló"
 * en el rango, por cliente, y si ese descuento dejó el margen sano — comparando el Margen Real de lo COBRADO contra el que hubiera
 * dado la misma venta a precio de lista (`src/core/reportes/descuentos-clientes.ts`). Mismo permiso que el resto de los reportes
 * de dinero (`ver_reportes_dinero`, sin migración de permisos nueva) y mismo selector de rango que Período/Promociones.
 *
 * Sin ninguna venta con cliente asignado en el rango: tabla vacía, sin ningún error — un cliente que existe pero no compró en el
 * rango simplemente no sale listado (no hay ninguna fila "en 0" que mostrar).
 */
export default async function DescuentosClientesPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; rango?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_dinero");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const rango = resolverRangoDeReporte(sp);
  const rep = await obtenerReporteDescuentosClientes(ctx.sucursalId, new Date(rango.desdeISO), new Date(rango.hastaISO));

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
