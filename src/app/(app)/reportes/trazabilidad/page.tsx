import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { buscarOperacionesPorProducto, obtenerOperacionPorId } from "@/core/reportes/trazabilidad";
import { anularVenta } from "@/server/actions/venta";
import { TablaOperacionesEncontradas, TablaItemsOperacion } from "./tabla-trazabilidad";

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
          <TablaOperacionesEncontradas filas={encontradas} />
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
          {operacion.proceso === "VENTA" &&
            (operacion.anuladaEn ? (
              <p className="mb-2 text-xs text-red-600">
                Anulada el {operacion.anuladaEn.toISOString().slice(0, 10)}
                {operacion.anuladaPorEmail && ` por ${operacion.anuladaPorEmail}`}.
              </p>
            ) : (
              <form
                action={async () => {
                  "use server";
                  await anularVenta(operacion.idOperacion);
                }}
                className="mb-2"
              >
                <button type="submit" className="text-sm text-red-600 underline">
                  Anular venta
                </button>
              </form>
            ))}
          <TablaItemsOperacion filas={operacion.items} nombreExport={`operacion-${operacion.idOperacion}`} />
        </div>
      )}
    </div>
  );
}
