import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { EnlaceInterno } from "@/components/enlace-interno";
import { listarComprasRegistradas, SIN_PROVEEDOR } from "@/core/reportes/compras-registradas";
import { listarProveedores } from "@/server/actions/catalogo/proveedores";

const fechaCorta = (f: Date) => f.toISOString().slice(0, 10);
const plata = (n: number) => `$${n.toLocaleString("es-AR")}`;

/**
 * Compras registradas, una fila por factura. Antes una compra solo se veía por el historial de un producto o por su ID de operación: no
 * había forma de ver qué se le compró a un proveedor, con qué factura, cuándo y por cuánto. Es de solo lectura.
 */
export default async function ComprasRegistradasPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; proveedorId?: string; factura?: string; cursor?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_dinero");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const desde = sp.desde && !Number.isNaN(new Date(sp.desde).getTime()) ? sp.desde : "";
  const hasta = sp.hasta && !Number.isNaN(new Date(sp.hasta).getTime()) ? sp.hasta : "";
  const [{ items, nextCursor }, proveedores] = await Promise.all([
    listarComprasRegistradas(ctx.sucursalId, {
      desde: desde ? new Date(desde) : undefined,
      hasta: hasta ? new Date(hasta) : undefined,
      proveedorId: sp.proveedorId || undefined,
      factura: sp.factura || undefined,
      cursor: sp.cursor,
    }),
    listarProveedores(),
  ]);

  const paramsSiguiente = new URLSearchParams();
  if (desde) paramsSiguiente.set("desde", desde);
  if (hasta) paramsSiguiente.set("hasta", hasta);
  if (sp.proveedorId) paramsSiguiente.set("proveedorId", sp.proveedorId);
  if (sp.factura) paramsSiguiente.set("factura", sp.factura);
  if (nextCursor) paramsSiguiente.set("cursor", nextCursor);

  const totalPagina = items.reduce((suma, c) => suma + c.total, 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Compras registradas</h1>
        <p className="text-sm text-neutral-500">
          Una fila por factura, con lo que se compró en cada una. Más recientes primero. Es de solo lectura: una compra ya cargada todavía no se puede corregir ni anular.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Desde
          <input type="date" name="desde" defaultValue={desde} className="rounded border px-2 py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          Hasta
          <input type="date" name="hasta" defaultValue={hasta} className="rounded border px-2 py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          Proveedor
          <select name="proveedorId" defaultValue={sp.proveedorId ?? ""} className="rounded border px-2 py-1.5">
            <option value="">Todos</option>
            <option value={SIN_PROVEEDOR}>Sin proveedor</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
                {p.activo ? "" : " (inactivo)"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          N.º de factura
          <input name="factura" defaultValue={sp.factura ?? ""} placeholder="contiene…" className="rounded border px-2 py-1.5" />
        </label>
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Filtrar
        </button>
        <Link href="/reportes/compras" className="self-center text-sm underline">
          Limpiar
        </Link>
      </form>

      {items.length === 0 ? (
        <p className="text-sm text-neutral-500">No hay compras registradas con estos filtros.</p>
      ) : (
        <>
          <p className="text-xs text-neutral-500">
            {items.length} compra(s) en esta página · suman {plata(Math.round(totalPagina * 100) / 100)}
          </p>
          <div className="flex flex-col gap-2">
            {items.map((c) => (
              <details key={c.idOperacion} className="rounded border" data-compra={c.idOperacion}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                  <span className="w-24 tabular-nums">{fechaCorta(c.fecha)}</span>
                  {c.proveedorNombre ? (
                    <span className="font-medium">{c.proveedorNombre}</span>
                  ) : (
                    <span className="font-medium text-amber-600" title="Esta compra se cargó sin proveedor">
                      Sin proveedor
                    </span>
                  )}
                  <span className="text-neutral-500">{c.nroFactura ? `Factura ${c.nroFactura}` : "sin N.º de factura"}</span>
                  <span className="text-neutral-500">{c.lineas.length} línea(s)</span>
                  <span className="ml-auto font-semibold tabular-nums">
                    {plata(c.total)}
                    {c.hayLineasSinPrecio && (
                      <span className="ml-1 text-xs font-normal text-amber-600" title="Alguna línea se cargó sin precio: el total no es el de la factura">
                        · hay líneas sin precio
                      </span>
                    )}
                  </span>
                </summary>
                <div className="border-t px-3 py-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-neutral-500">
                        <th className="px-2 py-1 font-normal">Producto</th>
                        <th className="px-2 py-1 text-right font-normal">Cantidad</th>
                        <th className="px-2 py-1 font-normal">Lote (vence)</th>
                        <th className="px-2 py-1 text-right font-normal">Precio total</th>
                        <th className="px-2 py-1 text-right font-normal">Por unidad de stock</th>
                        <th className="px-2 py-1 font-normal">Sección</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.lineas.map((l) => (
                        <tr key={l.idMovimiento} className="border-b last:border-0">
                          <td className="px-2 py-1">
                            {l.productoCodigo} — {l.productoNombre}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {l.cantidad.toLocaleString("es-AR")} {l.unidad}
                          </td>
                          <td className="px-2 py-1">{l.loteVencimiento ? fechaCorta(l.loteVencimiento) : "—"}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{l.precioTotal > 0 ? plata(l.precioTotal) : <span className="text-amber-600">sin precio</span>}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{l.precioPorUnidadStock > 0 ? plata(l.precioPorUnidadStock) : "—"}</td>
                          <td className="px-2 py-1">{l.seccionNombre}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-neutral-500">
                    Cargada por {c.cargadaPor}
                    {c.detalle ? ` · ${c.detalle}` : ""} ·{" "}
                    <EnlaceInterno href={`/reportes/trazabilidad?idOperacion=${encodeURIComponent(c.idOperacion)}`} className="underline">
                      ver la operación
                    </EnlaceInterno>
                  </p>
                </div>
              </details>
            ))}
          </div>
        </>
      )}

      {nextCursor && (
        <Link href={`/reportes/compras?${paramsSiguiente.toString()}`} className="text-sm underline">
          Página siguiente →
        </Link>
      )}
    </div>
  );
}
