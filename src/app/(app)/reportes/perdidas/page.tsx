import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { diasAtrasDeUrl } from "@/core/reportes/public";
import { generarReportePerdidas } from "@/server/consultas/reportes/perdidas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { TablaMermas, TablaConsumoInterno } from "./tabla-perdidas";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import { diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { Campo } from "@/ui/primitivas/campo";

export default async function PerdidasPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"dias">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_perdidas", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  const dias = diasAtrasDeUrl(sp.dias, 30);
  // La hora se fija acá, en el borde (D.3a): el reporte la recibe por parámetro.
  const ahora = new Date();
  const rep = await generarReportePerdidas(ctx.sucursalId, dias, ctx.db, ahora, ctx.empresaZonaHoraria);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Pérdidas y consumo interno</h1>
        <form className="flex items-end gap-3 text-sm">
          <div className="w-24">
            <Campo etiqueta="Días atrás" type="number" name="dias" min={1} defaultValue={dias} />
          </div>
          <BotonDeServidor type="submit">Actualizar</BotonDeServidor>
        </form>
        <p className="mt-2 text-sm text-tinta-tenue">
          Desde {diaDeCalendario(rep.desde, ctx.empresaZonaHoraria)} — merma total: ${rep.totalMerma.toLocaleString("es-AR")}, consumo interno total: $
          {rep.totalConsumo.toLocaleString("es-AR")}.
        </p>
        {rep.hayCostoIncompleto && <p className="text-xs text-aviso-tinta">Algún producto no tiene costo de reposición conocido: no se suma al valor total.</p>}
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
