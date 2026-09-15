import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { generarReporteConsignacion } from "@/core/reportes/consignacion";
import { TablaDebidoConsignante, TablaStockSinVenderConsignacion } from "./tabla-consignacion";

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
        <TablaDebidoConsignante filas={rep.debidoPorConsignante} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Stock en consignación sin vender</h2>
        <TablaStockSinVenderConsignacion filas={rep.stockSinVender} />
      </div>
    </div>
  );
}
