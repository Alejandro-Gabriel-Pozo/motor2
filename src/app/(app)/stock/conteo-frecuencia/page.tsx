import { TablaDeStock } from "@/components/stock/tabla-de-stock";
import Link from "next/link";
import { FilaDeStock } from "@/components/fila-de-stock";
import { PESTANAS_DE_CONFIGURACION } from "@/core/stock/public";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/server/acceso/gate";
import { EnlaceInterno } from "@/components/enlace-interno";
import { AvisoSoloLecturaDeStock } from "@/components/stock/aviso-solo-lectura";
import { listarFrecuenciasConteo } from "@/server/actions/stock/frecuencia-conteo";
import { sugerirInsumosClaseA } from "@/server/consultas/stock/sugerencia-clase-a";
import { resolverRangoPorDefecto } from "@/core/reportes/public";
import { ConteoFrecuenciaForm } from "./conteo-frecuencia-form";
import { BotonEliminarFrecuenciaConteo } from "./boton-eliminar";
import { IconoDeAccion } from "@/components/iconos";
import { claseDeBoton } from "@/ui/primitivas/boton";
import { Enlace } from "@/ui/primitivas/enlace";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import { rangoDeDias } from "@/core/tiempo/zona-horaria";

/**
 * Agenda de conteo físico periódico por sucursal × producto (decisión 2 de
 * §3, "conteos físicos periódicos", comprometida por el dueño 2026-09-22 —
 * docs/plan-rendimiento-recetas-2026-09-22.md §E, sub-plan S). Clon de
 * `/stock/minimo` (plan S5): mismo patrón de tabla + formulario de
 * alta/edición + eliminar. `frecuenciaDias = 0` desactiva la agenda sin
 * borrar la fila.
 */
export default async function ConteoFrecuenciaPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"editar" | "sugerido" | "sugeridoNombre">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "conteo_frecuencia", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const { editar, sugerido, sugeridoNombre } = unicosDeUrl(await searchParams);
  // S-13: el gasto en compras por insumo es de `reporte_compras` (piso administrador), no de quien cuenta (`conteo_frecuencia`, piso operario). La consulta lo niega por defecto.
  const [{ ver: veImportes }, { editar: puedeEditar }] = await Promise.all([
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "reporte_compras", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "conteo_frecuencia", ctx.db),
  ]);
  const rango = resolverRangoPorDefecto(undefined, new Date(), ctx.empresaZonaHoraria);
  // Los dos extremos se cortan en la zona de la empresa (P1): el primer día desde las 00:00 y el último hasta las 23:59:59.999; las compras del formulario (mediodía argentino) tienen que entrar.
  const ventana = rangoDeDias(new Date(rango.desdeISO), new Date(rango.hastaISO), ctx.empresaZonaHoraria);
  const [filas, sugerencias] = await Promise.all([
    listarFrecuenciasConteo(ctx.sucursalId),
    sugerirInsumosClaseA(ctx.sucursalId, ventana.desde, ventana.hasta, ctx.db, { conImportes: veImportes }),
  ]);
  // DEC-33: con «Ver» solo no se abre ninguna fila en edición (ni con un `?editar=` a mano) ni se ofrece «Agendar semanal».
  const filaEnEdicion = editar && puedeEditar ? filas.find((f) => f.id === editar) : undefined;
  const idsConAgenda = new Set(filas.filter((f) => f.frecuenciaDias > 0).map((f) => f.productoId));
  const sugerenciasSinAgenda = sugerencias.filter((s) => !idsConAgenda.has(s.productoId));
  // El link puede venir de la lista de sugerencias de acá abajo, o de "Configurar agenda" en /reportes/diferencias (S6) —
  // ese segundo caso trae el nombre por query (`sugeridoNombre`) para no tener que ir a buscarlo de nuevo a la base.
  const sugeridoEnLista = sugerencias.find((s) => s.productoId === sugerido);
  const sugeridoElegido = sugerido ? (sugeridoEnLista ? { productoId: sugeridoEnLista.productoId, nombre: sugeridoEnLista.nombre } : sugeridoNombre ? { productoId: sugerido, nombre: sugeridoNombre } : undefined) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Configuración · Frecuencia de conteo</h1>
      <FilaDeStock ctx={ctx} etiqueta="Qué configurar" pestanas={PESTANAS_DE_CONFIGURACION} ruta="/stock/conteo-frecuencia" />
      {!puedeEditar && <AvisoSoloLecturaDeStock que="la frecuencia de conteo" />}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <p className="mb-4 text-sm text-tinta-tenue">
            Cada cuánto conviene volver a contar físicamente cada producto en esta sucursal. Sin fila = sin agenda: no se sugiere
            como pendiente en{" "}
            <EnlaceInterno href="/reportes/diferencias" className="underline">
              Diferencias de ajuste
            </EnlaceInterno>
            .
          </p>

          {puedeEditar && sugerenciasSinAgenda.length > 0 && (
            <div className="mb-6 rounded border border-aviso bg-aviso-tinte p-3 text-sm">
              <p className="mb-2 font-medium text-aviso-tinta">
                Estos insumos concentran el 80% de lo comprado en los últimos 30 días y todavía no tienen agenda de conteo:
              </p>
              <ul className="flex flex-col gap-1">
                {sugerenciasSinAgenda.map((s) => (
                  <li key={s.productoId} className="flex items-center justify-between gap-2">
                    <span>
                      {s.nombre} {s.importe !== undefined && <span className="text-tinta-tenue">(${s.importe.toLocaleString("es-AR")})</span>}
                    </span>
                    <Enlace href={`/stock/conteo-frecuencia?sugerido=${s.productoId}`}>Agendar semanal</Enlace>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <TablaDeStock etiqueta="Frecuencias de conteo cargadas">
            <thead>
              <tr className="border-b text-left text-tinta-tenue">
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
                    {puedeEditar && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <Link href={`/stock/conteo-frecuencia?editar=${f.id}`} className={claseDeBoton("enlace", "en-fila")}>
                          <IconoDeAccion id="editar" />
                          Editar
                        </Link>
                        <BotonEliminarFrecuenciaConteo id={f.id} etiqueta={`"${f.producto.nombre}"`} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TablaDeStock>
        </div>

        <div>
          {filaEnEdicion && (
            <p className="mb-2 text-sm">
              <Enlace href="/stock/conteo-frecuencia">← Cancelar edición</Enlace>
            </p>
          )}
          <ConteoFrecuenciaForm
            key={filaEnEdicion?.id ?? sugeridoElegido?.productoId ?? "nuevo"}
            soloLectura={!puedeEditar}
            filaEnEdicion={filaEnEdicion ? { productoId: filaEnEdicion.productoId, productoEtiqueta: `${filaEnEdicion.producto.codigo} — ${filaEnEdicion.producto.nombre}`, frecuenciaDias: String(filaEnEdicion.frecuenciaDias) } : undefined}
            productoIdSugerido={!filaEnEdicion ? sugeridoElegido?.productoId : undefined}
            productoEtiquetaSugerida={!filaEnEdicion ? sugeridoElegido?.nombre : undefined}
          />
        </div>
      </div>
    </div>
  );
}
