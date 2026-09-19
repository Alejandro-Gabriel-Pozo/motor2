import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarProductosPagina, listarPresentaciones, type PresentacionOpcion } from "@/server/actions/catalogo/productos";
import { listarUnidadesActivas } from "@/server/actions/catalogo/unidades";
import { listarInsumos } from "@/server/actions/catalogo/insumos";
import { listarCategoriasProducto } from "@/server/actions/catalogo/categorias-producto";
import { listarProveedores } from "@/server/actions/catalogo/proveedores";
import { prisma } from "@/lib/db";
import { ProductoForm, type ProductoExistente } from "./producto-form";

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; q?: string; cursor?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "alta_producto");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { id, q, cursor } = await searchParams;

  const [pagina, unidades, insumos, categorias, proveedores] = await Promise.all([
    listarProductosPagina(cursor, q),
    listarUnidadesActivas(),
    listarInsumos(),
    listarCategoriasProducto(),
    listarProveedores(true),
  ]);

  let productoExistente: ProductoExistente | undefined;
  let presentaciones: PresentacionOpcion[] = [];
  if (id) {
    const p = await prisma.producto.findUnique({ where: { id } });
    if (p) {
      productoExistente = {
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        tipo: p.tipo,
        categoriaId: p.categoriaId,
        unidadCompraId: p.unidadCompraId,
        unidadStockId: p.unidadStockId,
        factorConversion: Number(p.factorConversion),
        insumoId: p.insumoId,
        precioVenta: Number(p.precioVenta),
        seProduce: p.seProduce,
        esConsignacion: p.esConsignacion,
        proveedorConsignacionId: p.proveedorConsignacionId,
        precioConsignacion: p.precioConsignacion ? Number(p.precioConsignacion) : 0,
        observaciones: p.observaciones ?? undefined,
      };
      if (p.tipo === "MP") presentaciones = await listarPresentaciones(p.id);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_420px]">
      <div>
        <h1 className="mb-4 text-xl font-semibold">Productos</h1>
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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2">Código</th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Activo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pagina.items.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="py-2">{p.codigo}</td>
                <td>{p.nombre}</td>
                <td>{p.tipo}</td>
                <td>{p.activo ? "Sí" : "No"}</td>
                <td>
                  <Link href={`/catalogo/productos?id=${p.id}`} className="text-sm underline">
                    Editar
                  </Link>
                </td>
              </tr>
            ))}
            {!pagina.items.length && (
              <tr>
                <td className="py-2 text-neutral-500" colSpan={5}>
                  Sin productos{q ? " que coincidan con la búsqueda" : ""}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {pagina.nextCursor && (
          <Link href={`/catalogo/productos?${q ? `q=${encodeURIComponent(q)}&` : ""}cursor=${pagina.nextCursor}`} className="mt-3 inline-block text-sm underline">
            Página siguiente →
          </Link>
        )}
      </div>

      <div>
        {id && (
          <Link href="/catalogo/productos" className="mb-2 inline-block text-sm underline">
            ← Cancelar edición / nuevo producto
          </Link>
        )}
        {/* `key`: la lista y el formulario viven en la misma página, así que tocar «Editar» es una navegación suave y React reutilizaría el formulario ya montado. Sus categoría, unidad, precio y factor son estado interno que solo se inicializa al montarse: sin `key` quedaban con los valores del alta. */}
        <ProductoForm
          key={productoExistente?.id ?? "nuevo"}
          unidades={unidades}
          insumosIniciales={insumos}
          categoriasIniciales={categorias}
          proveedoresIniciales={proveedores}
          productoExistente={productoExistente}
          presentacionesIniciales={presentaciones}
        />
      </div>
    </div>
  );
}
