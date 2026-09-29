import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { obtenerReportePromociones } from "@/core/reportes/promociones";
import { resolverRangoDeReporte } from "@/core/reportes/rango-por-defecto";
import { obtenerPromocionesHabilitadas, buscarProductoParaPromocion } from "@/server/actions/reportes/promociones";
import { PromocionForm } from "./promocion-form";
import { TablaPromociones } from "./tabla-promociones";
import { SelectorRango } from "@/components/selector-rango";
import { EnlaceInterno } from "@/components/enlace-interno";

export default async function PromocionesPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; rango?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "promociones_config", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const rango = resolverRangoDeReporte(sp);
  const desdeStr = rango.desdeISO;
  const hastaStr = rango.hastaISO;

  const [habilitado, candidatos] = await Promise.all([
    obtenerPromocionesHabilitadas(ctx.sucursalId),
    buscarProductoParaPromocion(ctx.sucursalId, ""),
  ]);
  const rep = habilitado ? await obtenerReportePromociones(ctx.sucursalId, new Date(desdeStr), new Date(hastaStr)) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Promociones y Combos</h1>
        <p className="text-sm text-neutral-500">
          Feature opcional (apagada por defecto): separa la facturación en Promoción/Combo vs. a la carta, y calcula cuánto costarían sus insumos
          si se vendieran sueltos.
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          Esto marca qué PV cuenta como promoción (`PromocionProducto`) — no es una promo ARMABLE con componentes propios
          (Task #16, Catálogo › Carta, cupos).{" "}
          <EnlaceInterno href="/reportes/margen-promociones" className="underline">
            Ver «Margen de promociones» (las armables, con desglose por componente) →
          </EnlaceInterno>
        </p>
      </div>

      <PromocionForm habilitado={habilitado} candidatos={candidatos} />

      {rep?.habilitado && (
        <div className="flex flex-col gap-2">
          <SelectorRango opcion={rango.opcion} desdeISO={desdeStr} hastaISO={hastaStr} />
          <h2 className="text-sm font-medium">
            ${rep.totalFacturadoPromociones.toLocaleString("es-AR")} en promociones ({rep.porcentajePromociones}% del total)
          </h2>
          <p className="mb-2 text-xs text-neutral-500">{rep.aviso}</p>
          <TablaPromociones filas={rep.promociones} />
        </div>
      )}
    </div>
  );
}
