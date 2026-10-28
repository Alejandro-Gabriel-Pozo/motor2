import { Insignia } from "@/ui/primitivas/insignia";
import { claseDeBoton } from "@/ui/primitivas/boton";
import Link from "next/link";
import { redirect } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, requierePermisoVerDeEmpresa, obtenerMiNivelPermisoDeEmpresa } from "@/server/acceso/gate";
import { ActivarDesactivarFila } from "@/components/activar-desactivar-fila";
import { EnlaceInterno } from "@/components/enlace-interno";
import { actualizarDisponibilidadProducto, listarProductosPagina } from "@/server/actions/catalogo/productos";
import { IconoDeAccion } from "@/components/iconos";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import {
  DISPONIBILIDADES_FILTRABLES,
  ETIQUETA_DE_LA_DISPONIBILIDAD,
  ETIQUETA_DE_LA_FALTA,
  ETIQUETA_DEL_MODO,
  ETIQUETA_DEL_TIPO,
  MODOS_FILTRABLES,
  TIPOS_FILTRABLES,
  consultaDeLosFiltros,
  hayFiltrosDeProductos,
  leerFiltrosDeProductos,
  rutaDelPaso,
} from "@/core/catalogo/public";
import { FiltrosDeLista } from "@/components/filtros-de-lista";
import { FilaDeCatalogo } from "@/components/fila-de-catalogo";
import { PESTANAS_DE_PRODUCTOS } from "@/core/catalogo/public";
import { faltasQueSePuedenFiltrarEnLaLista } from "@/server/consultas/catalogo/filtros-de-productos";
import { gruposDeOpcionesPorProducto } from "@/server/consultas/catalogo/opciones-de-venta";

/**
 * Lista de productos. Ya no comparte pantalla con el formulario: el alta está en `/nuevo`, la ficha (solo lectura) en `/[id]` y la edición en
 * `/[id]/datos` (el paso 1 del espacio del producto; `/[id]/editar` redirige ahí) (docs/grounding-lista-ver-editar-2026-09-18.md, decisiones 1 a 3).
 */
export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<ParametrosDeUrl<"id" | "q" | "cursor" | "tipo" | "modo" | "disponible" | "falta">>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_ver_catalogo", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;
  // Cortesía de la interfaz, no barrera: el servidor sigue exigiendo `producto_editar` en la ruta /datos y en la acción. Es un permiso de EDITAR, así que no
  // sirve el contexto de EnlaceInterno (solo lleva el nivel Ver de cada pantalla).
  const { editar: puedeEditarProducto } = await obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_editar", ctx.db);
  // Cortesía de la interfaz: `actualizarDisponibilidadProducto` exige `producto_disponibilidad` (clave propia, antes compartía la clave de editar).
  const { editar: puedeCambiarDisponibilidad } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "producto_disponibilidad", ctx.db);
  const { editar: puedeDarDeAlta } = await obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "alta_producto", ctx.db);

  const { id, cursor, ...enLaUrl } = unicosDeUrl(await searchParams);
  // Los enlaces y favoritos viejos apuntaban a `/catalogo/productos?id=…` (la edición estaba en esta misma pantalla).
  if (id) redirect(rutaDelPaso(id, "datos"));

  // Los filtros de la URL, validados contra sus listas cerradas (lo que no es de la lista se ignora); el servidor los vuelve a validar y es quien filtra (`listarProductosPagina`).
  const faltas = await faltasQueSePuedenFiltrarEnLaLista(ctx);
  const leidos = leerFiltrosDeProductos(enLaUrl);
  const filtros = { ...leidos, falta: leidos.falta && faltas.includes(leidos.falta) ? leidos.falta : null };
  const pagina = await listarProductosPagina(cursor, filtros.q, filtros);
  // GO-2d: la etiqueta «Opciones: Tamaño, Leche» de cada producto de la página (una sola lectura).
  const gruposDeOpciones = await gruposDeOpcionesPorProducto(ctx.db, pagina.items.map((p) => p.id));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Productos</h1>
        {puedeDarDeAlta && (
          <EnlaceInterno href="/catalogo/productos/nuevo" className={claseDeBoton()}>
            + Nuevo producto
          </EnlaceInterno>
        )}
      </div>
      <div className="mb-4">
        <FilaDeCatalogo ctx={ctx} etiqueta="Qué mirar de los productos" pestanas={PESTANAS_DE_PRODUCTOS} ruta="/catalogo/productos" />
      </div>
      <FiltrosDeLista
        accion="/catalogo/productos"
        etiquetaDeLaBusqueda="Buscar por nombre o código"
        marcadorDeLaBusqueda="Buscar por código o nombre…"
        busqueda={filtros.q}
        hayFiltros={hayFiltrosDeProductos(filtros)}
        filtros={[
          { nombre: "tipo", etiqueta: "Tipo", valor: filtros.tipo ?? "", opciones: TIPOS_FILTRABLES.map((v) => ({ valor: v, etiqueta: ETIQUETA_DEL_TIPO[v] })) },
          { nombre: "modo", etiqueta: "Cómo se vende", valor: filtros.modo ?? "", opciones: MODOS_FILTRABLES.map((v) => ({ valor: v, etiqueta: ETIQUETA_DEL_MODO[v] })) },
          { nombre: "disponible", etiqueta: "Disponibilidad", valor: filtros.disponible ?? "", opciones: DISPONIBILIDADES_FILTRABLES.map((v) => ({ valor: v, etiqueta: ETIQUETA_DE_LA_DISPONIBILIDAD[v] })) },
          { nombre: "falta", etiqueta: "Le falta algo", valor: filtros.falta ?? "", opciones: faltas.map((v) => ({ valor: v, etiqueta: ETIQUETA_DE_LA_FALTA[v] })) },
        ]}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-tinta-tenue">
              <th className="py-2">Código</th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Disponible acá</th>
              <th>Sucursales</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {pagina.items.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="py-2">{p.codigo}</td>
                <td>
                  <Link href={`/catalogo/productos/${p.id}`} className="underline">
                    {p.nombre}
                  </Link>
                  {gruposDeOpciones.has(p.id) && (
                    <Insignia className="ml-2" data-etiqueta-opciones>{`Opciones: ${gruposDeOpciones.get(p.id)!.join(", ")}`}</Insignia>
                  )}
                </td>
                <td>{p.tipo}</td>
                <td>{p.disponibleAca ? "Sí" : "No"}</td>
                <td>{p.sucursalesDisponibles} de {p.totalSucursales}</td>
                <td className="py-2">
                  {(puedeEditarProducto || puedeCambiarDisponibilidad) && (
                    <div className="flex items-start gap-3">
                      {puedeEditarProducto && (
                        <Link href={`/catalogo/productos/${p.id}/datos`} className="text-sm underline inline-flex items-center gap-1">
                          <IconoDeAccion id="editar" />
                          Editar
                        </Link>
                      )}
                      {puedeCambiarDisponibilidad && (
                        <ActivarDesactivarFila
                          activo={p.disponibleAca}
                          aviso="Desactivar lo saca de los selectores, del stock consolidado y de la valuación de esta sucursal; en las demás no cambia nada. El historial se conserva. Si algo todavía depende de él acá (recetas vigentes, saldo), no se deja desactivar."
                          accion={async () => {
                            "use server";
                            return actualizarDisponibilidadProducto(p.id, !p.disponibleAca);
                          }}
                        />
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!pagina.items.length && (
              <tr>
                <td className="py-2 text-tinta-tenue" colSpan={6}>
                  Sin productos{hayFiltrosDeProductos(filtros) ? " que coincidan con la búsqueda y los filtros" : ""}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pagina.nextCursor && (
        <Link href={`/catalogo/productos?${consultaDeLosFiltros(filtros, pagina.nextCursor)}`} className="mt-3 inline-block text-sm underline">
          Página siguiente →
        </Link>
      )}
    </div>
  );
}
