import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/core/permisos/gate";
import { listarPresentaciones, type PresentacionOpcion } from "@/server/actions/catalogo/productos";
import { obtenerProductoPorId } from "@/server/consultas/catalogo/productos";
import { ProductoForm, type ProductoExistente } from "../../producto-form";
import { cargarOpcionesFormularioProducto } from "../../opciones-formulario";

/** Edición de un producto. Al guardar, vuelve a su ficha, que muestra el aviso de que se guardó. */
export default async function EditarProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_ver_catalogo", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  // Además de Ver (que ubica la pantalla en su familia), EDITAR: quien solo ve productos no tiene por qué recibir el formulario completo para descubrir
  // recién al guardar que no puede. La barrera es esta, en el servidor; esconder el enlace en la lista y la ficha es solo cortesía de la interfaz.
  const gateEditar = await requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_editar", ctx.db);
  if (!gateEditar.ok) return <p className="text-red-600">{gateEditar.mensaje}</p>;

  const { id } = await params;
  const p = await obtenerProductoPorId(id, ctx.db);
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
    pasoVenta: p.pasoVenta !== null ? Number(p.pasoVenta) : null,
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
      {/* La pantalla de alta ya tiene su h1; esta no lo tenía (solo el h2 del formulario) y axe marca «la página debe tener un encabezado de nivel 1». */}
      <h1 className="mb-4 text-xl font-semibold">Editar producto</h1>
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
