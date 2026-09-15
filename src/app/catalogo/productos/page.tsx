import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarProductos } from "@/server/actions/productos";
import { listarUnidadesActivas } from "@/server/actions/unidades";
import { listarInsumos } from "@/server/actions/insumos";
import { listarCategoriasProducto } from "@/server/actions/categorias-producto";
import { listarProveedores } from "@/server/actions/proveedores";
import { prisma } from "@/lib/db";
import { ProductoForm, type ProductoExistente } from "./producto-form";

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "alta_producto");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { id } = await searchParams;

  const [productos, unidades, insumos, categorias, proveedores] = await Promise.all([
    listarProductos(),
    listarUnidadesActivas(),
    listarInsumos(),
    listarCategoriasProducto(),
    listarProveedores(true),
  ]);

  let productoExistente: ProductoExistente | undefined;
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
    }
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_420px]">
      <div>
        <h1 className="mb-4 text-xl font-semibold">Productos</h1>
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
            {productos.map((p) => (
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
          </tbody>
        </table>
      </div>

      <div>
        {id && (
          <Link href="/catalogo/productos" className="mb-2 inline-block text-sm underline">
            ← Cancelar edición / nuevo producto
          </Link>
        )}
        <ProductoForm
          unidades={unidades}
          insumosIniciales={insumos}
          categoriasIniciales={categorias}
          proveedoresIniciales={proveedores}
          productoExistente={productoExistente}
        />
      </div>
    </div>
  );
}
