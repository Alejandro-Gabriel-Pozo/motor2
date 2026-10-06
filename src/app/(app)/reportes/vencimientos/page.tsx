import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { diasAtrasDeUrl } from "@/core/reportes/public";
import { obtenerReporteVencimientosDatos } from "@/server/consultas/reportes/vencimientos";
import { requierePermisoVer } from "@/server/acceso/gate";
import { TablaLotesVencimiento, TablaConciliacionVencimientos } from "./tabla-vencimientos";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

export default async function VencimientosPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"dias">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_vencimientos", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  const dias = diasAtrasDeUrl(sp.dias, 7);
  const rep = await obtenerReporteVencimientosDatos(ctx.sucursalId, dias, ctx.db);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Vencimientos</h1>
        <form className="flex items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Próximos (días)
            <input type="number" name="dias" min={1} defaultValue={rep.diasUsados} className="w-24 rounded border px-3 py-2" />
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Actualizar
          </button>
        </form>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Lotes próximos a vencer (incluye ya vencidos)</h2>
        <TablaLotesVencimiento filas={rep.proximosAVencer} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Conciliación (lotes contados que desaparecieron entre dos conteos)</h2>
        <TablaConciliacionVencimientos filas={rep.conciliacion} />
      </div>
    </div>
  );
}
