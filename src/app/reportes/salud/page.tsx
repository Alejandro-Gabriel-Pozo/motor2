import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { generarReporteSaludPorProducto } from "@/core/reportes/salud-por-producto";

export default async function SaludPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const filas = await generarReporteSaludPorProducto(ctx.sucursalId);
  const conAtencion = filas.filter((f) => f.resumen === "Atención").length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Salud por producto</h1>
        <p className="text-sm text-neutral-500">
          Cruce de Stock Consolidado, Alertas, Diferencias de Ajuste e Insumos sin receta — no reemplaza a ninguno, resume si algún eje tiene algo
          para revisar. {conAtencion} de {filas.length} fila(s) necesitan atención.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-1">Producto</th>
            <th>Sección</th>
            <th>Consolidado</th>
            <th>Alerta</th>
            <th>Diferencias</th>
            <th>Sin receta</th>
            <th>Resumen</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-b">
              <td className="py-1">{f.codigo} — {f.producto}</td>
              <td>{f.seccionNombre}</td>
              <td>{f.estadoConsolidado}</td>
              <td>{f.estadoAlerta}</td>
              <td>{f.estadoDiferencias}</td>
              <td>{f.sinRecetaVinculada ? "Sí" : "No"}</td>
              <td className={f.resumen === "Atención" ? "text-red-600 font-medium" : "text-neutral-500"}>{f.resumen}</td>
            </tr>
          ))}
          {!filas.length && (
            <tr>
              <td className="py-1 text-neutral-500" colSpan={7}>
                Sin productos con movimientos o conteos todavía.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
