import { Insignia } from "@/ui/primitivas/insignia";
import { claseDeBoton } from "@/ui/primitivas/boton";
import Link from "next/link";
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
} from "@/core/catalogo/public";
import { ApartadoDePlanilla } from "@/ui/componentes/estructura/apartado-de-planilla";
import { BarraDeFiltros } from "@/ui/componentes/estructura/barra-de-filtros";
import { FilaDeCatalogo } from "@/components/fila-de-catalogo";
import { FiltrosDeLaListaDeProductos } from "@/components/catalogo/filtros-de-la-lista-de-productos";
import { PESTANAS_DE_PRODUCTOS } from "@/core/catalogo/public";
import { buscaPorReferenciaDelProveedorEnLaLista, faltasQueSePuedenFiltrarEnLaLista } from "@/server/consultas/catalogo/filtros-de-productos";
import { gruposDeOpcionesPorProducto } from "@/server/consultas/catalogo/opciones-de-venta";

/**
 * Lista de productos. Ya no comparte pantalla con el formulario: el alta está en `/nuevo`, la ficha (solo lectura) en `/[id]` y la edición en
 * `/[id]/datos` (el paso 1 del espacio del producto) (docs/grounding-lista-ver-editar-2026-09-18.md, decisiones 1 a 3).
 */
export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<ParametrosDeUrl<"q" | "cursor" | "tipo" | "modo" | "disponible" | "falta">>;
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

  const { cursor, ...enLaUrl } = unicosDeUrl(await searchParams);

  // Los filtros de la URL, validados contra sus listas cerradas (lo que no es de la lista se ignora); el servidor los vuelve a validar y es quien filtra (`listarProductosPagina`).
  const [faltas, porReferencia] = await Promise.all([faltasQueSePuedenFiltrarEnLaLista(ctx), buscaPorReferenciaDelProveedorEnLaLista(ctx)]);
  const leidos = leerFiltrosDeProductos(enLaUrl);
  const filtros = { ...leidos, falta: leidos.falta && faltas.includes(leidos.falta) ? leidos.falta : null };
  const pagina = await listarProductosPagina(cursor, filtros.q, filtros);
  // GO-2d: la etiqueta «Opciones: Tamaño, Leche» de cada producto de la página (una sola lectura).
  const gruposDeOpciones = await gruposDeOpcionesPorProducto(ctx.db, pagina.items.map((p) => p.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Productos</h1>
        {puedeDarDeAlta && (
          <EnlaceInterno href="/catalogo/productos/nuevo" className={claseDeBoton()}>
            + Nuevo producto
          </EnlaceInterno>
        )}
      </div>
      <div>
        <FilaDeCatalogo ctx={ctx} etiqueta="Qué mirar de los productos" pestanas={PESTANAS_DE_PRODUCTOS} ruta="/catalogo/productos" />
      </div>
      <ApartadoDePlanilla titulo="Lista de productos">
        <BarraDeFiltros>
      <FiltrosDeLaListaDeProductos
        accion="/catalogo/productos"
        filtros={filtros}
        clases={TIPOS_FILTRABLES.map((v) => ({ valor: v, etiqueta: ETIQUETA_DEL_TIPO[v] }))}
        etiquetaDeLaBusqueda={porReferencia ? "Buscar por nombre, código o cómo lo llama el proveedor" : "Buscar por nombre o código"}
        marcadorDeLaBusqueda={porReferencia ? "Nombre, código o lo que dice la factura…" : "Buscar por código o nombre…"}
        hayFiltros={hayFiltrosDeProductos(filtros)}
        masFiltros={[
          { nombre: "modo", etiqueta: "Cómo se vende", valor: filtros.modo ?? "", opciones: MODOS_FILTRABLES.map((v) => ({ valor: v, etiqueta: ETIQUETA_DEL_MODO[v] })) },
          { nombre: "disponible", etiqueta: "Disponibilidad", valor: filtros.disponible ?? "", opciones: DISPONIBILIDADES_FILTRABLES.map((v) => ({ valor: v, etiqueta: ETIQUETA_DE_LA_DISPONIBILIDAD[v] })) },
          { nombre: "falta", etiqueta: "Le falta algo", valor: filtros.falta ?? "", opciones: faltas.map((v) => ({ valor: v, etiqueta: ETIQUETA_DE_LA_FALTA[v] })) },
        ]}
      />
        </BarraDeFiltros>
      {pagina.items.length === 0 ? (
        <p className="text-sm text-tinta-suave">{`Sin productos${hayFiltrosDeProductos(filtros) ? " que coincidan con la búsqueda y los filtros" : ""}.`}</p>
      ) : (
        <ul aria-label="Productos" className="divide-y divide-borde rounded border border-borde bg-superficie">
          {pagina.items.map((p) => (
            <li key={p.id} data-producto={p.id} className="flex flex-col gap-1 px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <Link href={`/catalogo/productos/${p.id}`} className="font-medium underline">
                    {p.nombre}
                  </Link>
                  <p className="flex flex-wrap items-center gap-x-2 text-sm text-tinta-suave">
                    <span>{ETIQUETA_DEL_TIPO[p.clase]}</span>
                    {!p.disponibleAca && <Insignia tono="aviso">Desactivado</Insignia>}
                    {gruposDeOpciones.has(p.id) && <Insignia data-etiqueta-opciones>{`Opciones: ${gruposDeOpciones.get(p.id)!.join(", ")}`}</Insignia>}
                  </p>
                </div>
                {p.precio !== null && <span className="shrink-0 text-sm font-medium tabular-nums">{p.precio}</span>}
              </div>
              {(puedeEditarProducto || puedeCambiarDisponibilidad) && (
                <div className="flex items-center gap-3">
                  {puedeEditarProducto && (
                    <Link href={`/catalogo/productos/${p.id}/datos`} className="inline-flex min-h-11 items-center gap-1 text-sm underline md:min-h-0">
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
            </li>
          ))}
        </ul>
      )}
      </ApartadoDePlanilla>
      {pagina.nextCursor && (
        <Link href={`/catalogo/productos?${consultaDeLosFiltros(filtros, pagina.nextCursor)}`} className="inline-block text-sm underline">
          Página siguiente →
        </Link>
      )}
    </div>
  );
}
