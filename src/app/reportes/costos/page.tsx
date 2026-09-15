import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { calcularCostosYMargenes, calcularImpactoInsumos } from "@/core/reportes/costos";

const LABEL_ESTADO: Record<string, string> = {
  MARGEN_NEGATIVO: "Margen negativo",
  FOOD_COST_ALTO: "Food cost alto",
  COSTO_INCOMPLETO: "Costo incompleto",
  SIN_PRECIO_VENTA: "Sin precio de venta",
  SIN_RECETA: "Sin receta",
  OK: "OK",
};

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

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-1">Producto</th>
            <th>Precio venta</th>
            <th>Costo</th>
            <th>Margen</th>
            <th>Food cost %</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr key={p.productoId} className="border-b">
              <td className="py-1">{p.productoCodigo} — {p.productoNombre}</td>
              <td>${p.precioVenta.toLocaleString("es-AR")}</td>
              <td>{p.costo === null ? "—" : `$${p.costo.toLocaleString("es-AR")}`}</td>
              <td>{p.margen === null ? "—" : `$${p.margen.toLocaleString("es-AR")} (${p.margenPct}%)`}</td>
              <td>{p.foodCostPct === null ? "—" : `${p.foodCostPct}%`}</td>
              <td className={p.estado === "OK" ? "" : "text-amber-600"}>{LABEL_ESTADO[p.estado]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div>
        <h2 className="mb-2 text-sm font-medium">Impacto de insumos (qué MP mueve más el costo total)</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1">Insumo</th>
              <th>Platos</th>
              <th>Costo acumulado</th>
              <th>Costo unitario</th>
              <th>Proveedor</th>
            </tr>
          </thead>
          <tbody>
            {insumos.map((i) => (
              <tr key={i.insumoProductoId} className="border-b">
                <td className="py-1">{i.insumoNombre}</td>
                <td>{i.cantidadPlatos}</td>
                <td>${i.costoAcumulado.toLocaleString("es-AR")}</td>
                <td>{i.costoUnitario === null ? "—" : `$${i.costoUnitario.toLocaleString("es-AR")}`}</td>
                <td>{i.proveedorNombre ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
