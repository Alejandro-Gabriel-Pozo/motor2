import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerReportePromociones } from "@/core/reportes/promociones";
import { obtenerPromocionesHabilitadas, buscarProductoParaPromocion } from "@/server/actions/promociones";
import { PromocionForm } from "./promocion-form";
import { TablaPromociones } from "./tabla-promociones";

function primerDiaDelMesISO() {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function PromocionesPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const sp = await searchParams;
  const desdeStr = sp.desde || primerDiaDelMesISO();
  const hastaStr = sp.hasta || hoyISO();

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
      </div>

      <PromocionForm habilitado={habilitado} candidatos={candidatos} />

      {rep?.habilitado && (
        <div className="flex flex-col gap-2">
          <form className="flex items-end gap-3 text-sm">
            <label className="flex flex-col gap-1">
              Desde
              <input type="date" name="desde" defaultValue={desdeStr} className="rounded border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1">
              Hasta
              <input type="date" name="hasta" defaultValue={hastaStr} className="rounded border px-3 py-2" />
            </label>
            <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
              Actualizar
            </button>
          </form>
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
