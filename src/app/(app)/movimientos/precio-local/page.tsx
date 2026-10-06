import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVer } from "@/server/acceso/gate";
import { listarPreciosLocales, setPrecioLocalProducto } from "@/server/actions/movimientos/precio-local";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import { FormConResultado } from "@/components/form-con-resultado";
import { PrecioLocalForm } from "./precio-local-form";

export default async function PrecioLocalPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "precio_local", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const precios = await listarPreciosLocales(ctx.sucursalId);

  return (
    // minmax(0,1fr) y no 1fr: un `1fr` pelado tiene mínimo automático (el ancho mínimo de la tabla) y, junto a los 380 px del formulario, empujaba la
    // PÁGINA a scroll horizontal a 1024 px. Con minmax(0,…) la tabla se achica a su columna y, si no entra, scrollea dentro de su contenedor.
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div>
        <h1 className="mb-4 text-xl font-semibold">Precio local (override por sucursal del precio de venta)</h1>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="py-2">Producto</th>
                <th>Precio local</th>
                <th>Precio global</th>
                <th>Habilitado</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {precios.map((p) => {
                // Primitivos fuera del closure: lo que captura un closure "use server" viaja al cliente, y un Decimal de Prisma no puede
                // viajar ("Only plain objects can be passed to Client Components...", warning del servidor de desarrollo).
                const { productoId, habilitado } = p;
                const precio = Number(p.precio);
                return (
                  <tr key={p.id} className="border-b align-top">
                    <td className="py-2">{p.producto.nombre}</td>
                    <td>{precio}</td>
                    <td>{Number(p.producto.precioVenta)}</td>
                    <td>{habilitado ? "Sí" : "No"}</td>
                    <td>
                      <FormConResultado
                        accion={async () => {
                          "use server";
                          const r = await setPrecioLocalProducto(productoId, precio, !habilitado);
                          // El refresco se pide ACÁ y no en la acción: la acción también la usa el formulario cliente de alta, que ya hace su propio
                          // router.refresh() (ver refrescar.ts). Sin esto la columna «Habilitado» no cambiaba hasta recargar a mano.
                          // Solo si salió bien: con un error no cambió nada.
                          if (r.ok) refrescarVistaSiHaceFalta();
                          return r;
                        }}
                      >
                        <button type="submit" className="text-sm underline">
                          {habilitado ? "Deshabilitar" : "Habilitar"}
                        </button>
                      </FormConResultado>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <PrecioLocalForm sucursalId={ctx.sucursalId} />
      </div>
    </div>
  );
}
