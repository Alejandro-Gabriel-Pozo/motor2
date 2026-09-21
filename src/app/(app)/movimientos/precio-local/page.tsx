import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarPreciosLocales, setPrecioLocalProducto } from "@/server/actions/movimientos/precio-local";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import { PrecioLocalForm } from "./precio-local-form";

export default async function PrecioLocalPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "precio_local");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const precios = await listarPreciosLocales(ctx.sucursalId);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_380px]">
      <div>
        <h1 className="mb-4 text-xl font-semibold">Precio local (override por sucursal del precio de venta)</h1>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2">Producto</th>
              <th>Precio local</th>
              <th>Precio global</th>
              <th>Habilitado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {precios.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="py-2">{p.producto.nombre}</td>
                <td>{Number(p.precio)}</td>
                <td>{Number(p.producto.precioVenta)}</td>
                <td>{p.habilitado ? "Sí" : "No"}</td>
                <td>
                  <form
                    action={async () => {
                      "use server";
                      await setPrecioLocalProducto(p.productoId, Number(p.precio), !p.habilitado);
                      // El refresco se pide ACÁ y no en la acción: la acción también la usa el formulario cliente de alta, que ya hace su propio
                      // router.refresh() (ver refrescar.ts). Sin esto la columna «Habilitado» no cambiaba hasta recargar a mano.
                      refrescarVistaSiHaceFalta();
                    }}
                  >
                    <button type="submit" className="text-sm underline">
                      {p.habilitado ? "Deshabilitar" : "Habilitar"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <PrecioLocalForm />
      </div>
    </div>
  );
}
