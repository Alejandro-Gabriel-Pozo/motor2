import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { generarReporteDiferenciasAjustes } from "@/core/reportes/diferencias-ajustes";
import { TablaDiferenciasAjuste } from "./tabla-diferencias";

export default async function DiferenciasPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

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
