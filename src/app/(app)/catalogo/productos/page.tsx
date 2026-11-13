import { Insignia } from "@/ui/primitivas/insignia";
import { claseDeBoton } from "@/ui/primitivas/boton";
import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVerDeEmpresa, obtenerMiNivelPermisoDeEmpresa } from "@/server/acceso/gate";
import { EnlaceInterno } from "@/components/enlace-interno";
import { listarProductosPagina } from "@/server/actions/catalogo/productos";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import {
  DISPONIBILIDADES_FILTRABLES,
  ESTADOS_FILTRABLES,
  ETIQUETA_DEL_ESTADO,
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
import { buscaPorReferenciaDelProveedorEnLaLista, faltasQueSePuedenFiltrarEnLaLista, productosQueFaltaCompletarEnLaPagina } from "@/server/consultas/catalogo/filtros-de-productos";
import { detalleDeLaLista } from "@/server/consultas/catalogo/detalle-de-la-lista";

/**
 * Lista de productos, como la de Pedernal: una fila por producto (nombre, «Desactivado» si corresponde, clase y precio) que lleva a la ficha, donde se edita y se activa o desactiva. El alta está en `/nuevo`.
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
  const { editar: puedeDarDeAlta } = await obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "alta_producto", ctx.db);

  const { cursor, ...enLaUrl } = unicosDeUrl(await searchParams);

  // Los filtros de la URL, validados contra sus listas cerradas (lo que no es de la lista se ignora); el servidor los vuelve a validar y es quien filtra (`listarProductosPagina`).
  const [faltas, porReferencia] = await Promise.all([faltasQueSePuedenFiltrarEnLaLista(ctx), buscaPorReferenciaDelProveedorEnLaLista(ctx)]);
  const leidos = leerFiltrosDeProductos(enLaUrl);
  const filtros = { ...leidos, falta: leidos.falta && faltas.includes(leidos.falta) ? leidos.falta : null };
  const pagina = await listarProductosPagina(cursor, filtros.q, filtros);
  // El precio de la sucursal activa y la clase de cada fila (dos consultas para toda la página).
  const ids = pagina.items.map((p) => p.id);
  const detalle = await detalleDeLaLista(ctx.db, ctx.sucursalId, ids);
  // La marca «Falta completar» de cada fila: lo que quien mira puede ver que le falta (el mismo cálculo del filtro «Estado»).
  const faltaCompletar = await productosQueFaltaCompletarEnLaPagina(ctx, ids);

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
        estados={ESTADOS_FILTRABLES.map((v) => ({ valor: v, etiqueta: ETIQUETA_DEL_ESTADO[v] }))}
        etiquetaDeLaBusqueda={porReferencia ? "Buscar por nombre, código o cómo lo llama el proveedor" : "Buscar por nombre o código"}
        marcadorDeLaBusqueda={porReferencia ? "Nombre, código o lo que dice la factura…" : "Buscar por código o nombre…"}
        hayFiltros={hayFiltrosDeProductos(filtros)}
        masFiltros={[
          { nombre: "modo", etiqueta: "Cómo se vende", valor: filtros.modo ?? "", opciones: MODOS_FILTRABLES.map((v) => ({ valor: v, etiqueta: ETIQUETA_DEL_MODO[v] })) },
          { nombre: "disponible", etiqueta: "En esta sucursal", valor: filtros.disponible === "aca" || filtros.disponible === "no-aca" ? filtros.disponible : "", opciones: DISPONIBILIDADES_FILTRABLES.filter((v) => v === "aca" || v === "no-aca").map((v) => ({ valor: v, etiqueta: ETIQUETA_DE_LA_DISPONIBILIDAD[v] })) },
          { nombre: "falta", etiqueta: "Le falta algo", valor: filtros.falta ?? "", opciones: faltas.map((v) => ({ valor: v, etiqueta: ETIQUETA_DE_LA_FALTA[v] })) },
        ]}
      />
        </BarraDeFiltros>
      {pagina.items.length === 0 ? (
        <p className="text-sm text-tinta-suave">Sin resultados</p>
      ) : (
        <ul aria-label="Productos" className="divide-y divide-borde rounded border border-borde bg-superficie">
          {pagina.items.map((p) => (
            <li key={p.id} data-producto={p.id} className="flex flex-col gap-1 px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/catalogo/productos/${p.id}`} className="inline-flex min-h-11 min-w-0 items-center font-medium underline md:min-h-0">
                  {p.nombre}
                </Link>
                {p.sucursalesDisponibles === 0 && <Insignia tono="aviso">Desactivado</Insignia>}
                {p.sucursalesDisponibles > 0 && faltaCompletar.has(p.id) && <Insignia tono="aviso">Falta completar</Insignia>}
              </div>
              <div className="flex items-start justify-between gap-3 text-sm text-tinta-suave">
                <span>{ETIQUETA_DEL_TIPO[detalle.get(p.id)!.clase]}</span>
                {detalle.get(p.id)!.precio !== null && <span className="shrink-0 font-medium tabular-nums text-tinta">{detalle.get(p.id)!.precio}</span>}
              </div>
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
