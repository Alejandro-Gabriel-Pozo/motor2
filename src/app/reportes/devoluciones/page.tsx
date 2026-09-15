import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { generarReporteDevoluciones } from "@/core/reportes/devoluciones";

export default async function DevolucionesPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const sp = await searchParams;
  const dias = Number(sp.dias) > 0 ? Number(sp.dias) : 30;
  const rep = await generarReporteDevoluciones(ctx.sucursalId, dias);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Devoluciones</h1>
        <form className="flex items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Días atrás
            <input type="number" name="dias" min={1} defaultValue={dias} className="w-24 rounded border px-3 py-2" />
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Actualizar
          </button>
        </form>
        <p className="mt-2 text-sm text-neutral-500">
          Desde {rep.desde.toISOString().slice(0, 10)} — devuelto por clientes: ${rep.totalCliente.toLocaleString("es-AR")}, a proveedores: $
          {rep.totalProveedor.toLocaleString("es-AR")}.
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Devoluciones de clientes (revendibles)</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1">Producto</th>
              <th>Cantidad</th>
              <th>Valor</th>
            </tr>
          </thead>
          <tbody>
            {rep.clientes.map((c, i) => (
              <tr key={i} className="border-b">
                <td className="py-1">
                  {c.producto} {c.sinPrecio && <span className="text-amber-600">(sin precio)</span>}
                </td>
                <td>{c.cantidad}</td>
                <td>${c.valor.toLocaleString("es-AR")}</td>
              </tr>
            ))}
            {!rep.clientes.length && (
              <tr>
                <td className="py-1 text-neutral-500" colSpan={3}>
                  Sin devoluciones de clientes en el período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Devoluciones a proveedores</h2>
        {rep.proveedores.map((p) => (
          <div key={p.proveedor} className="mb-3">
            <p className="text-sm font-medium">
              {p.proveedor} — ${p.valor.toLocaleString("es-AR")}
            </p>
            <table className="w-full text-sm">
              <tbody>
                {p.productos.map((prod, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-1">{prod.producto}</td>
                    <td>{prod.cantidad}</td>
                    <td>${prod.valor.toLocaleString("es-AR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {!rep.proveedores.length && <p className="text-sm text-neutral-500">Sin devoluciones a proveedores en el período.</p>}
      </div>
    </div>
  );
}
