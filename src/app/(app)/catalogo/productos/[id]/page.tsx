import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/core/permisos/gate";
import { EnlaceInterno } from "@/components/enlace-interno";
import { prisma } from "@/lib/db";
import { ActivarDesactivarFila } from "@/components/activar-desactivar-fila";
import { actualizarDisponibilidadProducto, listarPresentaciones } from "@/server/actions/catalogo/productos";

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
  searchParams: Promise<{ guardado?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "alta_producto");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  // Cortesía de la interfaz, no barrera: el servidor sigue exigiendo `editar_producto` en la ruta /editar y en la acción. Es un permiso de EDITAR, así que no
  // sirve el contexto de EnlaceInterno (solo lleva el nivel Ver de cada pantalla).
  const { editar: puedeEditarProducto } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "editar_producto");

  const { id } = await params;
  const { guardado } = await searchParams;
  const p = await prisma.producto.findUnique({
    where: { id },
    include: { categoria: true, unidadCompra: true, unidadStock: true, insumo: { include: { grupo: true } }, proveedorConsignacion: true },
  });
  if (!p) notFound();

  // Primitivos para el closure "use server" de abajo: lo que captura viaja al cliente y `p` lleva Decimales de Prisma (ver precio-local).
  const productoId = p.id;
  const activo = p.activo;

  const presentaciones = p.tipo === "MP" ? await listarPresentaciones(p.id) : [];
  const tieneReceta = p.tipo === "PV" || p.seProduce;

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
              {p.codigo} · {p.tipo === "MP" ? "Materia prima (MP)" : "Producto de venta (PV)"} · {p.activo ? "Activo" : "Inactivo"}
            </p>
          </div>
          {puedeEditarProducto && (
            <div className="flex items-start gap-4">
              <ActivarDesactivarFila
                activo={p.activo}
                aviso="Desactivar lo saca de los selectores de movimientos, del stock consolidado y de la valuación; el historial se conserva. Si algo todavía depende de él (recetas vigentes, saldo), no se deja desactivar."
                accion={async () => {
                  "use server";
                  // TRANSITORIO (paso P4/15, docs/plan-disponibilidad-por-sucursal-2026-09-23.md): P10 reemplaza esto por
                  // la sección "Disponibilidad por sucursal", con el dato real por sucursal.
                  return actualizarDisponibilidadProducto(productoId, !activo);
                }}
              />
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
