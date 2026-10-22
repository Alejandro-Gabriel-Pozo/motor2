import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/server/acceso/gate";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { obtenerHistorialConteosFisicos } from "@/server/actions/movimientos/lecturas-conteo-fisico";
import { listarStockParaConteo } from "@/server/consultas/movimientos/stock-para-conteo";
import { ConteoFisicoGrid, type FilaBaseConteo } from "./conteo-fisico-grid";
import { AccionesConteoPendiente, BotonCancelarConteo } from "./acciones-historial";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import { diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { Selector } from "@/ui/primitivas/selector";

const ESTADO_COLOR: Record<string, string> = {
  RESUELTO: "text-ok-tinta",
  PENDIENTE: "text-aviso-tinta",
  DESCARTADO: "text-tinta-tenue",
  CANCELADO: "text-tinta-tenue",
};

// El botón «Registrar conteo» manda toda la grilla en una sola llamada al servidor (registrarConteosFisicos), que recorre las
// filas una por una; una grilla grande tarda más que el límite por defecto de una función. Se aplica a todas las Server Actions de la página.
export const maxDuration = 60;

export default async function ConteoFisicoPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"seccionId">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "proceso_control", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;
  // Cortesía de la interfaz, no barrera: la acción exige `conteo_resolver_pendiente` (clave propia, antes compartía `proceso_control`).
  const { editar: puedeResolverPendiente } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "conteo_resolver_pendiente", ctx.db);
  // Igual: aplicar la diferencia al stock (AJUSTAR en la grilla, «Ajustar ahora» en un pendiente) exige además `proceso_ajuste` (S-09, D3).
  const { editar: puedeAjustar } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "proceso_ajuste", ctx.db);

  const sp = unicosDeUrl(await searchParams);
  const [secciones, { items: historial }] = await Promise.all([
    listarSeccionesActivas(ctx.sucursalId),
    obtenerHistorialConteosFisicos(ctx.sucursalId),
  ]);

  // Con una sola sección activa, no hace falta elegir — se precarga sola
  // (ver diseño acordado: "sección = sucursal entera" cuando hay una sola).
  const seccionElegida = sp.seccionId && secciones.some((s) => s.id === sp.seccionId) ? sp.seccionId : secciones.length === 1 ? secciones[0].id : "";

  const filasBase: FilaBaseConteo[] = seccionElegida
    ? (await listarStockParaConteo(seccionElegida, ctx.sucursalId, ctx.db)).map((f) => ({
        productoId: f.productoId,
        productoCodigo: f.productoCodigo,
        productoNombre: f.productoNombre,
        unidadStockNombre: f.unidadStockNombre,
        loteVencimiento: f.loteVencimiento ? f.loteVencimiento.toISOString().slice(0, 10) : null,
        saldoSistema: f.saldoSistema,
        esTotalDeLotes: f.esTotalDeLotes,
      }))
    : [];

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Conteo físico</h1>
        <p className="mb-4 text-sm text-tinta-tenue">
          La grilla trae precargado todo lo que ya tiene stock en la sección elegida — tipeá solo lo que difiere, dejá vacío lo que coincide.
        </p>
        <form className="mb-4 flex items-end gap-3 text-sm">
          <div className="min-w-0">
            <Selector etiqueta="Sección a contar" name="seccionId" defaultValue={seccionElegida}>
              <option value="">Elegí una sección</option>
              {secciones.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </Selector>
          </div>
          <BotonDeServidor type="submit">Cargar</BotonDeServidor>
        </form>

        {seccionElegida ? (
          <ConteoFisicoGrid seccionId={seccionElegida} filasBase={filasBase} puedeAjustar={puedeAjustar} />
        ) : (
          <p className="text-sm text-tinta-tenue">Elegí una sección para ver su grilla de conteo.</p>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Historial reciente</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-tinta-tenue">
              <th className="py-2 pr-2">Fecha</th>
              <th className="px-2">Producto</th>
              <th className="px-2">Sección</th>
              <th className="px-2">Sistema</th>
              <th className="px-2">Contado</th>
              <th className="px-2">Diferencia</th>
              <th className="px-2">Estado</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {historial.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="py-2 pr-2">{diaDeCalendario(c.fecha, ctx.empresaZonaHoraria)}</td>
                <td className="px-2">{c.producto.nombre}</td>
                <td className="px-2">{c.seccion.nombre}</td>
                <td className="px-2">{Number(c.saldoSistema)}</td>
                <td className="px-2">{Number(c.conteoReal)}</td>
                <td className="px-2">{Number(c.diferencia) > 0 ? "+" : ""}{Number(c.diferencia)}</td>
                <td className={`px-2 ${ESTADO_COLOR[c.estado]}`}>{c.estado}</td>
                <td className="px-2 py-2">
                  {c.estado === "PENDIENTE" && puedeResolverPendiente && <AccionesConteoPendiente conteoId={c.id} puedeAjustar={puedeAjustar} />}
                  {c.estado === "RESUELTO" && <BotonCancelarConteo conteoId={c.id} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
