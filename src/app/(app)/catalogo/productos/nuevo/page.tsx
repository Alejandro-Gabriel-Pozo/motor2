import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { obtenerMiNivelPermiso, requierePermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { EnlaceInterno } from "@/components/enlace-interno";
import { contarSucursales } from "@/server/consultas/catalogo/productos";
import { ProductoForm } from "../producto-form";
import { cargarOpcionesFormularioProducto } from "../opciones-formulario";

/** Alta de un producto nuevo. Al guardar, lleva a la ficha del producto creado. */
export default async function NuevoProductoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "alta_producto", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  // Además de Ver, EDITAR: `darDeAltaProducto` exige Editar de `alta_producto`. Quien solo ve productos no tiene por qué recibir el formulario completo
  // para descubrir recién al guardar que no puede (mismo criterio que la ruta /editar).
  const gateAlta = await requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "alta_producto", ctx.db);
  if (!gateAlta.ok) return <p className="text-red-600">{gateAlta.mensaje}</p>;

  const [{ unidades, insumos, categorias, proveedores, puedeCrear }, cantidadSucursales] = await Promise.all([cargarOpcionesFormularioProducto(ctx), contarSucursales(ctx.db)]);
  // S-12 (D8 del dueño): crear un producto en consignación es fijar su costo (proveedor y precio): solo con `pagar_consignante` EDITAR en la sucursal activa. Sin la clave el formulario no
  // ofrece la consignación ni manda la lista de proveedores del selector; el servidor la rechaza igual (`darDeAltaProducto`).
  const { editar: puedeGestionarConsignacion } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "pagar_consignante", ctx.db);

  return (
    <div className="max-w-xl">
      <EnlaceInterno href="/catalogo/productos" className="mb-3 inline-block text-sm underline">
        ← Productos
      </EnlaceInterno>
      <h1 className="mb-4 text-xl font-semibold">Nuevo producto</h1>
      <ProductoForm
        unidades={unidades}
        insumosIniciales={insumos}
        categoriasIniciales={categorias}
        proveedoresIniciales={puedeGestionarConsignacion ? proveedores : []}
        puedeCrear={puedeCrear}
        puedeGestionarConsignacion={puedeGestionarConsignacion}
        cantidadSucursales={cantidadSucursales}
        nombreSucursalActual={ctx.sucursalNombre}
      />
    </div>
  );
}
