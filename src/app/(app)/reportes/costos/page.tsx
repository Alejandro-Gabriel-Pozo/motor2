import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { calcularCostosYMargenes, calcularImpactoInsumos } from "@/core/reportes/costos";
import { TablaCostosProductos, TablaImpactoInsumos } from "./tabla-costos";

export default async function CostosPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const [productos, insumos] = await Promise.all([calcularCostosYMargenes(ctx.sucursalId), calcularImpactoInsumos(ctx.sucursalId)]);

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
