import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { buscarOperacionesPorProducto, obtenerOperacionPorId } from "@/core/reportes/trazabilidad";

export default async function TrazabilidadPage({ searchParams }: { searchParams: Promise<{ producto?: string; idOperacion?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const sp = await searchParams;
  const operacion = sp.idOperacion ? await obtenerOperacionPorId(ctx.sucursalId, sp.idOperacion) : null;
  const encontradas = !sp.idOperacion && sp.producto ? await buscarOperacionesPorProducto(ctx.sucursalId, sp.producto) : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Trazabilidad por ID Operación</h1>
        <form className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Buscar por producto
            <input type="text" name="producto" defaultValue={sp.producto ?? ""} placeholder="nombre o código" className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            o por ID Operación exacto
            <input type="text" name="idOperacion" defaultValue={sp.idOperacion ?? ""} className="rounded border px-3 py-2" />
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Buscar
          </button>
        </form>
      </div>

      {encontradas.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium">Operaciones encontradas</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="py-1">Fecha</th>
                <th>Proceso</th>
                <th>Sección</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {encontradas.map((e) => (
                <tr key={e.idOperacion} className="border-b">
                  <td className="py-1">{e.fecha.toISOString().slice(0, 10)}</td>
                  <td>{e.proceso}</td>
                  <td>{e.seccionNombre}</td>
                  <td>
                    <Link href={`/reportes/trazabilidad?idOperacion=${encodeURIComponent(e.idOperacion)}`} className="underline">
                      Ver operación
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sp.producto && !encontradas.length && !sp.idOperacion && <p className="text-sm text-neutral-500">Sin operaciones para ese producto.</p>}

      {sp.idOperacion && !operacion && <p className="text-sm text-red-600">No se encontró la operación &quot;{sp.idOperacion}&quot; en esta sucursal.</p>}

      {operacion && (
        <div>
          <h2 className="mb-2 text-sm font-medium">
            Operación {operacion.idOperacion} — {operacion.fecha.toISOString().slice(0, 10)} — {operacion.total} movimiento(s)
          </h2>
          {(operacion.proveedorNombre || operacion.nroFactura) && (
            <p className="mb-2 text-xs text-neutral-500">
              {operacion.proveedorNombre && `Proveedor: ${operacion.proveedorNombre}. `}
              {operacion.nroFactura && `Factura: ${operacion.nroFactura}.`}
            </p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="py-1">Producto</th>
                <th>Proceso</th>
                <th>Sección</th>
                <th>Cantidad</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {operacion.items.map((it) => (
                <tr key={it.idMovimiento} className="border-b">
                  <td className="py-1">{it.productoCodigo} — {it.productoNombre}</td>
                  <td>{it.proceso}</td>
                  <td>{it.seccionNombre}</td>
                  <td>{it.cantidad}</td>
                  <td>{it.detalle}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
