import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { listarSeccionesHabituales } from "@/server/actions/stock/seccion-habitual";
import { SeccionHabitualForm } from "./seccion-habitual-form";
import { BotonQuitarSeccionHabitual } from "./boton-quitar";
import { IconoDeAccion } from "@/components/iconos";
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
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "stock_seccion_habitual", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { editar } = unicosDeUrl(await searchParams);
  const [filas, secciones] = await Promise.all([listarSeccionesHabituales(ctx.sucursalId), listarSeccionesActivas(ctx.sucursalId)]);
  const filaEnEdicion = editar ? filas.find((f) => f.id === editar) : undefined;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_380px]">
      <div>
        <h1 className="mb-2 text-xl font-semibold">Sección habitual</h1>
        <p className="mb-4 max-w-prose text-sm text-neutral-600 dark:text-neutral-400">
          Al cerrar una cuenta del salón, cada producto se descuenta primero de su sección habitual; si ahí no alcanza, de otra sección con stock
          (la que vence antes). Un producto sin sección habitual sale directamente de donde haya stock.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500 dark:text-neutral-400">
              <th className="py-2">Producto</th>
              <th>Sección habitual</th>
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
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <Link href={`/stock/seccion-habitual?editar=${f.id}`} className="text-sm underline inline-flex items-center gap-1">
                      <IconoDeAccion id="editar" />
                      Editar
                    </Link>
                    <BotonQuitarSeccionHabitual id={f.id} producto={f.producto.nombre} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filas.length && <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">Ningún producto tiene sección habitual en «{ctx.sucursalNombre}».</p>}
      </div>

      <div>
        {filaEnEdicion && (
          <Link href="/stock/seccion-habitual" className="mb-2 inline-block text-sm underline">
            ← Cancelar edición
          </Link>
        )}
        <SeccionHabitualForm
          key={filaEnEdicion?.id ?? "nuevo"}
          secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))}
          filaEnEdicion={
            filaEnEdicion
              ? { productoId: filaEnEdicion.productoId, productoEtiqueta: `${filaEnEdicion.producto.codigo} — ${filaEnEdicion.producto.nombre}`, seccionId: filaEnEdicion.seccionId }
              : undefined
          }
        />
      </div>
    </div>
  );
}
