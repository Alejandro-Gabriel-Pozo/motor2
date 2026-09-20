import { listarUnidadesActivas } from "@/server/actions/catalogo/unidades";
import { listarInsumos } from "@/server/actions/catalogo/insumos";
import { listarCategoriasProducto } from "@/server/actions/catalogo/categorias-producto";
import { listarProveedores } from "@/server/actions/catalogo/proveedores";

/** Lo que necesita el formulario de producto (alta y edición) para armar sus listas desplegables. */
export async function cargarOpcionesFormularioProducto() {
  const [unidades, insumos, categorias, proveedores] = await Promise.all([
    listarUnidadesActivas(),
    listarInsumos(),
    listarCategoriasProducto(),
    listarProveedores(true),
  ]);
  return { unidades, insumos, categorias, proveedores };
}
