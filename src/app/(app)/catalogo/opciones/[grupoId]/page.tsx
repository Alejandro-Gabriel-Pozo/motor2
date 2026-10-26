import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { denegacionDeModuloDeAccion } from "@/server/acceso/modulos-de-empresa";
import { agregarVersionDeOpcion, archivarOpciones, crearOpcionDeGrupo, editarGrupoDeOpciones, editarOpcionDeGrupo, reordenarOpcionesDeGrupo } from "@/server/actions/catalogo/opciones-de-venta";
import { cargarGrupoDelPanel, type CambioDeOpcionDelPanel, type OpcionDelPanel } from "@/server/consultas/catalogo/opciones-de-venta";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { nombreDelTipoDeGrupo, resumenDeConsumos, textoDeDiferencia, textoDeLimites } from "@/core/opciones/public";
import { formatearCantidad, formatearMonto } from "@/core/pos/public";
import { formatearFechaHora } from "@/core/tiempo/zona-horaria";
import { AgregarColapsable } from "@/components/agregar-colapsable";
import { AvisoConDeshacer, BotonConDeshacer } from "@/components/aviso-con-deshacer";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { EnlaceInterno } from "@/components/enlace-interno";
import { FormConResultado } from "@/components/form-con-resultado";
import { GrupoDeFormularios } from "@/components/grupo-de-formularios";
import { Aviso } from "@/ui/primitivas/aviso";
import { Campo } from "@/ui/primitivas/campo";
import { Insignia } from "@/ui/primitivas/insignia";
import { AltaDeOpcion } from "./alta-de-opcion";
import { CampoSeLeeEnLaCarta } from "./campo-se-lee-en-la-carta";
import { CambiarPrecio } from "./cambiar-precio";
import { OrdenarOpciones } from "./ordenar-opciones";
import { versionDelFormulario } from "./version-del-formulario";

/** Paso entre el orden de una opción y la siguiente (el mismo del «mover tocando»): una opción nueva va al final, dejando lugar para mover otra entre dos. */
const PASO_DE_ORDEN = 10;

/** «+ $ 400», «+ 16 %», «+ $ 600» (recargo) o «sin recargo»; en un tamaño, además, cuánto consume. */
function precioDeLaOpcion(tipo: string, o: OpcionDelPanel, rige: CambioDeOpcionDelPanel | undefined = o.cambios[0]): string {
  if (!rige) return "Sin precio cargado";
  if (o.esNinguna || tipo === "INCLUIDA") return "Incluida, sin recargo";
  const diferencia = textoDeDiferencia(rige.diferencia, formatearMonto);
  if (tipo === "ADICIONAL") return `Recargo ${diferencia}`;
  const factor = tipo === "MEDIDA" && rige.factorEscala !== null ? ` · consume ×${formatearCantidad(rige.factorEscala)}` : "";
  return `${diferencia === "sin recargo" ? "Mismo precio" : diferencia}${factor}`;
}

/**
 * La pantalla de UN grupo de opciones de venta (GO-2d; ADR-030): sus datos, sus opciones y el orden. Misma familia que la lista (`opciones_definir`): entrar pide «Ver» y los
 * formularios se dibujan solo con «Editar» (cortesía de la interfaz: cada acción vuelve a exigir el permiso).
 *
 * Concurrencia (control de versión optimista): cada formulario manda la `version` de la fila que la pantalla mostraba; si otra persona guardó antes, el servidor lo rechaza con su
 * mensaje y aparece «Recargar» (`ofrecerRecargar`). Todos los formularios van en un `GrupoDeFormularios`: mientras uno guarda, los demás esperan (sino saldrían con la versión de antes).
 * Lo que cobra y consume una opción no se edita en el lugar: se le carga un cambio de precio (que rige desde que se carga; el historial queda).
 *
 * OPCIONES-LIMPIEZA: el grupo y cada opción se ARCHIVAN con un toque (sin pantalla de confirmación) y «Deshacer» a la vista (`AvisoConDeshacer`); lo archivado no se ofrece en la venta
 * ni en la carta y queda aparte, con «Restaurar». Lo ya vendido no cambia. El orden sigue incluyendo las archivadas (el orden es de todas las opciones del grupo).
 *
 * Los closures "use server" capturan solo textos y números: lo que captura un closure viaja al cliente.
 */
export default async function GrupoDeOpcionesPage({ params }: { params: Promise<{ grupoId: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "opciones_definir", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const { grupoId } = await params;
  const [{ editar: puedeEditar }, { editar: puedeEditarOpcionesDelProducto }, { ver: puedeVerRecetas }, sinRecetas] = await Promise.all([
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "opciones_definir", ctx.db),
    // Cortesía de la interfaz (no barrera: el paso 2 vuelve a exigirlo): a quien puede editar lo que un producto admite, «Productos que lo usan» lo lleva directo a ese paso; a los demás, a la portada del producto.
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_opciones_admitidas", ctx.db),
    // OPCIONES-FACTOR: la receta de referencia del factor de un tamaño solo se lee y se muestra a quien ve las recetas (el «Ver» de `guardar_receta`).
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "guardar_receta", ctx.db),
    // D-3 (GO-2a): los consumos de una opción exigen el módulo Recetas; sin él, la opción se guarda sin consumos y la pantalla no ofrece el editor.
    denegacionDeModuloDeAccion("guardar_receta", ctx.empresaId, ctx.db),
  ]);
  // Sin el módulo Recetas o sin su «Ver», el factor muestra solo la frase («30% más»), sin la receta.
  const datos = await cargarGrupoDelPanel(ctx.db, grupoId, ctx.sucursalId, puedeVerRecetas && !sinRecetas);
  if (!datos) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-error">No se encontró ese grupo de opciones.</p>
        <Link href="/catalogo/opciones" className="text-sm underline">
          ← Volver a Opciones de venta
        </Link>
      </div>
    );
  }

  const { grupo, opciones, productos } = datos;
  const id = grupo.id;
  const tipo = grupo.tipo;
  const version = grupo.version;
  const nombreGrupo = grupo.nombre;
  const minimo = grupo.cantidadMinima;
  const maximo = grupo.cantidadMaxima;
  const activo = grupo.activo;
  const esTamano = tipo === "MEDIDA";
  // Fase 4 (ADR-035): «se lee en la carta como», solo en variantes y tamaños.
  const conPrefijo = tipo === "VARIANTE" || tipo === "MEDIDA";
  const admiteNinguna = (tipo === "VARIANTE" || tipo === "INCLUIDA") && !opciones.some((o) => o.esNinguna);
  const siguienteOrden = (opciones.reduce((max, o) => Math.max(max, o.orden), 0) || 0) + PASO_DE_ORDEN;
  const referencia = datos.referencia ? { ...datos.referencia, sucursalNombre: ctx.sucursalNombre } : null;
  const recetaDeReferencia = esTamano && datos.recetaDeReferencia ? { ...datos.recetaDeReferencia, sucursalNombre: ctx.sucursalNombre } : null;
  const insumos = sinRecetas ? null : datos.insumos;
  const usanElGrupo = productos.length === 1 ? "Lo usa 1 producto" : `Lo usan ${productos.length} productos`;
  const enUso = opciones.filter((o) => o.activa);
  const archivadas = opciones.filter((o) => !o.activa);
  const archivarElGrupo = async (archivar: boolean) => {
    "use server";
    return archivarOpciones({ grupoIds: [id], opcionIds: [], archivar });
  };

  return (
    <GrupoDeFormularios className="flex max-w-3xl flex-col gap-8 pb-24">
      <AvisoConDeshacer>
        <div className="flex flex-col gap-1">
          <Link href="/catalogo/opciones" className="text-sm underline">
            ← Opciones de venta
          </Link>
          <h1 className="mt-2 text-xl font-semibold">{nombreGrupo}</h1>
          <p className="text-sm text-tinta-suave">
            {nombreDelTipoDeGrupo(tipo)} (el tipo no se puede cambiar) · {textoDeLimites(minimo, maximo)} · {activo ? "En uso" : "Archivado"}
          </p>
        </div>

        {!activo && (
          <div role="note" data-grupo-archivado-aviso="" className="flex flex-wrap items-center gap-3 border-l-4 border-aviso-tinta bg-aviso-tinte px-3 py-2.5 text-sm text-tinta">
            <p className="min-w-0 flex-1">
              Este grupo está archivado: no se ofrece en ningún producto ni en la carta. Lo ya vendido queda como se vendió.
            </p>
            {puedeEditar && (
              <BotonConDeshacer valor={false} principal etiquetaAccesible={`Restaurar el grupo ${nombreGrupo}`} accion={archivarElGrupo}>
                Restaurar
              </BotonConDeshacer>
            )}
          </div>
        )}

        <section aria-labelledby="titulo-datos" className="flex flex-col gap-3">
          <h2 id="titulo-datos" className="text-lg font-medium">
            Datos del grupo
          </h2>
          {puedeEditar ? (
            <>
              <FormConResultado
                ofrecerRecargar
                accion={async (formData: FormData) => {
                  "use server";
                  return editarGrupoDeOpciones({
                    grupoId: id,
                    versionEsperada: version,
                    nombre: String(formData.get("nombre") ?? ""),
                    cantidadMinima: numeroDelCampo(String(formData.get("cantidadMinima") ?? "")),
                    cantidadMaxima: numeroDelCampo(String(formData.get("cantidadMaxima") ?? "")),
                    activo,
                    // Fase 4: va siempre (vacío = sin prefijo), así entra en la comparación de la versión; en los demás tipos no se manda.
                    ...(conPrefijo ? { prefijoEnCarta: String(formData.get("prefijoEnCarta") ?? "") } : {}),
                  });
                }}
                className="flex max-w-xl flex-col gap-3"
              >
                {/* El «Nombre» lleva su rótulo atado por afuera (y no el `etiqueta` de Campo): con `required` Campo le suma un asterisco al texto, y esta pantalla la fotografía la línea de base de navegador. */}
                <div className="flex flex-col gap-1">
                  <label htmlFor="grupo-nombre" className="text-sm font-medium">
                    Nombre
                  </label>
                  <Campo nombradoPorFuera id="grupo-nombre" name="nombre" required maxLength={120} defaultValue={nombreGrupo} />
                </div>
                <div className="flex flex-wrap gap-4">
                  <Campo etiqueta="Mínimo a elegir" id="grupo-minimo" name="cantidadMinima" inputMode="numeric" defaultValue={minimo} readOnly={esTamano} className="max-w-24" />
                  <Campo etiqueta="Máximo a elegir" id="grupo-maximo" name="cantidadMaxima" inputMode="numeric" defaultValue={maximo} readOnly={esTamano} className="max-w-24" />
                </div>
                <p className="text-xs text-tinta-suave">
                  {esTamano ? "Un tamaño se elige siempre una vez: mínimo 1 y máximo 1." : tipo === "INCLUIDA" ? "Lo incluido es obligatorio: el mínimo es 1 o más." : "Con mínimo 0 el grupo es opcional."}
                </p>
                {conPrefijo && <CampoSeLeeEnLaCarta prefijoInicial={grupo.prefijoEnCarta} opciones={enUso.map((o) => ({ nombre: o.nombre, esNinguna: o.esNinguna }))} />}
                <BotonDeServidor type="submit" className="self-start">
                  Guardar
                </BotonDeServidor>
              </FormConResultado>
              {activo && (
                <div className="flex flex-col gap-1 sm:items-start">
                  <BotonConDeshacer valor={true} etiquetaAccesible={`Archivar el grupo ${nombreGrupo}`} accion={archivarElGrupo}>
                    Archivar grupo
                  </BotonConDeshacer>
                  <p className="text-xs text-tinta-suave">
                    {usanElGrupo}: archivado, no se ofrece en ninguno{minimo > 0 ? " y, como es obligatorio, esos productos no se van a poder vender" : ""}. Se restaura con un toque desde «Archivados».
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-tinta-suave">Tu rol puede ver este grupo pero no cambiarlo.</p>
          )}
        </section>

        <section aria-labelledby="titulo-opciones" className="flex flex-col gap-3">
          <h2 id="titulo-opciones" className="text-lg font-medium">
            Opciones
          </h2>
          {enUso.length === 0 ? (
            <Aviso variante="informacion" forma="en-linea">
              {opciones.length > 0
                ? "No hay opciones en uso: están todas archivadas (abajo)."
                : `Este grupo todavía no tiene opciones${puedeEditar ? ": agregá la primera con «Agregar opción»." : "."}`}
            </Aviso>
          ) : (
            <ul aria-label={`Opciones de ${nombreGrupo}`} className="flex flex-col divide-y rounded border">
              {enUso.map((o) => {
                const opcionId = o.id;
                const versionOpcion = o.version;
                const nombre = o.nombre;
                const orden = o.orden;
                const activa = o.activa;
                const rige = o.cambios[0];
                const numeroVigente = rige?.numero ?? 0;
                return (
                  <li key={o.id} data-opcion={o.nombre} className="flex flex-col gap-2 p-3">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{o.nombre}</span>
                      {o.esNinguna && <Insignia>ninguna</Insignia>}
                      <span className="text-sm text-tinta-suave">{precioDeLaOpcion(tipo, o)}</span>
                    </div>
                    {rige && !o.esNinguna && <p className="text-sm text-tinta-suave">Consumo: {resumenDeConsumos(rige.consumos, formatearCantidad)}</p>}
                    {rige && (
                      <p className="text-xs text-tinta-suave">
                        Rige desde {formatearFechaHora(rige.creadoEn, ctx.empresaZonaHoraria)} · cargó {rige.creadoPor}
                      </p>
                    )}
                    {o.cambios.length > 1 && (
                      <details className="text-sm">
                        <summary className="min-h-[44px] cursor-pointer py-2 underline">Cambios de precio anteriores ({o.cambios.length - 1})</summary>
                        <ol className="flex flex-col gap-1 pl-4">
                          {o.cambios.slice(1).map((c) => (
                            <li key={c.numero} className="text-xs text-tinta-suave">
                              Desde {formatearFechaHora(c.creadoEn, ctx.empresaZonaHoraria)} · cargó {c.creadoPor}: {precioDeLaOpcion(tipo, o, c)}
                              {!o.esNinguna && ` · ${resumenDeConsumos(c.consumos, formatearCantidad)}`}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                    {o.anclaNombre && <p className="text-xs text-tinta-suave">Stock en el producto interno «{o.anclaNombre}» (lo maneja el sistema).</p>}
                    {puedeEditar && (
                      <div className="flex flex-wrap items-start gap-4">
                        <FormConResultado
                          ofrecerRecargar
                          accion={async (formData: FormData) => {
                            "use server";
                            return editarOpcionDeGrupo({ opcionId, versionEsperada: versionOpcion, nombre: String(formData.get("nombre") ?? ""), orden, activa });
                          }}
                          className="flex flex-col gap-1"
                        >
                          <div className="flex items-center gap-2">
                            <label htmlFor={`opcion-nombre-${o.id}`} className="sr-only">
                              Nombre de {o.nombre}
                            </label>
                            <div className="w-48">
                              <Campo nombradoPorFuera id={`opcion-nombre-${o.id}`} name="nombre" required maxLength={120} defaultValue={nombre} tamano="compacto" />
                            </div>
                            <BotonDeServidor variante="enlace" tamano="tactil" type="submit" aria-label={`Renombrar ${nombre}`}>
                              Renombrar
                            </BotonDeServidor>
                          </div>
                        </FormConResultado>
                        {rige && (
                          <CambiarPrecio
                            nombre={nombre}
                            tipo={tipo}
                            esNinguna={o.esNinguna}
                            referencia={referencia}
                            receta={recetaDeReferencia}
                            insumos={insumos}
                            rige={{
                              diferencia: rige.diferencia,
                              factorEscala: rige.factorEscala,
                              consumos: rige.consumos.map((c) => ({
                                efecto: c.efecto,
                                insumoProductoId: c.insumoProductoId,
                                reemplazaAProductoId: c.reemplazaAProductoId ?? "",
                                cantidad: String(c.cantidad),
                                mermaPorcentaje: c.mermaPorcentaje ? String(c.mermaPorcentaje) : "",
                                escalaConLaMedida: c.escalaConLaMedida,
                              })),
                            }}
                            accion={async (formData: FormData) => {
                              "use server";
                              return agregarVersionDeOpcion({ opcionId, numeroEsperado: numeroVigente, version: versionDelFormulario(formData) });
                            }}
                          />
                        )}
                        <BotonConDeshacer
                          valor={true}
                          etiquetaAccesible={`Archivar ${nombre}`}
                          accion={async (archivar: boolean) => {
                            "use server";
                            return archivarOpciones({ grupoIds: [], opcionIds: [opcionId], archivar });
                          }}
                        >
                          Archivar
                        </BotonConDeshacer>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {archivadas.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">Opciones archivadas ({archivadas.length})</h3>
              <p className="text-sm text-tinta-suave">No se ofrecen en ningún producto ni en la carta. Restaurarlas las vuelve a ofrecer donde estaban.</p>
              <ul aria-label={`Opciones archivadas de ${nombreGrupo}`} className="flex flex-col gap-2">
                {archivadas.map((o) => {
                  const opcionId = o.id;
                  return (
                    <li key={o.id} data-opcion-archivada={o.nombre} className="flex flex-wrap items-center gap-3 border border-borde-control bg-superficie px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="font-medium [overflow-wrap:anywhere]">{o.nombre}</span>
                        <p className="text-xs text-tinta-suave">{precioDeLaOpcion(tipo, o)}</p>
                      </div>
                      {puedeEditar && (
                        <BotonConDeshacer
                          valor={false}
                          etiquetaAccesible={`Restaurar ${o.nombre}`}
                          accion={async (archivar: boolean) => {
                            "use server";
                            return archivarOpciones({ grupoIds: [], opcionIds: [opcionId], archivar });
                          }}
                        >
                          Restaurar
                        </BotonConDeshacer>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {puedeEditar && opciones.length > 1 && (
            <OrdenarOpciones
              opciones={opciones.map((o) => ({ id: o.id, nombre: o.nombre, version: o.version, esNinguna: o.esNinguna, activa: o.activa }))}
              accion={async (orden) => {
                "use server";
                return reordenarOpcionesDeGrupo({ grupoId: id, opciones: orden });
              }}
            />
          )}
          {puedeEditar && (
            <AgregarColapsable etiqueta="Agregar opción">
              <AltaDeOpcion
                tipo={tipo}
                admiteNinguna={admiteNinguna}
                referencia={referencia}
                receta={recetaDeReferencia}
                unidades={datos.unidades}
                insumos={insumos}
                accion={async (formData: FormData) => {
                  "use server";
                  const unidadAncla = String(formData.get("unidadAncla") ?? "");
                  return crearOpcionDeGrupo({
                    grupoId: id,
                    nombre: String(formData.get("nombre") ?? ""),
                    orden: siguienteOrden,
                    esNinguna: formData.get("esNinguna") === "on",
                    version: versionDelFormulario(formData),
                    ancla: tipo === "ADICIONAL" ? { unidadStockId: unidadAncla } : null,
                  });
                }}
              />
            </AgregarColapsable>
          )}
        </section>

        <section aria-labelledby="titulo-productos" className="flex flex-col gap-2">
          <h2 id="titulo-productos" className="text-lg font-medium">
            Productos que lo usan
          </h2>
          {productos.length === 0 ? (
            <p className="text-sm text-tinta-suave">Ningún producto lo usa todavía. Qué grupos usa cada producto se elige en su ficha.</p>
          ) : (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {productos.map((p) => (
                <li key={p.id}>
                  <EnlaceInterno href={`/catalogo/productos/${p.id}${puedeEditarOpcionesDelProducto ? "/opciones" : ""}`} className="underline">
                    {p.nombre}
                  </EnlaceInterno>
                </li>
              ))}
            </ul>
          )}
        </section>
      </AvisoConDeshacer>
    </GrupoDeFormularios>
  );
}
