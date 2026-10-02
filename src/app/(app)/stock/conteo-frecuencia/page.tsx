import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { EnlaceInterno } from "@/components/enlace-interno";
import { listarFrecuenciasConteo } from "@/server/actions/stock/frecuencia-conteo";
import { sugerirInsumosClaseA } from "@/core/stock/sugerencia-clase-a";
import { resolverRangoPorDefecto } from "@/core/reportes/rango-por-defecto";
import { ConteoFrecuenciaForm } from "./conteo-frecuencia-form";
import { BotonEliminarFrecuenciaConteo } from "./boton-eliminar";
import { IconoDeAccion } from "@/components/iconos";

/**
 * Agenda de conteo físico periódico por sucursal × producto (decisión 2 de
 * §3, "conteos físicos periódicos", comprometida por el dueño 2026-09-22 —
 * docs/plan-rendimiento-recetas-2026-09-22.md §E, sub-plan S). Clon de
 * `/stock/minimo` (plan S5): mismo patrón de tabla + formulario de
 * alta/edición + eliminar. `frecuenciaDias = 0` desactiva la agenda sin
 * borrar la fila.
 */
export default async function ConteoFrecuenciaPage({ searchParams }: { searchParams: Promise<{ editar?: string; sugerido?: string; sugeridoNombre?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "conteo_frecuencia", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { editar, sugerido, sugeridoNombre } = await searchParams;
  const rango = resolverRangoPorDefecto(undefined);
  const [filas, sugerencias] = await Promise.all([
    listarFrecuenciasConteo(ctx.sucursalId),
    sugerirInsumosClaseA(ctx.sucursalId, new Date(rango.desdeISO), new Date(rango.hastaISO), ctx.db),
  ]);
  const filaEnEdicion = editar ? filas.find((f) => f.id === editar) : undefined;
  const idsConAgenda = new Set(filas.filter((f) => f.frecuenciaDias > 0).map((f) => f.productoId));
  const sugerenciasSinAgenda = sugerencias.filter((s) => !idsConAgenda.has(s.productoId));
  // El link puede venir de la lista de sugerencias de acá abajo, o de "Configurar agenda" en /reportes/diferencias (S6) —
  // ese segundo caso trae el nombre por query (`sugeridoNombre`) para no tener que ir a buscarlo de nuevo a la base.
  const sugeridoElegido = sugerido ? (sugerencias.find((s) => s.productoId === sugerido) ?? (sugeridoNombre ? { productoId: sugerido, nombre: sugeridoNombre } : undefined)) : undefined;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_380px]">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Frecuencia de conteo</h1>
        <p className="mb-4 text-sm text-neutral-500">
          Cada cuánto conviene volver a contar físicamente cada producto en esta sucursal. Sin fila = sin agenda: no se sugiere
          como pendiente en{" "}
          <EnlaceInterno href="/reportes/diferencias" className="underline">
            Diferencias de ajuste
          </EnlaceInterno>
          .
        </p>

        {sugerenciasSinAgenda.length > 0 && (
          <div className="mb-6 rounded border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
            <p className="mb-2 font-medium text-amber-800 dark:text-amber-500">
              Estos insumos concentran el 80% de lo comprado en los últimos 30 días y todavía no tienen agenda de conteo:
            </p>
            <ul className="flex flex-col gap-1">
              {sugerenciasSinAgenda.map((s) => (
                <li key={s.productoId} className="flex items-center justify-between gap-2">
                  <span>
                    {s.nombre} <span className="text-neutral-500">(${s.importe.toLocaleString("es-AR")})</span>
                  </span>
                  <Link href={`/stock/conteo-frecuencia?sugerido=${s.productoId}`} className="text-sm underline">
                    Agendar semanal
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2">Producto</th>
              <th>Cada cuántos días</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} className="border-b">
                <td className="py-2">{f.producto.nombre}</td>
                <td>{f.frecuenciaDias === 0 ? "Desactivada" : `${f.frecuenciaDias} día(s)`}</td>
                <td>
                  {/* El flex va en un div y no en el <td>: un <td> con display:flex deja de ser celda de tabla y se desalinea de su columna. */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <Link href={`/stock/conteo-frecuencia?editar=${f.id}`} className="text-sm underline inline-flex items-center gap-1">
                      <IconoDeAccion id="editar" />
                      Editar
                    </Link>
                    <BotonEliminarFrecuenciaConteo id={f.id} etiqueta={`"${f.producto.nombre}"`} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        {filaEnEdicion && (
          <Link href="/stock/conteo-frecuencia" className="mb-2 inline-block text-sm underline">
            ← Cancelar edición
          </Link>
        )}
        <ConteoFrecuenciaForm
          key={filaEnEdicion?.id ?? sugeridoElegido?.productoId ?? "nuevo"}
          filaEnEdicion={filaEnEdicion ? { productoId: filaEnEdicion.productoId, productoEtiqueta: `${filaEnEdicion.producto.codigo} — ${filaEnEdicion.producto.nombre}`, frecuenciaDias: String(filaEnEdicion.frecuenciaDias) } : undefined}
          productoIdSugerido={!filaEnEdicion ? sugeridoElegido?.productoId : undefined}
          productoEtiquetaSugerida={!filaEnEdicion ? sugeridoElegido?.nombre : undefined}
        />
      </div>
    </div>
  );
}
