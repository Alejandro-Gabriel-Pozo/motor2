import { IconoDeAccion } from "@/components/iconos";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
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
import { TablaDeDatos, type ColumnaDeTabla } from "@/ui/componentes/datos/tabla-de-datos";

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

  // Los closures "use server" capturan solo textos y ids. En celular cada categoría es una tarjeta (el nombre largo se parte; no se pisa con «Activa»); desde 640 px, la tabla de siempre.
  const columnas: ColumnaDeTabla<(typeof categorias)[number]>[] = [
    { id: "nombre", encabezado: "Nombre", titulo: true, celda: (c) => c.nombre },
    { id: "activa", encabezado: "Activa", celda: (c) => (c.activo ? "Sí" : "No") },
    ...(puedeActivar
      ? [
          {
            id: "acciones",
            encabezado: "Acciones",
            accion: true,
            celda: (c: (typeof categorias)[number]) => (
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
            ),
          },
        ]
      : []),
  ];

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

      <TablaDeDatos titulo="Tabla de categorías" columnas={columnas} filas={categorias} claveDeFila={(c) => c.id} vacio="Todavía no hay categorías." />

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
