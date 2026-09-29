import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { generarReporteDiferenciasAjustes } from "@/core/reportes/diferencias-ajustes";
import { TablaDiferenciasAjuste } from "./tabla-diferencias";

export default async function DiferenciasPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_control", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const filas = await generarReporteDiferenciasAjustes(ctx.sucursalId);

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
