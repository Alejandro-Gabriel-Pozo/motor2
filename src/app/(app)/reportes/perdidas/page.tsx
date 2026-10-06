import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { diasAtrasDeUrl } from "@/core/reportes/public";
import { generarReportePerdidas } from "@/core/reportes/public-servidor";
import { requierePermisoVer } from "@/server/acceso/gate";
import { TablaMermas, TablaConsumoInterno } from "./tabla-perdidas";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

export default async function PerdidasPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"dias">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_perdidas", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  const dias = diasAtrasDeUrl(sp.dias, 30);
  const rep = await generarReportePerdidas(ctx.sucursalId, dias, ctx.db);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Pérdidas y consumo interno</h1>
        <form className="flex items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Días atrás
            <input type="number" name="dias" min={1} defaultValue={dias} className="w-24 rounded border px-3 py-2" />
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Actualizar
          </button>
        </form>
        <p className="mt-2 text-sm text-neutral-500">
          Desde {rep.desde.toISOString().slice(0, 10)} — merma total: ${rep.totalMerma.toLocaleString("es-AR")}, consumo interno total: $
          {rep.totalConsumo.toLocaleString("es-AR")}.
        </p>
        {rep.hayCostoIncompleto && <p className="text-xs text-amber-700 dark:text-amber-600">Algún producto no tiene costo de reposición conocido: no se suma al valor total.</p>}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Mermas por motivo</h2>
        <TablaMermas filas={rep.mermas} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Consumo interno por destino</h2>
        <TablaConsumoInterno filas={rep.consumos} />
      </div>
    </div>
  );
}
