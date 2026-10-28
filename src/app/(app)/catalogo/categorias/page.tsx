import { IconoDeAccion } from "@/components/iconos";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { FilaDeCatalogo } from "@/components/fila-de-catalogo";
import { PESTANAS_DE_MAESTROS } from "@/core/catalogo/public";
import { crearCategoriaProducto, actualizarActivaCategoriaProducto, listarCategoriasProducto } from "@/server/actions/catalogo/categorias-producto";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { FormConResultado } from "@/components/form-con-resultado";
import { Campo } from "@/ui/primitivas/campo";

export default async function CategoriasPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "categorias", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const categorias = await listarCategoriasProducto();

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Maestros · Categorías</h1>
      <FilaDeCatalogo ctx={ctx} etiqueta="Qué maestro" pestanas={PESTANAS_DE_MAESTROS} ruta="/catalogo/categorias" />

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
              </td>
            </tr>
          ))}
        </tbody>
      </table>

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
    </div>
  );
}
