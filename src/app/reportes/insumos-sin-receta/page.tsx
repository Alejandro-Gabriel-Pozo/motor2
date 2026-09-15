import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { generarReporteInsumosSinRecetaVinculada } from "@/core/reportes/insumos-sin-receta";

export default async function InsumosSinRecetaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const filas = await generarReporteInsumosSinRecetaVinculada();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Insumos sin vincular a receta</h1>
        <p className="text-sm text-neutral-500">Una MP activa que no aparece en ninguna receta vigente se compra pero nada la consume ni la revende todavía.</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-1">Producto</th>
            <th>Insumo</th>
            <th>Tiene proveedor</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.productoId} className="border-b">
              <td className="py-1">{f.codigo} — {f.producto}</td>
              <td>{f.insumoNombre ?? "—"}</td>
              <td>{f.tieneProveedor ? "Sí" : <span className="text-amber-600">No</span>}</td>
            </tr>
          ))}
          {!filas.length && (
            <tr>
              <td className="py-1 text-neutral-500" colSpan={3}>
                Todas las materias primas activas están vinculadas a alguna receta.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
