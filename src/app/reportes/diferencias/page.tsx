import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { generarReporteDiferenciasAjustes } from "@/core/reportes/diferencias-ajustes";

const LABEL_ESTADO: Record<string, string> = { REVISAR: "Revisar", ESPERADO: "Esperado", OK: "OK" };

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
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-1">Producto</th>
            <th>Grupo</th>
            <th>Suma ajustes</th>
            <th>Último ajuste</th>
            <th>Suma conteos</th>
            <th>Último conteo</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.productoId} className="border-b">
              <td className="py-1">{f.codigo} — {f.producto}</td>
              <td>{f.grupoTexto}</td>
              <td>{f.sumaAjustesManuales}</td>
              <td>{f.ultimaFechaAjuste ? f.ultimaFechaAjuste.toISOString().slice(0, 10) : "—"}</td>
              <td>{f.sumaConteosFisicos}</td>
              <td>{f.ultimaFechaConteo ? f.ultimaFechaConteo.toISOString().slice(0, 10) : "—"}</td>
              <td className={f.estado === "REVISAR" ? "text-red-600 font-medium" : f.estado === "ESPERADO" ? "text-amber-600" : ""}>{LABEL_ESTADO[f.estado]}</td>
            </tr>
          ))}
          {!filas.length && (
            <tr>
              <td className="py-1 text-neutral-500" colSpan={7}>
                Sin materias primas cargadas.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
