import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { fijarAdmisionDeGrupoEnProducto } from "@/server/actions/catalogo/opciones-de-venta";
import { cargarOpcionesDelProducto } from "@/server/consultas/catalogo/opciones-de-venta";
import { nombreDelTipoDeGrupo } from "@/core/opciones/public";
import { FormConResultado } from "@/components/form-con-resultado";
import { GrupoDeFormularios } from "@/components/grupo-de-formularios";
import { ResumenDeOpciones } from "@/components/catalogo/resumen-de-opciones";
import { EnlaceInterno } from "@/components/enlace-interno";
import { AdmisionDeGrupo } from "./admision-de-grupo";
import { admisionDelFormulario } from "./admision-del-formulario";

/** Paso entre el orden de un grupo y el siguiente en el producto: uno nuevo va al final, con lugar para poner otro entre dos. */
const PASO_DE_ORDEN = 10;

/**
 * «Opciones de venta» de UN producto (GO-2d; ADR-030): qué grupos admite, con qué límites propios, cómo se cobra cada tamaño y qué opciones de cada grupo. Es una página de EDICIÓN:
 * la familia es la de la ficha (`producto_ver_catalogo`, el primer gate), y además exige el permiso de Editar de `producto_opciones_admitidas` en el servidor (el guardián
 * `paginas-con-guarda-de-editar` lo fija): quien solo ve el producto no llega a ver el formulario. Al pie, «Así se cobra en la sucursal», calculado por el servidor con la misma
 * regla que la venta; se refresca al guardar.
 *
 * Cada grupo es un formulario aparte (`GrupoDeFormularios`: mientras uno guarda, los demás esperan) con la versión de sus filas que vio la pantalla. Los closures "use server"
 * capturan solo textos, números y listas de ids.
 */
export default async function OpcionesDelProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_ver_catalogo", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  const gateEditar = await requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_opciones_admitidas", ctx.db);
  if (!gateEditar.ok) return <p className="text-red-600">{gateEditar.mensaje}</p>;

  const { id } = await params;
  const datos = await cargarOpcionesDelProducto(ctx.db, id, ctx.sucursalId);
  if (!datos) notFound();
  const { producto, admitidos, paraAgregar } = datos;
  const productoId = producto.id;
  const volver = (
    <Link href={`/catalogo/productos/${productoId}`} className="text-sm underline">
      ← {producto.nombre}
    </Link>
  );
  if (producto.tipo !== "PV" || producto.esAnclaDeAdicional) {
    return (
      <div className="flex flex-col gap-2">
        {volver}
        <p className="text-red-600">
          {producto.esAnclaDeAdicional ? `«${producto.nombre}» es el producto interno de un adicional: no admite opciones.` : `«${producto.nombre}» no es un producto de venta: solo un producto de venta admite opciones.`}
        </p>
      </div>
    );
  }
  const siguienteOrden = admitidos.reduce((max, g) => Math.max(max, g.fila.orden), 0) + PASO_DE_ORDEN;
  // Para «Agregar grupo»: de cada grupo, su tipo y sus opciones prendidas, que se admiten todas al agregarlo (con la diferencia de cada opción; un adicional con el tope del
  // grupo, las demás con 1). Después se ajusta cada una en el formulario del grupo.
  const ofrecibles = paraAgregar.map((g) => ({
    grupoId: g.grupoId,
    tipo: g.tipo,
    opciones: g.opcionIds.map((opcionId) => ({ opcionId, versionEsperada: 0, cantidadMaxima: g.tipo === "ADICIONAL" ? g.cantidadMaxima : 1, precioAbsoluto: null, diferencia: null, activo: true })),
  }));

  return (
    <GrupoDeFormularios className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        {volver}
        <h1 className="mt-2 text-xl font-semibold">Opciones de venta de «{producto.nombre}»</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Qué se elige al venderlo y cómo cambia el precio. Los grupos y sus opciones se arman en{" "}
          <EnlaceInterno href="/catalogo/opciones" className="underline">
            Opciones de venta
          </EnlaceInterno>
          . Las combinaciones (un precio o una receta propia para «grande con almendras») se arman en{" "}
          <EnlaceInterno href={`/catalogo/productos/${productoId}/combinaciones`} className="underline">
            Combinaciones
          </EnlaceInterno>
          .
        </p>
      </div>

      <section aria-labelledby="titulo-agregar-grupo" className="flex flex-col gap-2">
        <h2 id="titulo-agregar-grupo" className="text-lg font-medium">
          Agregar grupo
        </h2>
        {paraAgregar.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Este producto ya tiene todos los grupos prendidos de la empresa.</p>
        ) : (
          <FormConResultado
            accion={async (formData: FormData) => {
              "use server";
              const grupoId = String(formData.get("grupoId") ?? "");
              const elegido = ofrecibles.filter((g) => g.grupoId === grupoId)[0];
              return fijarAdmisionDeGrupoEnProducto({
                productoId,
                grupoId,
                versionEsperada: 0,
                orden: siguienteOrden,
                cantidadMinima: null,
                cantidadMaxima: null,
                // Un tamaño necesita su modo de precio: arranca en «diferencia sobre el precio base» (con las diferencias de cada opción); se cambia después en su formulario.
                modoPrecio: elegido?.tipo === "MEDIDA" ? "DIFERENCIA" : null,
                activo: true,
                opciones: elegido ? elegido.opciones : [],
              });
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="agregar-grupo" className="text-sm font-medium">
                Grupo
              </label>
              <select id="agregar-grupo" name="grupoId" required defaultValue="" className="rounded border px-3 py-2">
                <option value="" disabled>
                  Elegí un grupo
                </option>
                {paraAgregar.map((g) => (
                  <option key={g.grupoId} value={g.grupoId}>
                    {g.nombre} ({nombreDelTipoDeGrupo(g.tipo)})
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="min-h-[44px] rounded bg-neutral-900 px-4 py-2 text-white">
              Agregar
            </button>
          </FormConResultado>
        )}
        <p className="text-xs text-neutral-600 dark:text-neutral-400">Al agregarlo, marcá abajo qué opciones de ese grupo admite este producto.</p>
      </section>

      {admitidos.length === 0 ? (
        <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">
          «{producto.nombre}» todavía no admite opciones: se vende con un toque, como siempre.
        </p>
      ) : (
        admitidos.map((g) => {
          const grupoId = g.grupoId;
          const versionEsperada = g.fila.version;
          return (
            <section key={g.grupoId} aria-label={`Grupo ${g.nombre}`} className="rounded border p-4" data-admision-grupo={g.nombre}>
              <AdmisionDeGrupo
                grupo={g}
                accion={async (formData: FormData) => {
                  "use server";
                  return fijarAdmisionDeGrupoEnProducto({ productoId, grupoId, versionEsperada, ...admisionDelFormulario(formData) });
                }}
              />
            </section>
          );
        })
      )}

      <section aria-labelledby="titulo-asi-se-cobra" className="flex flex-col gap-2 rounded border p-4">
        <h2 id="titulo-asi-se-cobra" className="sr-only">
          Así se cobra
        </h2>
        <ResumenDeOpciones resumen={datos.vistaPrevia} sucursalNombre={ctx.sucursalNombre} />
      </section>
    </GrupoDeFormularios>
  );
}
