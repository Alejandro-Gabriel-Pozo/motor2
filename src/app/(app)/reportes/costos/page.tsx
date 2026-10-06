import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVer } from "@/core/permisos/gate";
import { calcularCostosYMargenes, calcularImpactoInsumos } from "@/core/reportes/costos";
import { cargarObjetivosDeMargen } from "@/core/reportes/margen-objetivo-consulta";
import { TablaCostosProductos, TablaImpactoInsumos } from "./tabla-costos";

export default async function CostosPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_costos", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const objetivos = await cargarObjetivosDeMargen(ctx.db);
  const [productos, insumos] = await Promise.all([
    calcularCostosYMargenes(ctx.sucursalId, ctx.db, undefined, undefined, objetivos),
    calcularImpactoInsumos(ctx.sucursalId, ctx.db),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Costos y márgenes</h1>
        <p className="text-sm text-neutral-500">Costo actual de cada plato (receta × costo de reposición local) y margen contra su precio de venta.</p>
      </div>

      <TablaCostosProductos filas={productos} />

      <div>
        <h2 className="mb-2 text-sm font-medium">Impacto de insumos (qué MP mueve más el costo total)</h2>
        <TablaImpactoInsumos filas={insumos} />
      </div>
    </div>
  );
}
