import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { obtenerComparativaPreciosPorInsumo } from "@/server/actions/proveedor-por-producto";

export default async function ComparativaPreciosPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "comparar_precios");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const comparativa = await obtenerComparativaPreciosPorInsumo();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Comparativa de precios por insumo</h1>
      {comparativa.length === 0 && <p className="text-sm text-neutral-500">Todavía no hay compras cargadas.</p>}
      {comparativa.map((fila) => (
        <div key={fila.insumo} className="rounded border p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-medium">{fila.insumo}</h2>
            {fila.grupo && <span className="text-xs text-neutral-500">{fila.grupo}</span>}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500">
                <th>Proveedor</th>
                <th>Precio / unidad de stock</th>
                <th>Unidad de compra</th>
                <th>Última compra</th>
              </tr>
            </thead>
            <tbody>
              {fila.todas.map((oferta, i) => (
                <tr key={i} className={oferta === fila.masBarato ? "font-medium text-green-700" : ""}>
                  <td>{oferta.proveedorNombre}</td>
                  <td>{oferta.precioPorUnidadStock > 0 ? oferta.precioPorUnidadStock.toFixed(2) : "sin precio"}</td>
                  <td>{oferta.unidadCompraNombre}</td>
                  <td>{new Date(oferta.ultimaCompra).toLocaleDateString("es-AR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
