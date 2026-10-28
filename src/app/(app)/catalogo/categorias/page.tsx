import { IconoDeAccion } from "@/components/iconos";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { CajaDesplazable } from "@/components/catalogo/caja-desplazable";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { FilaDeCatalogo } from "@/components/fila-de-catalogo";
import { AvisoSoloLecturaDeCatalogo } from "@/components/catalogo/aviso-solo-lectura";
import { PESTANAS_DE_MAESTROS } from "@/core/catalogo/public";
import { crearCategoriaProducto, actualizarActivaCategoriaProducto, listarCategoriasProducto } from "@/server/actions/catalogo/categorias-producto";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { FormConResultado } from "@/components/form-con-resultado";
import { Campo } from "@/ui/primitivas/campo";

/**
 * Catálogo › Maestros › Categorías (DEC-13): el rubro comercial de cada producto. Ver ≠ escribir (DEC-33): «Activar/Desactivar» se dibuja con el «Editar» de `categorias` y el alta con el de
 * `categoria_alta` (las claves que exigen sus comandos); quien solo ve lee la tabla con el aviso de solo lectura.
 */
export default async function CategoriasPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "categorias", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const [categorias, { editar: puedeActivar }, { editar: puedeDarDeAlta }] = await Promise.all([
    listarCategoriasProducto(),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "categorias", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "categoria_alta", ctx.db),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="mb-1 text-xl font-semibold">Maestros · Categorías</h1>
          <p className="text-sm text-tinta-tenue">El rubro comercial de cada producto, de compra o de venta (Lácteos, Bebidas, Pizzas…). Ordena los reportes y fija el margen objetivo por rubro.</p>
        </div>
        <FilaDeCatalogo ctx={ctx} etiqueta="Qué maestro" pestanas={PESTANAS_DE_MAESTROS} ruta="/catalogo/categorias" />
        {!puedeActivar && !puedeDarDeAlta && <AvisoSoloLecturaDeCatalogo que="las categorías" />}
      </div>

      <CajaDesplazable etiqueta="Tabla de categorías">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-tinta-tenue">
              <th className="py-2">Nombre</th>
              <th>Activa</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {categorias.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="py-2">{c.nombre}</td>
                <td>{c.activo ? "Sí" : "No"}</td>
                <td>
                  {puedeActivar && (
                    <FormConResultado
                      accion={async () => {
                        "use server";
                        return actualizarActivaCategoriaProducto(c.id, !c.activo);
                      }}
                    >
                      <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                        <IconoDeAccion id="activar" />
                        {c.activo ? "Desactivar" : "Activar"}
                      </BotonDeServidor>
                    </FormConResultado>
                  )}
                </td>
              </tr>
            ))}
            {!categorias.length && (
              <tr>
                <td className="py-2 text-tinta-tenue" colSpan={3}>
                  Todavía no hay categorías.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CajaDesplazable>

      {puedeDarDeAlta && (
        <FormConResultado
          accion={async (formData: FormData) => {
            "use server";
            const r = await crearCategoriaProducto(String(formData.get("nombre") ?? ""));
            // El refresco se pide ACÁ y no en la acción: la acción también la usa el alta rápida del formulario de Producto (ver refrescar.ts).
            // Solo si salió bien: con un error no cambió nada y no hay nada que redibujar.
            if (r.ok) refrescarVistaSiHaceFalta();
            return r;
          }}
          className="max-w-md space-y-1"
        >
          <div className="flex gap-2">
            <div className="flex-1">
              <Campo aria-label="Nombre de la categoría" name="nombre" placeholder="nombre de la categoría" required />
            </div>
            <BotonDeServidor type="submit">Crear</BotonDeServidor>
          </div>
        </FormConResultado>
      )}
    </div>
  );
}
