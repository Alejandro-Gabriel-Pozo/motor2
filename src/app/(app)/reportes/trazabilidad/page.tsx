import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { buscarOperacionesPorProducto, obtenerOperacionPorId } from "@/core/reportes/trazabilidad";
import { TablaOperacionesEncontradas, TablaItemsOperacion } from "./tabla-trazabilidad";
import { BotonAnularVenta } from "./boton-anular-venta";

export default async function TrazabilidadPage({ searchParams }: { searchParams: Promise<{ producto?: string; idOperacion?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_trazabilidad", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const operacion = sp.idOperacion ? await obtenerOperacionPorId(ctx.sucursalId, sp.idOperacion, ctx.db) : null;
  const encontradas = !sp.idOperacion && sp.producto ? await buscarOperacionesPorProducto(ctx.sucursalId, sp.producto, ctx.db) : [];

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
          {/* El cartel de «Anulada» vale para cualquier proceso; el botón para anular, solo para una venta vigente. */}
          {operacion.anuladaEn ? (
            <p className="mb-2 text-xs text-red-600">
              Anulada el {operacion.anuladaEn.toISOString().slice(0, 10)}
              {operacion.anuladaPorEmail && ` por ${operacion.anuladaPorEmail}`}.
            </p>
          ) : (
            operacion.proceso === "VENTA" && <BotonAnularVenta idOperacion={operacion.idOperacion} />
          )}
          <TablaItemsOperacion filas={operacion.items} nombreExport={`operacion-${operacion.idOperacion}`} />
        </div>
      )}
    </div>
  );
}
