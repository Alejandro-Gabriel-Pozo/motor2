import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { generarReporteDiferenciasAjustes } from "@/server/consultas/reportes/diferencias-ajustes";
import { TablaDiferenciasAjuste } from "./tabla-diferencias";

export default async function DiferenciasPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_diferencias", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  // La hora se fija acá, en el borde (D.3a): el reporte la recibe por parámetro.
  const ahora = new Date();
  const filas = await generarReporteDiferenciasAjustes(ctx.sucursalId, ctx.db, ahora);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Diferencias de ajuste</h1>
        <p className="text-sm text-neutral-500">
          MP sin receta asociada: un Ajuste ahí es una anomalía a revisar. MP que solo se descuenta por receta: la diferencia es esperable (señal para
          recalibrar la Merma % de la receta).
        </p>
      </div>
      <TablaDiferenciasAjuste filas={filas} />
    </div>
  );
}
