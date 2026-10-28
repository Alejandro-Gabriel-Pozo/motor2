import { TablaDeStock } from "@/components/stock/tabla-de-stock";
import Link from "next/link";
import { FilaDeStock } from "@/components/fila-de-stock";
import { PESTANAS_DE_CONFIGURACION } from "@/core/stock/public";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/server/acceso/gate";
import { AvisoSoloLecturaDeStock } from "@/components/stock/aviso-solo-lectura";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { listarStockMinimo } from "@/server/actions/stock/stock-minimo";
import { StockMinimoForm } from "./stock-minimo-form";
import { BotonEliminarStockMinimo } from "./boton-eliminar";
import { IconoDeAccion } from "@/components/iconos";
import { claseDeBoton } from "@/ui/primitivas/boton";
import { Enlace } from "@/ui/primitivas/enlace";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

export default async function StockMinimoPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"editar">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "stock_minimo", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const { editar } = unicosDeUrl(await searchParams);
  const [filas, secciones, { editar: puedeEditar }] = await Promise.all([
    listarStockMinimo(ctx.sucursalId),
    listarSeccionesActivas(ctx.sucursalId),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "stock_minimo", ctx.db),
  ]);
  // Una fila se abre en edición solo para quien puede editarla (DEC-33): con «Ver» solo, el enlace de Alertas o de Parámetros por insumo no llega, y un `?editar=` a mano no cambia nada.
  const filaEnEdicion = editar && puedeEditar ? filas.find((f) => f.id === editar) : undefined;
  const donde = (f: (typeof filas)[number]) => f.seccion?.nombre ?? "Global (toda la sucursal)";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Configuración · Stock mínimo</h1>
      <FilaDeStock ctx={ctx} etiqueta="Qué configurar" pestanas={PESTANAS_DE_CONFIGURACION} ruta="/stock/minimo" />
      {!puedeEditar && <AvisoSoloLecturaDeStock que="el stock mínimo" />}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <TablaDeStock etiqueta="Stock mínimo cargado">
            <thead>
              <tr className="border-b text-left text-tinta-tenue">
                <th className="py-2">Insumo</th>
                <th>Depósito</th>
                <th>Mínimo</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b">
                  <td className="py-2">{f.producto.nombre}</td>
                  <td>{donde(f)}</td>
                  <td>{Number(f.minimo).toLocaleString("es-AR")}</td>
                  <td>
                    {/* El flex va en un div y no en el <td>: un <td> con display:flex deja de ser celda de tabla y se desalinea de su columna. */}
                    {puedeEditar && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <Link href={`/stock/minimo?editar=${f.id}`} className={claseDeBoton("enlace", "en-fila")} aria-label={`Cambiar el mínimo de ${f.producto.nombre} (${donde(f)})`}>
                          <IconoDeAccion id="editar" />
                          Cambiar
                        </Link>
                        <BotonEliminarStockMinimo id={f.id} etiqueta={`"${f.producto.nombre}" en ${donde(f)}`} />
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
              <Enlace href="/stock/minimo">← Cancelar edición</Enlace>
            </p>
          )}
          <StockMinimoForm
            key={filaEnEdicion?.id ?? "nuevo"}
            soloLectura={!puedeEditar}
            secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))}
            filaEnEdicion={
              filaEnEdicion
                ? {
                    productoId: filaEnEdicion.productoId,
                    productoEtiqueta: `${filaEnEdicion.producto.codigo} — ${filaEnEdicion.producto.nombre}`,
                    seccionId: filaEnEdicion.seccionId ?? "",
                    donde: donde(filaEnEdicion),
                    minimo: String(Number(filaEnEdicion.minimo)),
                    minimoVisto: Number(filaEnEdicion.minimo),
                  }
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
