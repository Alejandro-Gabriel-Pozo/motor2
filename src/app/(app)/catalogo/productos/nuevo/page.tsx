import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermiso, requierePermisoVer } from "@/core/permisos/gate";
import { listarSucursales } from "@/server/actions/auth/sucursales";
import { ProductoForm } from "../producto-form";
import { cargarOpcionesFormularioProducto } from "../opciones-formulario";

/** Alta de un producto nuevo. Al guardar, lleva a la ficha del producto creado. */
export default async function NuevoProductoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "alta_producto");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  // Además de Ver, EDITAR: `darDeAltaProducto` exige Editar de `alta_producto`. Quien solo ve productos no tiene por qué recibir el formulario completo
  // para descubrir recién al guardar que no puede (mismo criterio que la ruta /editar).
  const gateAlta = await requierePermiso(ctx.usuarioId, ctx.sucursalId, "alta_producto");
  if (!gateAlta.ok) return <p className="text-red-600">{gateAlta.mensaje}</p>;

  const [{ unidades, insumos, categorias, proveedores }, sucursales] = await Promise.all([cargarOpcionesFormularioProducto(), listarSucursales()]);

  return (
    <div className="max-w-xl">
      <Link href="/catalogo/productos" className="mb-3 inline-block text-sm underline">
        ← Productos
      </Link>
      <h1 className="mb-4 text-xl font-semibold">Nuevo producto</h1>
      <ProductoForm
        unidades={unidades}
        insumosIniciales={insumos}
        categoriasIniciales={categorias}
        proveedoresIniciales={proveedores}
        cantidadSucursales={sucursales.length}
        nombreSucursalActual={ctx.sucursalNombre}
      />
    </div>
  );
}
