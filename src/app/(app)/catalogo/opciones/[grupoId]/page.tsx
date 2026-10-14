import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { denegacionDeModuloDeAccion } from "@/server/acceso/modulos-de-empresa";
import { agregarVersionDeOpcion, crearOpcionDeGrupo, editarGrupoDeOpciones, editarOpcionDeGrupo, reordenarOpcionesDeGrupo } from "@/server/actions/catalogo/opciones-de-venta";
import { cargarGrupoDelPanel, type CambioDeOpcionDelPanel, type OpcionDelPanel } from "@/server/consultas/catalogo/opciones-de-venta";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { nombreDelTipoDeGrupo, resumenDeConsumos, textoDeDiferencia, textoDeLimites } from "@/core/opciones/public";
import { formatearCantidad, formatearMonto } from "@/core/pos/public";
import { formatearFechaHora } from "@/core/tiempo/zona-horaria";
import { ActivarDesactivarFila } from "@/components/activar-desactivar-fila";
import { AgregarColapsable } from "@/components/agregar-colapsable";
import { EnlaceInterno } from "@/components/enlace-interno";
import { FormConResultado } from "@/components/form-con-resultado";
import { GrupoDeFormularios } from "@/components/grupo-de-formularios";
import { AltaDeOpcion } from "./alta-de-opcion";
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
 * Los closures "use server" capturan solo textos y números: lo que captura un closure viaja al cliente.
 */
export default async function GrupoDeOpcionesPage({ params }: { params: Promise<{ grupoId: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "opciones_definir", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { grupoId } = await params;
  const [{ editar: puedeEditar }, datos, sinRecetas] = await Promise.all([
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "opciones_definir", ctx.db),
    cargarGrupoDelPanel(ctx.db, grupoId, ctx.sucursalId),
    // D-3 (GO-2a): los consumos de una opción exigen el módulo Recetas; sin él, la opción se guarda sin consumos y la pantalla no ofrece el editor.
    denegacionDeModuloDeAccion("guardar_receta", ctx.empresaId, ctx.db),
  ]);
  if (!datos) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-red-600">No se encontró ese grupo de opciones.</p>
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
  const admiteNinguna = (tipo === "VARIANTE" || tipo === "INCLUIDA") && !opciones.some((o) => o.esNinguna);
  const siguienteOrden = (opciones.reduce((max, o) => Math.max(max, o.orden), 0) || 0) + PASO_DE_ORDEN;
  const referencia = datos.referencia ? { ...datos.referencia, sucursalNombre: ctx.sucursalNombre } : null;
  const insumos = sinRecetas ? null : datos.insumos;
  const usanElGrupo = productos.length === 1 ? "Lo usa 1 producto" : `Lo usan ${productos.length} productos`;

  return (
    <GrupoDeFormularios className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href="/catalogo/opciones" className="text-sm underline">
          ← Opciones de venta
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{nombreGrupo}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {nombreDelTipoDeGrupo(tipo)} (el tipo no se puede cambiar) · {textoDeLimites(minimo, maximo)} · {activo ? "Prendido" : "Apagado para toda la empresa"}
        </p>
      </div>

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
                });
              }}
              className="flex max-w-xl flex-col gap-3"
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="grupo-nombre" className="text-sm font-medium">
                  Nombre
                </label>
                <input id="grupo-nombre" name="nombre" required maxLength={120} defaultValue={nombreGrupo} className="rounded border px-3 py-2" />
              </div>
              <div className="flex flex-wrap gap-4">
                <div className="flex flex-col gap-1">
                  <label htmlFor="grupo-minimo" className="text-sm font-medium">
                    Mínimo a elegir
                  </label>
                  <input id="grupo-minimo" name="cantidadMinima" inputMode="numeric" defaultValue={minimo} readOnly={esTamano} className="w-24 rounded border px-3 py-2 read-only:bg-neutral-100 dark:read-only:bg-neutral-800" />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="grupo-maximo" className="text-sm font-medium">
                    Máximo a elegir
                  </label>
                  <input id="grupo-maximo" name="cantidadMaxima" inputMode="numeric" defaultValue={maximo} readOnly={esTamano} className="w-24 rounded border px-3 py-2 read-only:bg-neutral-100 dark:read-only:bg-neutral-800" />
                </div>
              </div>
              <p className="text-xs text-neutral-600 dark:text-neutral-400">
                {esTamano ? "Un tamaño se elige siempre una vez: mínimo 1 y máximo 1." : tipo === "INCLUIDA" ? "Lo incluido es obligatorio: el mínimo es 1 o más." : "Con mínimo 0 el grupo es opcional."}
              </p>
              <button type="submit" className="self-start rounded bg-neutral-900 px-4 py-2 text-white">
                Guardar
              </button>
            </FormConResultado>
            <ActivarDesactivarFila
              activo={activo}
              aviso={`${usanElGrupo}: apagado, no se ofrece en ninguno${minimo > 0 ? " y, como es obligatorio, esos productos no se van a poder vender" : ""}.`}
              accion={async () => {
                "use server";
                return editarGrupoDeOpciones({ grupoId: id, versionEsperada: version, nombre: nombreGrupo, cantidadMinima: minimo, cantidadMaxima: maximo, activo: !activo });
              }}
            />
          </>
        ) : (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Tu rol puede ver este grupo pero no cambiarlo.</p>
        )}
      </section>

      <section aria-labelledby="titulo-opciones" className="flex flex-col gap-3">
        <h2 id="titulo-opciones" className="text-lg font-medium">
          Opciones
        </h2>
        {opciones.length === 0 ? (
          <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">
            Este grupo todavía no tiene opciones{puedeEditar ? ": agregá la primera con «Agregar opción»." : "."}
          </p>
        ) : (
          <ul aria-label={`Opciones de ${nombreGrupo}`} className="flex flex-col divide-y rounded border">
            {opciones.map((o) => {
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
                    {o.esNinguna && <span className="rounded bg-neutral-100 px-1.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">ninguna</span>}
                    {!o.activa && <span className="rounded bg-neutral-100 px-1.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">apagada</span>}
                    <span className="text-sm text-neutral-700 dark:text-neutral-300">{precioDeLaOpcion(tipo, o)}</span>
                  </div>
                  {rige && !o.esNinguna && <p className="text-sm text-neutral-700 dark:text-neutral-300">Consumo: {resumenDeConsumos(rige.consumos, formatearCantidad)}</p>}
                  {rige && (
                    <p className="text-xs text-neutral-600 dark:text-neutral-400">
                      Rige desde {formatearFechaHora(rige.creadoEn, ctx.empresaZonaHoraria)} · cargó {rige.creadoPor}
                    </p>
                  )}
                  {o.cambios.length > 1 && (
                    <details className="text-sm">
                      <summary className="min-h-[44px] cursor-pointer py-2 underline">Cambios de precio anteriores ({o.cambios.length - 1})</summary>
                      <ol className="flex flex-col gap-1 pl-4">
                        {o.cambios.slice(1).map((c) => (
                          <li key={c.numero} className="text-xs text-neutral-700 dark:text-neutral-300">
                            Desde {formatearFechaHora(c.creadoEn, ctx.empresaZonaHoraria)} · cargó {c.creadoPor}: {precioDeLaOpcion(tipo, o, c)}
                            {!o.esNinguna && ` · ${resumenDeConsumos(c.consumos, formatearCantidad)}`}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                  {o.anclaNombre && <p className="text-xs text-neutral-600 dark:text-neutral-400">Stock en el producto interno «{o.anclaNombre}» (lo maneja el sistema).</p>}
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
                          <input id={`opcion-nombre-${o.id}`} name="nombre" required maxLength={120} defaultValue={nombre} className="w-48 rounded border px-2 py-1 text-sm" />
                          <button type="submit" className="min-h-[44px] text-sm underline" aria-label={`Renombrar ${nombre}`}>
                            Renombrar
                          </button>
                        </div>
                      </FormConResultado>
                      {rige && (
                        <CambiarPrecio
                          nombre={nombre}
                          tipo={tipo}
                          esNinguna={o.esNinguna}
                          referencia={referencia}
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
                      <ActivarDesactivarFila
                        activo={activa}
                        aviso={`Apagada, «${nombre}» no se ofrece en ningún producto.`}
                        accion={async () => {
                          "use server";
                          return editarOpcionDeGrupo({ opcionId, versionEsperada: versionOpcion, nombre, orden, activa: !activa });
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
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
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Ningún producto lo usa todavía. Qué grupos usa cada producto se elige en su ficha.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {productos.map((p) => (
              <li key={p.id}>
                <EnlaceInterno href={`/catalogo/productos/${p.id}`} className="underline">
                  {p.nombre}
                </EnlaceInterno>
              </li>
            ))}
          </ul>
        )}
      </section>
    </GrupoDeFormularios>
  );
}
