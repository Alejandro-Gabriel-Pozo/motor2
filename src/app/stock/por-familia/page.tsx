import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { calcularStockPorFamilia } from "@/core/stock/por-familia";

export default async function StockPorFamiliaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_stock");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const filas = await calcularStockPorFamilia(ctx.sucursalId);

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Stock por familia (Insumo)</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Agrupa el stock de todos los productos (distintos proveedores/presentaciones) que comparten el mismo Insumo — solo MP con Insumo asignado.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Grupo</th>
            <th>Insumo</th>
            <th>Sección</th>
            <th>Saldo</th>
            <th>Productos incluidos</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={`${f.insumoId}-${f.seccionId}-${i}`} className="border-b">
              <td className="py-2">{f.grupoCadena || "Sin grupo"}</td>
              <td>{f.insumoNombre}</td>
              <td>{f.seccionNombre}</td>
              <td>
                {f.unidadesMezcladas ? (
                  <span className="text-amber-600" title="Unidades de stock distintas entre los productos de este Insumo — total no confiable">
                    Unidades mezcladas
                  </span>
                ) : (
                  `${f.saldo} ${f.unidadStockNombre ?? ""}`
                )}
              </td>
              <td className="text-neutral-500">{f.productos.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!filas.length && <p className="text-sm text-neutral-500">Ningún producto con movimientos tiene un Insumo asignado todavía.</p>}
    </div>
  );
}
