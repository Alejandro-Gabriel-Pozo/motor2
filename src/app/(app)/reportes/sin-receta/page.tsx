import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { generarReporteVentasSinReceta } from "@/core/reportes/ventas-sin-receta";
import { TablaVentasSinReceta } from "./tabla-sin-receta";

export default async function VentasSinRecetaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_catalogo", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const filas = await generarReporteVentasSinReceta(ctx.sucursalId, ctx.db);

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
