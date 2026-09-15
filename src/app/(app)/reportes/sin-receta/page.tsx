import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { generarReporteVentasSinReceta } from "@/core/reportes/ventas-sin-receta";
import { TablaVentasSinReceta } from "./tabla-sin-receta";

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
      <TablaVentasSinReceta filas={filas} />
    </div>
  );
}
