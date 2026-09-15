import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { generarReporteVentasSinReceta } from "@/core/reportes/ventas-sin-receta";

export default async function VentasSinRecetaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const filas = await generarReporteVentasSinReceta(ctx.sucursalId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Ventas de PV sin receta</h1>
        <p className="text-sm text-neutral-500">Un PV se puede vender sin receta cargada (no descuenta stock de ninguna MP). Si dejó de aparecer acá a partir de una fecha, es la señal de que la receta ya está cargada.</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-1">Producto</th>
            <th>Ventas sin receta</th>
            <th>Primera</th>
            <th>Última</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.productoId} className="border-b">
              <td className="py-1">{f.codigo} — {f.producto}</td>
              <td>{f.cantidadVentasSinReceta}</td>
              <td>{f.primeraFecha.toISOString().slice(0, 10)}</td>
              <td>{f.ultimaFecha.toISOString().slice(0, 10)}</td>
            </tr>
          ))}
          {!filas.length && (
            <tr>
              <td className="py-1 text-neutral-500" colSpan={4}>
                Todas las ventas registradas generaron consumo de receta.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
