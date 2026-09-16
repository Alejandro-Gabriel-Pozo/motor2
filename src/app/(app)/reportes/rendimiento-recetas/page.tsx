import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { calcularRendimientoRecetasSimples, type FilaRendimientoSimple } from "@/core/reportes/rendimiento-recetas";

function primerDiaDelMesISO() {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

const ETIQUETA_CONFIANZA: Record<FilaRendimientoSimple["confianza"], string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
  sin_datos: "Sin datos",
};

/**
 * Fase 1 del diseño (docs/diseno-rendimiento-recetas-por-sucursal.md):
 * compara la receta cargada contra lo que las compras/ventas reales de
 * ESTA sucursal sugieren que realmente se consume — solo para el caso
 * simple (un producto/insumo usado por un único plato). Corre siempre
 * para la sucursal activa, nunca mezclado con otras (ver §2.4 del
 * diseño: mezclar sucursales destruye la comparación entre cocineros).
 */
export default async function RendimientoRecetasPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; productoId?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const sp = await searchParams;
  const desdeStr = sp.desde || primerDiaDelMesISO();
  const hastaStr = sp.hasta || hoyISO();
  const todasLasFilas = await calcularRendimientoRecetasSimples(ctx.sucursalId, new Date(desdeStr), new Date(hastaStr));
  const filas = sp.productoId ? todasLasFilas.filter((f) => f.productoVentaId === sp.productoId) : todasLasFilas;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">
          Rendimiento real de recetas
          {sp.productoId && filas[0] && ` — ${filas[0].productoVentaNombre}`}
        </h1>
        {sp.productoId && (
          <Link href="/reportes/rendimiento-recetas" className="text-sm underline">
            Ver todos los platos
          </Link>
        )}
        <p className="mb-4 text-sm text-neutral-500">
          Compara la receta cargada contra lo que compras y ventas de esta sucursal sugieren que realmente se consume. Solo platos con un único
          ingrediente/insumo compartido — los que comparten un mismo insumo entre varios platos todavía no se calculan acá.
        </p>
        <form className="flex items-end gap-3 text-sm">
          {sp.productoId && <input type="hidden" name="productoId" value={sp.productoId} />}
          <label className="flex flex-col gap-1">
            Desde
            <input type="date" name="desde" defaultValue={desdeStr} className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            Hasta
            <input type="date" name="hasta" defaultValue={hastaStr} className="rounded border px-3 py-2" />
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
            Actualizar
          </button>
        </form>
      </div>

      {filas.length === 0 ? (
        <p className="text-sm text-neutral-500">No hay ningún ingrediente en el caso simple (un solo plato por insumo) para comparar todavía.</p>
      ) : (
        <table className="w-full max-w-4xl text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2">Plato</th>
              <th>Insumo</th>
              <th>Receta actual</th>
              <th>Rendimiento real</th>
              <th>Desvío</th>
              <th>Confianza</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.recetaIngredienteId} className="border-b">
                <td className="py-2">{f.productoVentaNombre}</td>
                <td>{f.insumoONombre}</td>
                <td>
                  {f.cantidadActual} {f.unidadRecetaNombre}
                </td>
                <td>
                  {f.cantidadEstimada !== null ? `${f.cantidadEstimada} ${f.unidadRecetaNombre}` : "—"}
                </td>
                <td className={f.desviacionPorcentaje !== null && Math.abs(f.desviacionPorcentaje) >= 10 ? "font-medium text-amber-600" : ""}>
                  {f.desviacionPorcentaje !== null ? `${f.desviacionPorcentaje > 0 ? "+" : ""}${f.desviacionPorcentaje}%` : "—"}
                </td>
                <td>{ETIQUETA_CONFIANZA[f.confianza]}</td>
                <td>
                  {f.cantidadEstimada !== null && (
                    <Link
                      href={`/catalogo/recetas/${f.productoVentaId}?editar=${f.insumoProductoId}&sugerido=${f.cantidadEstimada}`}
                      className="text-sm underline"
                    >
                      Usar este valor
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
