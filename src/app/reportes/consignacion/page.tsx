import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { generarReporteConsignacion } from "@/core/reportes/consignacion";

export default async function ConsignacionPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const rep = await generarReporteConsignacion(ctx.sucursalId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Consignación</h1>
        <p className="text-sm text-neutral-500">Cuánto se le debe a cada consignante, y cuánto stock en consignación queda sin vender.</p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Debido por consignante</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1">Proveedor</th>
              <th>Importe</th>
            </tr>
          </thead>
          <tbody>
            {rep.debidoPorConsignante.map((d, i) => (
              <tr key={i} className="border-b">
                <td className="py-1">{d.proveedor}</td>
                <td>${d.importe.toLocaleString("es-AR")}</td>
              </tr>
            ))}
            {!rep.debidoPorConsignante.length && (
              <tr>
                <td className="py-1 text-neutral-500" colSpan={2}>
                  Sin liquidaciones de consignación registradas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Stock en consignación sin vender</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1">Producto</th>
              <th>Consignante</th>
              <th>Stock actual</th>
            </tr>
          </thead>
          <tbody>
            {rep.stockSinVender.map((s) => (
              <tr key={s.productoId} className="border-b">
                <td className="py-1">{s.codigo} — {s.producto}</td>
                <td>{s.proveedorConsignacionNombre ?? "—"}</td>
                <td className={s.stockActual <= 0 ? "text-red-600" : ""}>{s.stockActual}</td>
              </tr>
            ))}
            {!rep.stockSinVender.length && (
              <tr>
                <td className="py-1 text-neutral-500" colSpan={3}>
                  Ningún producto activo está marcado como consignación.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
