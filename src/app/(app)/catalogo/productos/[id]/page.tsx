import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { obtenerMiNivelPermiso, obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { EnlaceInterno } from "@/components/enlace-interno";
import { ActivarDesactivarFila } from "@/components/activar-desactivar-fila";
import { actualizarDisponibilidadProducto, listarPresentaciones } from "@/server/actions/catalogo/productos";
import { disponibilidadPorSucursalDeProducto } from "@/server/consultas/catalogo/disponibilidad";
import { obtenerFichaProducto, obtenerSeccionHabitualEnSucursal } from "@/server/consultas/catalogo/productos";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

const plata = (n: number) => `$${n.toLocaleString("es-AR")}`;

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-neutral-500">{etiqueta}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * Ficha de un producto: solo lectura. Reúne sus datos y lleva a los reportes que ya existen (historial de movimientos, costos, receta).
 * Stock, precios por sucursal, proveedores y auditoría quedan para una fase siguiente (F3 de docs/grounding-lista-ver-editar-2026-09-18.md).
 * Al guardar un alta o una edición se vuelve acá, con el aviso de que se guardó.
 */
export default async function FichaProductoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ParametrosDeUrl<"guardado">>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_ver_catalogo", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  // Cortesía de la interfaz, no barrera: el servidor sigue exigiendo `producto_editar` en la ruta /editar y en la acción. Es un permiso de EDITAR, así que no
  // sirve el contexto de EnlaceInterno (solo lleva el nivel Ver de cada pantalla).
  const { editar: puedeEditarProducto } = await obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_editar", ctx.db);
  const { editar: puedeCambiarDisponibilidad } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "producto_disponibilidad", ctx.db);
  // S-12 (D8 del dueño): el costo de consignación (lo que se le paga al proveedor por unidad vendida, y quién es) es de quien tiene `pagar_consignante` en la sucursal activa — la
  // pantalla donde ese precio se vuelve deuda. Acá no se esconde: la consulta ni lo devuelve sin esta bandera (deniega por defecto).
  const { ver: puedeVerCostoDeConsignacion } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "pagar_consignante", ctx.db);

  const { id } = await params;
  const { guardado } = unicosDeUrl(await searchParams);
  const p = await obtenerFichaProducto(id, ctx.db, { conCostoDeConsignacion: puedeVerCostoDeConsignacion });
  if (!p) notFound();

  // Primitivos para el closure "use server" de abajo: lo que captura viaja al cliente y `p` lleva Decimales de Prisma (ver precio-local).
  const productoId = p.id;

  const [presentaciones, disponibilidadPorSucursal, seccionHabitual] = await Promise.all([
    p.tipo === "MP" ? listarPresentaciones(p.id) : Promise.resolve([]),
    disponibilidadPorSucursalDeProducto(p.id, ctx.db),
    // Solo lectura (se configura en Stock › Sección habitual): la de ESTA sucursal, y solo si apunta a una sección activa de acá — la misma regla
    // con la que la usa el cierre de cuenta del salón (docs/plan-seccion-habitual-stock-2026-09-25.md).
    p.tipo === "PV" ? obtenerSeccionHabitualEnSucursal(ctx.sucursalId, p.id, ctx.db) : Promise.resolve(null),
  ]);
  const tieneReceta = p.tipo === "PV" || p.seProduce;
  const disponibleAca = disponibilidadPorSucursal.find((d) => d.sucursalId === ctx.sucursalId)?.disponible ?? false;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/catalogo/productos" className="mb-3 inline-block text-sm underline">
          ← Productos
        </Link>
        {guardado && (
          <p role="status" className="mb-3 rounded border border-green-700 px-3 py-2 text-sm text-green-700">
            {guardado === "alta" ? "Producto creado." : "Cambios guardados."}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{p.nombre}</h1>
            <p className="text-sm text-neutral-500">
              {p.codigo} · {p.tipo === "MP" ? "Materia prima (MP)" : "Producto de venta (PV)"} ·{" "}
              {disponibleAca ? `Disponible en «${ctx.sucursalNombre}»` : `No disponible en «${ctx.sucursalNombre}»`}
            </p>
          </div>
          {puedeEditarProducto && (
            <div className="flex items-start gap-4">
              <Link href={`/catalogo/productos/${p.id}/editar`} className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">
                Editar
              </Link>
            </div>
          )}
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium">Datos</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded border p-4 sm:grid-cols-2">
          <Dato etiqueta="Categoría">{p.categoria?.nombre ?? <span className="text-neutral-500 dark:text-neutral-400">Sin categoría</span>}</Dato>
          {p.tipo === "MP" && (
            <Dato etiqueta="Insumo (grupo)">
              {p.insumo ? (
                <>
                  {p.insumo.nombre}
                  {p.insumo.grupo ? <span className="text-neutral-500"> ({p.insumo.grupo.nombre})</span> : <span className="text-neutral-500 dark:text-neutral-400"> (sin grupo)</span>}
                </>
              ) : (
                <span className="text-neutral-500 dark:text-neutral-400">Sin insumo asignado</span>
              )}
            </Dato>
          )}
          <Dato etiqueta="Unidad de stock">{p.unidadStock.nombre}</Dato>
          <Dato etiqueta="Unidad de compra">{p.unidadCompra?.nombre ?? <span className="text-neutral-500 dark:text-neutral-400">—</span>}</Dato>
          <Dato etiqueta="Factor de conversión">
            {Number(p.factorConversion).toLocaleString("es-AR")} {p.unidadStock.nombre} por {p.unidadCompra?.nombre ?? "unidad de compra"}
          </Dato>
          {p.tipo === "PV" && <Dato etiqueta="Precio de venta">{plata(Number(p.precioVenta))}</Dato>}
          {p.tipo === "PV" && (
            <Dato etiqueta="Venta fraccionada">
              {p.pasoVenta !== null ? (
                `Se vende de a ${Number(p.pasoVenta).toLocaleString("es-AR")}`
              ) : (
                <span className="text-neutral-500 dark:text-neutral-400">No — se vende de a una unidad entera</span>
              )}
            </Dato>
          )}
          {p.tipo === "PV" && (
            <Dato etiqueta={`Sección habitual en «${ctx.sucursalNombre}»`}>
              {seccionHabitual ? seccionHabitual.seccion.nombre : <span className="text-neutral-500 dark:text-neutral-400">Sin sección habitual (sale de donde haya stock)</span>}
            </Dato>
          )}
          <Dato etiqueta="Se produce (tiene receta propia)">{p.seProduce ? "Sí" : "No"}</Dato>
          <Dato etiqueta="Consignación">
            {p.esConsignacion ? (
              <>
                Sí{p.proveedorConsignacion ? ` — ${p.proveedorConsignacion.nombre}` : ""}
                {p.precioConsignacion && Number(p.precioConsignacion) > 0 ? ` · ${plata(Number(p.precioConsignacion))} por unidad vendida` : ""}
              </>
            ) : (
              "No"
            )}
          </Dato>
          {p.observaciones && (
            <div className="sm:col-span-2">
              <Dato etiqueta="Observaciones">{p.observaciones}</Dato>
            </div>
          )}
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Disponibilidad por sucursal</h2>
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="py-2 pl-4">Sucursal</th>
                <th>Disponible</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {disponibilidadPorSucursal.map((d) => (
                <tr key={d.sucursalId} className="border-b last:border-0">
                  <td className="py-2 pl-4">{d.sucursalNombre}</td>
                  <td>{d.disponible ? "Sí" : "No"}</td>
                  <td className="py-2">
                    {/* Solo la sucursal ACTIVA tiene botón — actualizarDisponibilidadProducto evalúa el gate contra ctx.sucursalId, nunca contra un id que viaje del cliente. */}
                    {puedeCambiarDisponibilidad && d.sucursalId === ctx.sucursalId && (
                      <ActivarDesactivarFila
                        activo={d.disponible}
                        aviso="Desactivar lo saca de los selectores, del stock consolidado y de la valuación de esta sucursal; en las demás no cambia nada. El historial se conserva. Si algo todavía depende de él acá (recetas vigentes, saldo), no se deja desactivar."
                        accion={async () => {
                          "use server";
                          return actualizarDisponibilidadProducto(productoId, !d.disponible);
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {presentaciones.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">Presentaciones de compra</h2>
          <ul className="rounded border p-4 text-sm">
            {presentaciones.map((pr) => (
              <li key={pr.id} className={pr.activa ? "" : "text-neutral-500 dark:text-neutral-400"}>
                {pr.unidadCompraNombre} — {pr.factorConversion.toLocaleString("es-AR")} {p.unidadStock.nombre} cada una{pr.activa ? "" : " (inactiva)"}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium">Ver en los reportes</h2>
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            <EnlaceInterno href={`/reportes/historial?productoId=${p.id}`} className="underline">
              Historial de movimientos y saldo
            </EnlaceInterno>
          </li>
          {p.tipo === "PV" && (
            <li>
              <EnlaceInterno href="/reportes/costos" className="underline">
                Costo y margen (Costos y márgenes)
              </EnlaceInterno>
            </li>
          )}
          {tieneReceta && (
            <li>
              <EnlaceInterno href={`/catalogo/recetas/${p.id}`} className="underline">
                Receta
              </EnlaceInterno>
            </li>
          )}
          {p.tipo === "MP" && (
            <li>
              <EnlaceInterno href="/catalogo/proveedores/comparativa" className="underline">
                Comparativa de precios por proveedor
              </EnlaceInterno>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
