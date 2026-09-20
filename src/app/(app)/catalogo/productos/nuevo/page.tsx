import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { ProductoForm } from "../producto-form";
import { cargarOpcionesFormularioProducto } from "../opciones-formulario";

/** Alta de un producto nuevo. Al guardar, lleva a la ficha del producto creado. */
export default async function NuevoProductoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "alta_producto");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { unidades, insumos, categorias, proveedores } = await cargarOpcionesFormularioProducto();

  return (
    <div className="max-w-xl">
      <Link href="/catalogo/productos" className="mb-3 inline-block text-sm underline">
        ← Productos
      </Link>
      <h1 className="mb-4 text-xl font-semibold">Nuevo producto</h1>
      <ProductoForm unidades={unidades} insumosIniciales={insumos} categoriasIniciales={categorias} proveedoresIniciales={proveedores} />
    </div>
  );
}
