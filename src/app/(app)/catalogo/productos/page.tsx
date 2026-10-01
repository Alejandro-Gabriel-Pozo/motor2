import Link from "next/link";
import { redirect } from "next/navigation";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerMiNivelPermiso, requierePermisoVerDeEmpresa, obtenerMiNivelPermisoDeEmpresa } from "@/core/permisos/gate";
import { ActivarDesactivarFila } from "@/components/activar-desactivar-fila";
import { actualizarDisponibilidadProducto, listarProductosPagina } from "@/server/actions/catalogo/productos";

/**
 * Lista de productos. Ya no comparte pantalla con el formulario: el alta está en `/nuevo`, la ficha (solo lectura) en `/[id]` y la edición en
 * `/[id]/editar` (docs/grounding-lista-ver-editar-2026-09-18.md, decisiones 1 a 3).
 */
export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; q?: string; cursor?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "alta_producto", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  // Cortesía de la interfaz, no barrera: el servidor sigue exigiendo `editar_producto` en la ruta /editar y en la acción. Es un permiso de EDITAR, así que no
  // sirve el contexto de EnlaceInterno (solo lleva el nivel Ver de cada pantalla).
  const { editar: puedeEditarProducto } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "editar_producto", ctx.db);
  const { editar: puedeDarDeAlta } = await obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "alta_producto", ctx.db);

  const { id, q, cursor } = await searchParams;
  // Los enlaces y favoritos viejos apuntaban a `/catalogo/productos?id=…` (la edición estaba en esta misma pantalla).
  if (id) redirect(`/catalogo/productos/${encodeURIComponent(id)}/editar`);

  const pagina = await listarProductosPagina(cursor, q);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Productos</h1>
        {puedeDarDeAlta && (
          <Link href="/catalogo/productos/nuevo" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">
            + Nuevo producto
          </Link>
        )}
      </div>
      <form className="mb-3 flex gap-2 text-sm">
        <input type="text" name="q" defaultValue={q ?? ""} placeholder="Buscar por código o nombre…" className="w-64 rounded border px-3 py-2" />
        <button type="submit" className="rounded border px-3 py-2">
          Buscar
        </button>
        {q && (
          <Link href="/catalogo/productos" className="self-center text-sm underline">
            Limpiar
          </Link>
        )}
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2">Código</th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Disponible acá</th>
              <th>Sucursales</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {pagina.items.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="py-2">{p.codigo}</td>
                <td>
                  <Link href={`/catalogo/productos/${p.id}`} className="underline">
                    {p.nombre}
                  </Link>
                </td>
                <td>{p.tipo}</td>
                <td>{p.disponibleAca ? "Sí" : "No"}</td>
                <td>{p.sucursalesDisponibles} de {p.totalSucursales}</td>
                <td className="py-2">
                  {puedeEditarProducto && (
                    <div className="flex items-start gap-3">
                      <Link href={`/catalogo/productos/${p.id}/editar`} className="text-sm underline">
                        Editar
                      </Link>
                      <ActivarDesactivarFila
                        activo={p.disponibleAca}
                        aviso="Desactivar lo saca de los selectores, del stock consolidado y de la valuación de esta sucursal; en las demás no cambia nada. El historial se conserva. Si algo todavía depende de él acá (recetas vigentes, saldo), no se deja desactivar."
                        accion={async () => {
                          "use server";
                          return actualizarDisponibilidadProducto(p.id, !p.disponibleAca);
                        }}
                      />
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!pagina.items.length && (
              <tr>
                <td className="py-2 text-neutral-500" colSpan={6}>
                  Sin productos{q ? " que coincidan con la búsqueda" : ""}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pagina.nextCursor && (
        <Link href={`/catalogo/productos?${q ? `q=${encodeURIComponent(q)}&` : ""}cursor=${pagina.nextCursor}`} className="mt-3 inline-block text-sm underline">
          Página siguiente →
        </Link>
      )}
    </div>
  );
}
