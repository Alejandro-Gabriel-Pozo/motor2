import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { prisma } from "@/lib/db";
import { listarPresentaciones, type PresentacionOpcion } from "@/server/actions/catalogo/productos";
import { ProductoForm, type ProductoExistente } from "../../producto-form";
import { cargarOpcionesFormularioProducto } from "../../opciones-formulario";

/** Edición de un producto. Al guardar, vuelve a su ficha, que muestra el aviso de que se guardó. */
export default async function EditarProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "alta_producto");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { id } = await params;
  const p = await prisma.producto.findUnique({ where: { id } });
  if (!p) notFound();

  const { unidades, insumos, categorias, proveedores } = await cargarOpcionesFormularioProducto();
  const productoExistente: ProductoExistente = {
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
  const presentaciones: PresentacionOpcion[] = p.tipo === "MP" ? await listarPresentaciones(p.id) : [];

  return (
    <div className="max-w-xl">
      <Link href={`/catalogo/productos/${p.id}`} className="mb-3 inline-block text-sm underline">
        ← Volver a la ficha
      </Link>
      <ProductoForm
        key={p.id}
        unidades={unidades}
        insumosIniciales={insumos}
        categoriasIniciales={categorias}
        proveedoresIniciales={proveedores}
        productoExistente={productoExistente}
        presentacionesIniciales={presentaciones}
      />
    </div>
  );
}
