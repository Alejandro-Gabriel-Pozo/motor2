import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { fijarAdmisionDeGrupoEnProducto, vincularGrupoEnProducto } from "@/server/actions/catalogo/opciones-de-venta";
import { basesDeUnEjeEnLaCarta } from "@/server/consultas/carta/admin";
import { cargarVistaPreviaDeLaCarta } from "@/server/consultas/carta/vista-previa-de-un-producto";
import { leerProductoDelEspacio } from "@/server/consultas/catalogo/espacio-del-producto";
import { cargarOpcionesDelProducto } from "@/server/consultas/catalogo/opciones-de-venta";
import { nombreDelTipoDeGrupo, referenciaDePrecioDeAdmisiones } from "@/core/opciones/public";
import { formatearMonto } from "@/core/pos/public";
import { AvisoConDeshacer, BotonConDeshacer } from "@/components/aviso-con-deshacer";
import { GrupoDeFormularios } from "@/components/grupo-de-formularios";
import { AgregarGrupoExistente } from "@/components/catalogo/agregar-grupo-existente";
import { NuevoGrupoEnElProducto } from "@/components/catalogo/nuevo-grupo-en-el-producto";
import { ResumenDeOpciones } from "@/components/catalogo/resumen-de-opciones";
import { cargarMarcoDelEspacio } from "@/components/catalogo/espacio-del-producto/datos-del-marco";
import { MarcoDelEspacio } from "@/components/catalogo/espacio-del-producto/marco";
import { VistaPreviaDeLaCarta } from "@/components/catalogo/espacio-del-producto/vista-previa-de-la-carta";
import { EnlaceInterno } from "@/components/enlace-interno";
import { Aviso } from "@/ui/primitivas/aviso";
import { Enlace } from "@/ui/primitivas/enlace";
import { AdmisionDeGrupo } from "./admision-de-grupo";
import { admisionDelFormulario } from "./admision-del-formulario";

/** Paso entre el orden de un grupo y el siguiente en el producto: uno nuevo va al final, con lugar para poner otro entre dos. */
const PASO_DE_ORDEN = 10;

/**
 * Paso 2 del espacio del producto, «Opciones y precio» (GO-2d; ADR-030; Fase 6, 6.15b y 6.15c; DEC-12): qué grupos admite el producto, con qué límites propios, cómo se cobra cada tamaño y qué opciones de cada
 * grupo. Está DENTRO del marco del espacio (`MarcoDelEspacio`: el `h1` es el producto y la tira de pasos), con una tarjeta por grupo. Es una página de EDICIÓN: la familia es la de la ficha
 * (`producto_ver_catalogo`, el primer gate), y además exige el permiso de Editar de `producto_opciones_admitidas` en el servidor (el guardián `paginas-con-guarda-de-editar` lo fija): quien solo ve el
 * producto no llega a ver el formulario. Al pie, «Así se cobra en la sucursal», calculado por el servidor con la misma regla que la venta; se refresca al guardar.
 *
 * Cómo se suma un grupo, sin salir del producto: «Agregar un grupo existente» (una ventana con el selector de la biblioteca; la acción es el cierre de esta página) y «+ Nuevo grupo» (una ventana que
 * crea el grupo, sus opciones y lo que el producto admite de ellas, todo o nada, con `crearGrupoEnElProducto`). El segundo pide además Editar de `opciones_definir`: se calcula ACÁ, en el servidor, y sin
 * esa clave no se dibuja el botón (la acción vuelve a exigir las dos claves; esto es cortesía de la interfaz).
 *
 * Cada grupo es un formulario aparte (`GrupoDeFormularios`: mientras uno guarda, los demás esperan) con la versión de sus filas que vio la pantalla. Los closures "use server"
 * capturan solo textos, números y listas de ids.
 *
 * OPCIONES-LIMPIEZA: «Quitar de este producto» saca un grupo de un toque, con «Deshacer» a la vista (`AvisoConDeshacer`), sin borrar nada: lo que el producto admitía de cada opción
 * queda guardado y el grupo pasa a «Quitados de este producto», con «Volver a vincular» (las mismas reglas que guardar el formulario).
 */
export default async function OpcionesDelProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <Aviso variante="error" forma="en-linea">{MENSAJE_DEMASIADAS_LECTURAS}</Aviso>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_ver_catalogo", ctx.db);
  if (!gate.ok) return <Aviso variante="error" forma="en-linea">{gate.mensaje}</Aviso>;
  const gateEditar = await requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_opciones_admitidas", ctx.db);
  if (!gateEditar.ok) return <Aviso variante="error" forma="en-linea">{gateEditar.mensaje}</Aviso>;

  const { id } = await params;
  const [datos, productoDelEspacio] = await Promise.all([cargarOpcionesDelProducto(ctx.db, id, ctx.sucursalId), leerProductoDelEspacio(ctx.db, id)]);
  if (!datos || !productoDelEspacio) notFound();
  const { producto, admitidos, paraAgregar } = datos;
  const productoId = producto.id;
  if (producto.tipo !== "PV" || producto.esAnclaDeAdicional) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">
          <Enlace href={`/catalogo/productos/${productoId}`}>← {producto.nombre}</Enlace>
        </p>
        <Aviso variante="error" forma="en-linea">
          {producto.esAnclaDeAdicional ? `«${producto.nombre}» es el producto interno de un adicional: no admite opciones.` : `«${producto.nombre}» no es un producto de venta: solo un producto de venta admite opciones.`}
        </Aviso>
      </div>
    );
  }
  // El marco (la tira de pasos con su enlace y su estado). Las opciones ya están leídas: no se vuelven a leer. Y si el usuario además puede CREAR grupos (Editar de `opciones_definir`), se dibuja «+ Nuevo grupo».
  const [marco, puedeCrearGrupos] = await Promise.all([
    cargarMarcoDelEspacio(ctx, productoDelEspacio, { opciones: datos }),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "opciones_definir", ctx.db).then((nivel) => nivel.editar),
  ]);
  const puedeEditarDatos = marco.pasos.some((p) => p.paso === "datos" && p.href !== null);
  // La vista previa de la carta (6.18): el «nombre arriba» es del contenido de carta del producto, así que solo se lee si quien mira puede abrir el paso «En la carta»; si no, se dibuja con el valor por defecto.
  const puedeVerLaCarta = marco.pasos.some((p) => p.paso === "en-la-carta" && p.href !== null);
  const mostrarNombreArriba = puedeVerLaCarta ? ((await basesDeUnEjeEnLaCarta(ctx.sucursalId, ctx.db)).get(productoId) ?? false) : false;
  const vistaPreviaDeLaCarta = await cargarVistaPreviaDeLaCarta(ctx.db, ctx.sucursalId, { id: productoId, precioVenta: productoDelEspacio.precioVenta, esBase: producto.esBase }, mostrarNombreArriba);
  const enUso = admitidos.filter((g) => g.fila.activo);
  const quitados = admitidos.filter((g) => !g.fila.activo);
  // 6.15a: contra qué precio se lee lo que suma una opción (la lectura debajo de cada importe): lo más barato GUARDADO del grupo que fija el precio (una medida en ABSOLUTO reemplaza al precio base, en un
  // directo y en una base) o, si no hay, el precio de lista. Un producto que se vende por opción cobra el precio de sus opciones y no el guardado: sin referencia, no hay con qué sumar y no se lee (`null`).
  const referencia = referenciaDePrecioDeAdmisiones(enUso);
  const precioDeLista = producto.esBase ? null : datos.precioBase;
  // Hay un grupo que fija el precio final de cada opción, pero el producto todavía se vende «Directo»: para cobrar por opción hay que marcarlo «Por opción» en el paso 1 (Qué se vende).
  const faltaMarcarloPorOpcion = !producto.esBase && enUso.some((g) => g.activoEnEmpresa && g.tipo === "MEDIDA" && g.fila.modoPrecio === "ABSOLUTO");
  const hayGrupoIncluido = enUso.some((g) => g.tipo === "INCLUIDA");
  const siguienteOrden = admitidos.reduce((max, g) => Math.max(max, g.fila.orden), 0) + PASO_DE_ORDEN;
  // Para «Agregar un grupo existente»: de cada grupo, su tipo y sus opciones prendidas, que se admiten todas al agregarlo (con la diferencia de cada opción; un adicional con el tope del
  // grupo, las demás con 1). Después se ajusta cada una en el formulario del grupo.
  const ofrecibles = paraAgregar.map((g) => ({
    grupoId: g.grupoId,
    tipo: g.tipo,
    opciones: g.opcionIds.map((opcionId) => ({ opcionId, versionEsperada: 0, cantidadMaxima: g.tipo === "ADICIONAL" ? g.cantidadMaxima : 1, precioAbsoluto: null, diferencia: null, activo: true })),
  }));

  return (
    <MarcoDelEspacio
      producto={{ id: productoId, nombre: producto.nombre, codigo: productoDelEspacio.codigo, tipo: "PV", modoDeVenta: productoDelEspacio.modoDeVenta, disponibleAca: marco.disponibleAca, sucursalNombre: ctx.sucursalNombre }}
      pasos={marco.pasos}
      actual="opciones"
    >
      <GrupoDeFormularios className="flex flex-col gap-6 pb-24">
        <AvisoConDeshacer>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-medium">Opciones y precio</h2>
            <p className="text-sm text-tinta-suave">
              Qué se elige al venderlo y cómo cambia el precio. Los grupos y sus opciones se arman en{" "}
              <EnlaceInterno href="/catalogo/opciones" className="underline">
                Opciones de venta
              </EnlaceInterno>
              .
            </p>
            <p className="text-sm text-tinta-suave" data-precio-de-la-sucursal="">
              {producto.esBase
                ? `Se vende por opción: el precio guardado (${formatearMonto(datos.precioBase)}) no se cobra, rige el precio final de cada opción.`
                : `Precio de lista en «${ctx.sucursalNombre}»: ${formatearMonto(datos.precioBase)}.`}{" "}
              El precio de cada sucursal se cambia en{" "}
              <EnlaceInterno href="/movimientos/precio-local" className="underline">
                Precio local
              </EnlaceInterno>
              .
            </p>
          </div>

          {faltaMarcarloPorOpcion ? (
            <Aviso variante="advertencia" data-falta-por-opcion="">
              Para venderlo por opción, marcalo «Por opción» en{" "}
              {puedeEditarDatos ? <Enlace href={`/catalogo/productos/${productoId}/datos`}>Qué se vende</Enlace> : <em>Qué se vende</em>}.
            </Aviso>
          ) : null}

          <div className="flex flex-wrap items-start gap-3">
            {puedeCrearGrupos ? <NuevoGrupoEnElProducto productoId={productoId} productoNombre={producto.nombre} referencia={referencia} precioDeLista={precioDeLista} /> : null}
            {paraAgregar.length > 0 ? (
              <AgregarGrupoExistente
                grupos={paraAgregar.map((g) => ({ grupoId: g.grupoId, etiqueta: `${g.nombre} (${nombreDelTipoDeGrupo(g.tipo)})` }))}
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
              />
            ) : (
              <p className="self-center text-sm text-tinta-suave">Este producto ya tiene todos los grupos prendidos de la empresa.</p>
            )}
          </div>
          {puedeCrearGrupos ? null : <p className="text-xs text-tinta-suave">Los grupos nuevos los crea quien arma las opciones.</p>}
          {hayGrupoIncluido ? <p className="text-xs text-tinta-suave">{'Para cobrar distinto una opción de un grupo "incluido", se archiva el grupo y se crea uno nuevo.'}</p> : null}

          {enUso.length === 0 ? (
            <Aviso variante="informacion" forma="en-linea">
              {quitados.length > 0 ? `«${producto.nombre}» no usa ningún grupo ahora: se vende con un toque. Los que tenía están abajo, en «Quitados de este producto».` : `«${producto.nombre}» todavía no admite opciones: se vende con un toque, como siempre.`}
            </Aviso>
          ) : (
            enUso.map((g) => {
              const grupoId = g.grupoId;
              const versionEsperada = g.fila.version;
              return (
                <section key={g.grupoId} aria-label={`Grupo ${g.nombre}`} className="flex flex-col gap-3 rounded border border-borde p-4" data-admision-grupo={g.nombre}>
                  <AdmisionDeGrupo
                    grupo={g}
                    referencia={referencia}
                    precioDeLista={precioDeLista}
                    accion={async (formData: FormData) => {
                      "use server";
                      return fijarAdmisionDeGrupoEnProducto({ productoId, grupoId, versionEsperada, ...admisionDelFormulario(formData) });
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-3 border-t border-borde pt-3">
                    <BotonConDeshacer
                      valor={false}
                      etiquetaAccesible={`Quitar ${g.nombre} de este producto`}
                      accion={async (vinculado: boolean) => {
                        "use server";
                        return vincularGrupoEnProducto({ productoId, grupoId, vinculado });
                      }}
                    >
                      Quitar de este producto
                    </BotonConDeshacer>
                    <span className="text-xs text-tinta-suave">No se borra nada: lo que admite de cada opción queda guardado.</span>
                  </div>
                </section>
              );
            })
          )}

          {quitados.length > 0 && (
            <section aria-labelledby="titulo-quitados" className="flex flex-col gap-2">
              <h3 id="titulo-quitados" className="text-lg font-medium">
                Quitados de este producto ({quitados.length})
              </h3>
              <ul aria-label="Grupos quitados de este producto" className="flex flex-col gap-2">
                {quitados.map((g) => {
                  const grupoId = g.grupoId;
                  return (
                    <li key={g.grupoId} data-grupo-quitado={g.nombre} className="flex flex-wrap items-center gap-3 rounded border border-borde bg-superficie px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="font-medium [overflow-wrap:anywhere]">{g.nombre}</span>
                        <p className="text-xs text-tinta-suave">
                          {nombreDelTipoDeGrupo(g.tipo)}
                          {g.activoEnEmpresa ? "" : " · archivado: restauralo en Opciones de venta antes de volver a vincularlo"}
                        </p>
                      </div>
                      <BotonConDeshacer
                        valor={true}
                        etiquetaAccesible={`Volver a vincular ${g.nombre}`}
                        accion={async (vinculado: boolean) => {
                          "use server";
                          return vincularGrupoEnProducto({ productoId, grupoId, vinculado });
                        }}
                      >
                        Volver a vincular
                      </BotonConDeshacer>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <VistaPreviaDeLaCarta nombre={producto.nombre} sucursalNombre={ctx.sucursalNombre} vista={vistaPreviaDeLaCarta} />

          <section aria-labelledby="titulo-asi-se-cobra" className="flex flex-col gap-2 rounded border border-borde p-4">
            <h3 id="titulo-asi-se-cobra" className="sr-only">
              Así se cobra
            </h3>
            <ResumenDeOpciones resumen={datos.vistaPrevia} sucursalNombre={ctx.sucursalNombre} />
          </section>
        </AvisoConDeshacer>
      </GrupoDeFormularios>
    </MarcoDelEspacio>
  );
}
