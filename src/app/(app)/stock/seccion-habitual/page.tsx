import Link from "next/link";
import { FilaDeStock } from "@/components/fila-de-stock";
import { PESTANAS_DE_CONFIGURACION } from "@/core/stock/public";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/server/acceso/gate";
import { AvisoSoloLecturaDeStock } from "@/components/stock/aviso-solo-lectura";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { listarSeccionesHabituales } from "@/server/actions/stock/seccion-habitual";
import { SeccionHabitualForm } from "./seccion-habitual-form";
import { BotonQuitarSeccionHabitual } from "./boton-quitar";
import { IconoDeAccion } from "@/components/iconos";
import { claseDeBoton } from "@/ui/primitivas/boton";
import { Enlace } from "@/ui/primitivas/enlace";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

/**
 * Sección habitual de cada producto de venta en esta sucursal (docs/plan-seccion-habitual-stock-2026-09-25.md, C2): de qué sección de
 * stock sale PRIMERO lo que consume al cerrar una cuenta del salón. Mismo molde que `/stock/minimo` (tabla + formulario de alta/edición,
 * permiso propio `stock_seccion_habitual`). Un producto sin fila no tiene preferencia: sale de la sección con stock que vence antes.
 */
export default async function SeccionHabitualPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"editar">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "stock_seccion_habitual", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const { editar } = unicosDeUrl(await searchParams);
  const [filas, secciones, { editar: puedeEditar }] = await Promise.all([
    listarSeccionesHabituales(ctx.sucursalId),
    listarSeccionesActivas(ctx.sucursalId),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "stock_seccion_habitual", ctx.db),
  ]);
  // DEC-33: con «Ver» solo no se abre ninguna fila en edición (ni con un `?editar=` a mano).
  const filaEnEdicion = editar && puedeEditar ? filas.find((f) => f.id === editar) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Configuración · Depósito habitual</h1>
      <FilaDeStock ctx={ctx} etiqueta="Qué configurar" pestanas={PESTANAS_DE_CONFIGURACION} ruta="/stock/seccion-habitual" />
      {!puedeEditar && <AvisoSoloLecturaDeStock que="el depósito habitual de cada producto" />}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_380px]">
        <div>
          <p className="mb-4 max-w-prose text-sm text-tinta-suave">
            Al cerrar una cuenta del salón, cada producto se descuenta primero de su depósito habitual; si ahí no alcanza, de otro depósito con stock
            (el que vence antes). Un producto sin depósito habitual sale directamente de donde haya stock.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-tinta-tenue">
                <th className="py-2">Producto</th>
                <th>Depósito habitual</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b">
                  <td className="py-2">{f.producto.nombre}</td>
                  <td>{f.seccion.nombre}</td>
                  <td>
                    {/* El flex va en un div y no en el <td>: un <td> con display:flex deja de ser celda de tabla y se desalinea de su columna. */}
                    {puedeEditar && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <Link href={`/stock/seccion-habitual?editar=${f.id}`} className={claseDeBoton("enlace", "en-fila")}>
                          <IconoDeAccion id="editar" />
                          Editar
                        </Link>
                        <BotonQuitarSeccionHabitual id={f.id} producto={f.producto.nombre} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filas.length && <p className="mt-3 text-sm text-tinta-suave">Ningún producto tiene depósito habitual en «{ctx.sucursalNombre}».</p>}
        </div>

        <div>
          {filaEnEdicion && (
            <p className="mb-2 text-sm">
              <Enlace href="/stock/seccion-habitual">← Cancelar edición</Enlace>
            </p>
          )}
          <SeccionHabitualForm
            key={filaEnEdicion?.id ?? "nuevo"}
            soloLectura={!puedeEditar}
            secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))}
            filaEnEdicion={
              filaEnEdicion
                ? { productoId: filaEnEdicion.productoId, productoEtiqueta: `${filaEnEdicion.producto.codigo} — ${filaEnEdicion.producto.nombre}`, seccionId: filaEnEdicion.seccionId }
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
