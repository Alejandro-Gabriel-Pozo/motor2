import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVer } from "@/server/acceso/gate";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { listarStockMinimo } from "@/server/actions/stock/stock-minimo";
import { StockMinimoForm } from "./stock-minimo-form";
import { BotonEliminarStockMinimo } from "./boton-eliminar";
import { IconoDeAccion } from "@/components/iconos";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

export default async function StockMinimoPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"editar">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "stock_minimo", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { editar } = unicosDeUrl(await searchParams);
  const [filas, secciones] = await Promise.all([listarStockMinimo(ctx.sucursalId), listarSeccionesActivas(ctx.sucursalId)]);
  const filaEnEdicion = editar ? filas.find((f) => f.id === editar) : undefined;

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
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} className="border-b">
                <td className="py-2">{f.producto.nombre}</td>
                <td>{f.seccion?.nombre ?? "Global (toda la sucursal)"}</td>
                <td>{Number(f.minimo)}</td>
                <td>
                  {/* El flex va en un div y no en el <td>: un <td> con display:flex deja de ser celda de tabla y se desalinea de su columna. */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <Link href={`/stock/minimo?editar=${f.id}`} className="text-sm underline inline-flex items-center gap-1">
                      <IconoDeAccion id="editar" />
                      Editar
                    </Link>
                    <BotonEliminarStockMinimo id={f.id} etiqueta={`"${f.producto.nombre}" en ${f.seccion?.nombre ?? "Global (toda la sucursal)"}`} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        {filaEnEdicion && (
          <Link href="/stock/minimo" className="mb-2 inline-block text-sm underline">
            ← Cancelar edición
          </Link>
        )}
        <StockMinimoForm
          key={filaEnEdicion?.id ?? "nuevo"}
          secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))}
          filaEnEdicion={
            filaEnEdicion
              ? {
                  productoId: filaEnEdicion.productoId,
                  productoEtiqueta: `${filaEnEdicion.producto.codigo} — ${filaEnEdicion.producto.nombre}`,
                  seccionId: filaEnEdicion.seccionId ?? "",
                  minimo: String(Number(filaEnEdicion.minimo)),
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
