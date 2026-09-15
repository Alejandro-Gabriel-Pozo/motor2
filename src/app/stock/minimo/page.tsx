import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarSeccionesActivas } from "@/server/actions/secciones";
import { listarStockMinimo, eliminarStockMinimo } from "@/server/actions/stock-minimo";
import { StockMinimoForm } from "./stock-minimo-form";

export default async function StockMinimoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "stock_minimo");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [filas, secciones] = await Promise.all([listarStockMinimo(ctx.sucursalId), listarSeccionesActivas(ctx.sucursalId)]);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_380px]">
      <div>
        <h1 className="mb-4 text-xl font-semibold">Stock mínimo</h1>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2">Producto</th>
              <th>Sección</th>
              <th>Mínimo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} className="border-b">
                <td className="py-2">{f.producto.nombre}</td>
                <td>{f.seccion?.nombre ?? "Global (toda la sucursal)"}</td>
                <td>{Number(f.minimo)}</td>
                <td>
                  <form
                    action={async () => {
                      "use server";
                      await eliminarStockMinimo(f.id);
                    }}
                  >
                    <button type="submit" className="text-sm underline">
                      Eliminar
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <StockMinimoForm secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))} />
      </div>
    </div>
  );
}
