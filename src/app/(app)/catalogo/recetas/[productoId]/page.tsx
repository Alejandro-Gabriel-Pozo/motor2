import Link from "next/link";
import { EnlaceInterno } from "@/components/enlace-interno";
import { redirect } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { lecturaDeVerificacionEnLaEmpresa, lecturaEnSucursalesVisibles } from "@/server/acceso/alcance";
import { obtenerMiNivelPermiso, obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import {
  obtenerRecetaVigente,
  agregarIngredienteAReceta,
  actualizarIngredienteDeReceta,
  quitarIngredienteDeReceta,
  agregarPasoAReceta,
  reordenarPasosDeReceta,
  insertarPasoEnReceta,
  actualizarPasoDeReceta,
  quitarPasoDeReceta,
  actualizarCabeceraDeReceta,
} from "@/server/actions/catalogo/recetas";
import { listarUnidadesActivas } from "@/server/actions/catalogo/unidades";
import { disponibilidadDeProductoEnSucursales } from "@/server/consultas/catalogo/disponibilidad";
import { secuenciaMoviendo, unidadesDeLectura } from "@/core/catalogo/public";
import { obtenerProductoPorId } from "@/server/consultas/catalogo/productos";
import { leerProductoDelEspacio } from "@/server/consultas/catalogo/espacio-del-producto";
import { cargarMarcoDelEspacio } from "@/components/catalogo/espacio-del-producto/datos-del-marco";
import { MarcoDelEspacio } from "@/components/catalogo/espacio-del-producto/marco";
import {
  listarMpDisponiblesEnAlguna,
  listarOpcionesDeSustituto,
  listarCalibracionesDeIngredientes,
} from "@/server/consultas/catalogo/recetas";
import { CampoNumero } from "@/components/campo-numero";
import { LecturaDeCantidad } from "@/components/receta/lectura-de-cantidad";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { FormConResultado } from "@/components/form-con-resultado";
import { Aviso } from "@/ui/primitivas/aviso";
import { AreaDeTexto } from "@/ui/primitivas/area-de-texto";
import { Campo } from "@/ui/primitivas/campo";
import { Casilla } from "@/ui/primitivas/casilla";
import { Selector } from "@/ui/primitivas/selector";
import { GrupoDeFormularios } from "@/components/grupo-de-formularios";
import { AgregarColapsable } from "@/components/agregar-colapsable";
import { IconoDeAccion } from "@/components/iconos";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import { listarSucursalesConRecetaPropia, obtenerEstadoDeRecetaPropia } from "@/server/consultas/catalogo/receta-propia";
import { RecetaDeLaSucursal } from "./receta-de-la-sucursal";

export default async function RecetaEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ productoId: string }>;
  searchParams: Promise<ParametrosDeUrl<"editar" | "editarPaso" | "editarFicha" | "editarPropia">>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "guardar_receta", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const { productoId } = await params;
  // Rendimiento por sucursal (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 7): "Usar este valor" del
  // reporte de Rendimiento real de recetas YA NO navega acá con `?sugerido=` — calibra la sucursal directo
  // (fijarRendimientoLocal). Este editor solo toca la receta CENTRAL.
  const { editar, editarPaso, editarFicha, editarPropia } = unicosDeUrl(await searchParams);
  const ordenEnEdicion = editarPaso ? Number(editarPaso) : null;

  // P2 (RLS por sucursal): las materias primas del selector y las opciones de sustituto son «productos disponibles en ALGUNA sucursal»: se leen con la base de VERIFICACIÓN (lectura en toda la empresa, escritura como estaba). Salen filas de
  // `Producto` e `Insumo` (id, nombre, unidad), nunca la disponibilidad de otra sucursal. Lo que la pantalla muestra de cada sucursal (`origenes`, más abajo) sigue limitado a las que el usuario ve.
  const verificacion = await lecturaDeVerificacionEnLaEmpresa(ctx);
  const [producto, mpDisponibles, unidades] = await Promise.all([
    obtenerProductoPorId(productoId, ctx.db),
    listarMpDisponiblesEnAlguna(verificacion.db),
    listarUnidadesActivas(),
  ]);

  if (!producto) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-error">No se encontró ese producto.</p>
        <Link href="/catalogo/recetas" className="text-sm underline">
          ← Volver a Recetas
        </Link>
      </div>
    );
  }

  const elegible = producto.tipo === "PV" || (producto.tipo === "MP" && producto.seProduce);
  if (!elegible) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-error">
          &quot;{producto.nombre}&quot; no puede tener receta — tiene que ser un Producto de venta, o una Materia prima marcada &quot;Se
          produce&quot;.
        </p>
        <Link href="/catalogo/recetas" className="text-sm underline">
          ← Volver a Recetas
        </Link>
      </div>
    );
  }

  // U7 / D3: la receta se carga SIEMPRE en la unidad de stock de la materia prima (la conversión entre unidades viene más adelante); el servidor lo exige al guardar. Acá solo se la muestra fija.
  const nombreDeUnidad = (unidadId: string) => unidades.find((u) => u.id === unidadId)?.nombre ?? "la unidad de stock";
  const unidadDeStockPorMp: Record<string, string> = Object.fromEntries(mpDisponibles.map((mp) => [mp.id, mp.unidadStockId]));
  // Lectura en vivo de la cantidad de cada ingrediente («= 300 g», aviso de «3.000»): en la unidad de stock, con su menor solo si existe en el catálogo.
  const lecturaPorUnidad = unidadesDeLectura(unidades);
  const vigente = await obtenerRecetaVigente(producto.id);
  // La versión que ESTA pantalla muestra: cada cambio puntual la manda de vuelta, y si mientras tanto alguien guardó otra, el cambio se rechaza con un mensaje en vez de pisarlo (H7).
  const versionVista = vigente?.version ?? 0;
  const volver = `/catalogo/recetas/${producto.id}`;
  const siguienteOrdenPaso = vigente?.pasos.length ? Math.max(...vigente.pasos.map((p) => p.orden)) + 1 : 1;

  // M.3-A5: lo que esta pantalla muestra de OTRAS sucursales (de dónde copiar la receta, en cuáles falta un ingrediente, dónde está calibrado) se limita a las sucursales que el usuario puede ver: la LECTURA
  // se ensancha a las sucursales donde el rol ve `receta_sucursal_copiar` (el mismo «Ver» que exige `leerOrigenDeCopia` al copiar), además de la activa. `sucursalesVisibles` sale de ese alcance (membresías
  // y gate), nunca de la URL ni del cliente; las consultas reciben la base de este contexto ampliado, y todo lo demás de la pantalla se lee con `ctx.db`. Sin alcance, solo la activa (falla cerrado).
  const origenes = await lecturaEnSucursalesVisibles(ctx, "receta_sucursal_copiar");
  const sucursalesVisibles = origenes.alcance?.lectura ?? [ctx.sucursalId];

  // Aviso no bloqueante (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §5.6): la receta es del Catálogo Central —
  // validarIngredientes solo exige que cada MP esté disponible EN ALGUNA sucursal, nunca en todas. Acá se avisa, sin
  // impedir nada, en qué sucursales un ingrediente puntual no está disponible: ahí este plato no se va a poder vender.
  const sucursalesSinIngrediente = new Map<string, string[]>();
  // D2 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): la sustitución automática solo aplica a lo que se consume al vender —
  // un producto "Se produce" usa resolverConsumoPorFamilia (Producción), que no la conoce.
  const aceptaSustitutos = !producto.seProduce;
  const opcionesSustitutoPorIngrediente = new Map<string, { id: string; nombre: string }[]>();
  if (vigente?.ingredientes.length) {
    await Promise.all(
      vigente.ingredientes.map(async (ing) => {
        const porSucursal = await disponibilidadDeProductoEnSucursales(ing.insumoProductoId, ctx.usuarioId, sucursalesVisibles, origenes.db);
        const faltantes = porSucursal.filter((s) => !s.disponible).map((s) => s.sucursalNombre);
        if (faltantes.length) sucursalesSinIngrediente.set(ing.insumoProductoId, faltantes);

        if (aceptaSustitutos) {
          const opciones = await listarOpcionesDeSustituto({
            insumoIdExcluido: ing.insumoProducto.insumoId,
            unidadId: ing.insumoProducto.unidadStockId, // U7 / D3: los sustitutos comparten la unidad de STOCK de la MP (la receta se carga en ella), no la que haya quedado guardada.
          }, verificacion.db);
          opcionesSustitutoPorIngrediente.set(ing.insumoProductoId, opciones);
        }
      })
    );
  }

  // Rendimiento por sucursal (paso 7): nota "Calibrado en N sucursal(es)" por ingrediente — UNA sola consulta por lotes
  // (no una por ingrediente) a RendimientoLocalIngrediente.
  const calibracionesPorIngrediente = new Map<string, string[]>();
  if (vigente?.ingredientes.length) {
    const calibraciones = await listarCalibracionesDeIngredientes(vigente.ingredientes.map((i) => i.id), ctx.usuarioId, sucursalesVisibles, origenes.db);
    for (const c of calibraciones) {
      const lista = calibracionesPorIngrediente.get(c.recetaIngredienteId) ?? [];
      lista.push(c.sucursal.nombre);
      calibracionesPorIngrediente.set(c.recetaIngredienteId, lista);
    }
  }

  // Receta propia de la sucursal activa (ADR-009, R3/R4): estado + qué acciones le tocan a este usuario (una clave por acción).
  // El origen de la copia (`origenes`, más arriba) se lee de las OTRAS sucursales; la receta propia de la sucursal activa y todo lo demás de la pantalla se leen con `ctx.db`.
  const [estadoPropia, otrasConRecetaPropia, nivelEditar, nivelCopiar, nivelVolver] = await Promise.all([
    obtenerEstadoDeRecetaPropia(producto.id, ctx.sucursalId, ctx.db),
    listarSucursalesConRecetaPropia(producto.id, ctx.sucursalId, ctx.usuarioId, origenes.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "receta_sucursal_editar", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "receta_sucursal_copiar", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "receta_sucursal_volver_central", ctx.db),
  ]);

  // Fase 6 (3a): la receta es el paso «Receta» del ESPACIO DEL PRODUCTO (un producto de venta o una materia prima que se produce): se dibuja dentro del marco (el nombre como `h1`, la tira de pasos con
  // «Receta» como la pantalla actual). El producto interno de un adicional no tiene receta ni espacio de venta: queda como siempre, sin marco. El gate de arriba (`guardar_receta`, con el módulo Recetas) es
  // la barrera de esta pantalla; el marco solo ofrece los demás pasos a quien puede abrirlos.
  const productoDelEspacio = await leerProductoDelEspacio(ctx.db, producto.id);
  const conMarco = productoDelEspacio !== null && !productoDelEspacio.esAnclaDeAdicional;
  const [marco, nivelFicha] = conMarco
    ? await Promise.all([cargarMarcoDelEspacio(ctx, productoDelEspacio), obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_ver_catalogo", ctx.db)])
    : [null, null];

  // Todos los formularios del editor (central y receta propia) en UN grupo (O.2): mientras uno guarda, los demás esperan en vez de salir con la versión que
  // la pantalla mostraba antes de ese cambio; al terminar, la respuesta de la acción trae la pantalla refrescada y el cambio siguiente sale con la nueva.
  const editor = (
    <GrupoDeFormularios className="flex max-w-2xl flex-col gap-8">
      <div>
        {!conMarco && (
          <Link href="/catalogo/recetas" className="text-sm underline">
            ← Volver a Recetas
          </Link>
        )}
        {/* Dentro del marco el `h1` es el producto: el título de la receta baja a `h2`. */}
        {conMarco ? (
          <h2 className="text-lg font-medium">
            {producto.nombre} — versión vigente: {vigente?.version ?? "sin receta todavía"}
          </h2>
        ) : (
          <h1 className="mt-2 text-lg font-medium">
            {producto.nombre} — versión vigente: {vigente?.version ?? "sin receta todavía"}
          </h1>
        )}
        {vigente && (
          <div className="flex gap-3">
            <Link href={`${volver}/historial`} className="text-sm text-tinta-tenue underline inline-flex items-center gap-1">
              <IconoDeAccion id="historial" />
              Ver historial de versiones ({vigente.version})
            </Link>
            <EnlaceInterno href={`/reportes/rendimiento-recetas?productoId=${producto.id}`} className="text-sm text-tinta-tenue underline inline-flex items-center gap-1">
              <IconoDeAccion id="ver" />
              Ver rendimiento real
            </EnlaceInterno>
          </div>
        )}
      </div>

      {vigente && (
        <div className="flex flex-col gap-2">
          <h2 className="font-medium">Ficha técnica</h2>
          {editarFicha ? (
            <FormConResultado
              accion={async (formData: FormData) => {
                "use server";
                const resultado = await actualizarCabeceraDeReceta(producto.id, {
                  // numeroDelCampo (no Number(...) a secas): un texto inválido llega como NaN y el servidor lo rechaza, nunca el 0
                  // falso que daba Number("") — CampoNumero ya emite el texto canónico o crudo en su <input type="hidden">.
                  rendimientoCantidad: numeroDelCampo(String(formData.get("rendimientoCantidad") ?? "")),
                  rendimientoUnidadId: String(formData.get("rendimientoUnidadId") ?? "") || undefined,
                  racionesCantidad: numeroDelCampo(String(formData.get("racionesCantidad") ?? "")),
                  racionTamano: numeroDelCampo(String(formData.get("racionTamano") ?? "")),
                  racionUnidadId: String(formData.get("racionUnidadId") ?? "") || undefined,
                  tiempoPreparacionMinutos: numeroDelCampo(String(formData.get("tiempoPreparacionMinutos") ?? "")),
                  tiempoCoccionMinutos: numeroDelCampo(String(formData.get("tiempoCoccionMinutos") ?? "")),
                  comentarios: String(formData.get("comentarios") ?? ""),
                  presentacionEmplatado: String(formData.get("presentacionEmplatado") ?? ""),
                  notasAdicionales: String(formData.get("notasAdicionales") ?? ""),
                  equipamientoNecesario: String(formData.get("equipamientoNecesario") ?? ""),
                }, versionVista);
                // Sale del modo edición al guardar — mismo criterio que Ingredientes/Pasos.
                if (resultado.ok) redirect(volver);
                return resultado;
              }}
              className="flex flex-col gap-2 text-sm"
            >
              <div className="flex flex-wrap gap-2">
                <div className="flex flex-col gap-1">
                  <span>Rendimiento</span>
                  <div className="flex gap-1">
                    <CampoNumero
                      name="rendimientoCantidad"
                      ariaLabel="Rendimiento"
                      defaultValue={vigente.rendimientoCantidad ? String(Number(vigente.rendimientoCantidad)) : ""}
                      tipo="cantidad"
                      etiqueta="El rendimiento"
                      decimales={unidades.find((u) => u.id === vigente.rendimientoUnidadId)?.decimales}
                      className="w-24"
                      tamano="compacto"
                    />
                    <Selector etiqueta="Unidad del rendimiento" etiquetaOculta tamano="compacto" name="rendimientoUnidadId" defaultValue={vigente.rendimientoUnidadId ?? ""}>
                      <option value="">Unidad</option>
                      {unidades.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nombre}
                        </option>
                      ))}
                    </Selector>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span>Raciones</span>
                  <CampoNumero
                    name="racionesCantidad"
                    ariaLabel="Raciones"
                    defaultValue={vigente.racionesCantidad ? String(vigente.racionesCantidad) : ""}
                    tipo="cantidad"
                    etiqueta="La cantidad de raciones"
                    decimales={0}
                    className="w-24"
                    tamano="compacto"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span>Tamaño de ración</span>
                  <div className="flex gap-1">
                    <CampoNumero
                      name="racionTamano"
                      ariaLabel="Tamaño de ración"
                      defaultValue={vigente.racionTamano ? String(Number(vigente.racionTamano)) : ""}
                      tipo="cantidad"
                      etiqueta="El tamaño de ración"
                      decimales={unidades.find((u) => u.id === vigente.racionUnidadId)?.decimales}
                      className="w-24"
                      tamano="compacto"
                    />
                    <Selector etiqueta="Unidad del tamaño de ración" etiquetaOculta tamano="compacto" name="racionUnidadId" defaultValue={vigente.racionUnidadId ?? ""}>
                      <option value="">Unidad</option>
                      {unidades.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nombre}
                        </option>
                      ))}
                    </Selector>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span>Prep. (min)</span>
                  <CampoNumero
                    name="tiempoPreparacionMinutos"
                    ariaLabel="Prep. (min)"
                    defaultValue={vigente.tiempoPreparacionMinutos ? String(vigente.tiempoPreparacionMinutos) : ""}
                    tipo="cantidad"
                    etiqueta="El tiempo de preparación"
                    decimales={0}
                    className="w-24"
                    tamano="compacto"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span>Cocción (min)</span>
                  <CampoNumero
                    name="tiempoCoccionMinutos"
                    ariaLabel="Cocción (min)"
                    defaultValue={vigente.tiempoCoccionMinutos ? String(vigente.tiempoCoccionMinutos) : ""}
                    tipo="cantidad"
                    etiqueta="El tiempo de cocción"
                    decimales={0}
                    className="w-24"
                    tamano="compacto"
                  />
                </div>
              </div>
              <AreaDeTexto etiqueta="Comentarios" name="comentarios" rows={2} defaultValue={vigente.comentarios ?? ""} />
              <AreaDeTexto etiqueta="Presentación o emplatado" name="presentacionEmplatado" rows={2} defaultValue={vigente.presentacionEmplatado ?? ""} placeholder="Un renglón por ítem" />
              <AreaDeTexto etiqueta="Notas adicionales" name="notasAdicionales" rows={2} defaultValue={vigente.notasAdicionales ?? ""} placeholder="Un renglón por ítem" />
              <AreaDeTexto etiqueta="Equipamiento necesario" name="equipamientoNecesario" rows={2} defaultValue={vigente.equipamientoNecesario ?? ""} placeholder="Un renglón por ítem" />
              <div className="flex gap-3">
                <BotonDeServidor type="submit" tamano="compacto" className="self-start">
                  Guardar ficha técnica
                </BotonDeServidor>
                <Link href={volver} className="self-center text-sm underline">
                  Cancelar
                </Link>
              </div>
            </FormConResultado>
          ) : (
            (() => {
              const detalles: string[] = [];
              if (vigente.rendimientoCantidad != null) detalles.push(`Rendimiento: ${Number(vigente.rendimientoCantidad)} ${vigente.rendimientoUnidad?.nombre ?? ""}`.trim());
              if (vigente.racionesCantidad != null) detalles.push(`Raciones: ${vigente.racionesCantidad}`);
              if (vigente.racionTamano != null) detalles.push(`Tamaño de ración: ${Number(vigente.racionTamano)} ${vigente.racionUnidad?.nombre ?? ""}`.trim());
              if (vigente.tiempoPreparacionMinutos != null) detalles.push(`Prep.: ${vigente.tiempoPreparacionMinutos} min`);
              if (vigente.tiempoCoccionMinutos != null) detalles.push(`Cocción: ${vigente.tiempoCoccionMinutos} min`);
              return (
                <div className="flex flex-col gap-1 text-sm">
                  {detalles.length > 0 ? <p>{detalles.join(" — ")}</p> : <p className="text-tinta-tenue">Sin ficha técnica cargada.</p>}
                  {vigente.comentarios && <p className="text-tinta-tenue">Comentarios: {vigente.comentarios}</p>}
                  {vigente.presentacionEmplatado && <p className="text-tinta-tenue">Presentación o emplatado: {vigente.presentacionEmplatado}</p>}
                  {vigente.notasAdicionales && <p className="text-tinta-tenue">Notas adicionales: {vigente.notasAdicionales}</p>}
                  {vigente.equipamientoNecesario && <p className="text-tinta-tenue">Equipamiento necesario: {vigente.equipamientoNecesario}</p>}
                  <Link href={`${volver}?editarFicha=1`} className="self-start underline inline-flex items-center gap-1">
                    <IconoDeAccion id="editar" />
                    Editar
                  </Link>
                </div>
              );
            })()
          )}
        </div>
      )}

      {vigente && (
        <div className="flex flex-col gap-2">
          <h2 className="font-medium">Ingredientes</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-tinta-tenue">
                <th className="py-2">Ingrediente</th>
                <th>Cantidad</th>
                <th>Unidad</th>
                <th>Merma %</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {vigente.ingredientes.map((ing) => {
                const enEdicion = editar === ing.insumoProductoId;
                // U7 / D3: una receta vieja puede traer el ingrediente en otra unidad que la de stock de la MP. No se migra nada: se avisa y el servidor no deja guardar la receta hasta corregirlo.
                const unidadDeStock = nombreDeUnidad(ing.insumoProducto.unidadStockId);
                const avisoDeUnidad =
                  ing.unidadId === ing.insumoProducto.unidadStockId
                    ? null
                    : `La unidad guardada (${ing.unidad.nombre}) no coincide con la de stock (${unidadDeStock}): hoy el consumo se calcula en ${unidadDeStock}, no en ${ing.unidad.nombre}. Corregí la cantidad en ${unidadDeStock} (Editar) y guardá; hasta entonces no se puede guardar ningún cambio de esta receta.`;
                return (
                  <tr key={ing.id} className="border-b">
                    {enEdicion ? (
                      <td colSpan={5} className="py-2">
                        <FormConResultado
                          accion={async (formData: FormData) => {
                            "use server";
                            const resultado = await actualizarIngredienteDeReceta(producto.id, ing.insumoProductoId, {
                              cantidad: Number(formData.get("cantidad")),
                              unidadId: String(formData.get("unidadId") ?? ""),
                              mermaPorcentaje: Number(formData.get("mermaPorcentaje") || 0),
                              insumoSustitutoIds: aceptaSustitutos ? formData.getAll("insumoSustitutoIds").map(String).filter((v) => v !== "") : undefined,
                            }, versionVista);
                            // Sale del modo edición al guardar — si no, `editar=` queda pegado en la URL y la fila se muestra siempre editable.
                            if (resultado.ok) redirect(volver);
                            return resultado;
                          }}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <span className="text-sm font-medium">{ing.insumoProducto.nombre}</span>
                          <LecturaDeCantidad campoId={`cantidad-${ing.id}`} valorInicial={String(Number(ing.cantidad))} unidad={lecturaPorUnidad[ing.insumoProducto.unidadStockId] ?? null}>
                            <CampoNumero id={`cantidad-${ing.id}`} name="cantidad" defaultValue={String(Number(ing.cantidad))} required ariaLabel="Cantidad" className="w-28" />
                            {/* Unidad FIJA: la de stock de la MP (el servidor la exige y la relee al guardar). */}
                            <input type="hidden" name="unidadId" value={ing.insumoProducto.unidadStockId} />
                            <span title="Unidad de stock de la materia prima" className="rounded border bg-superficie-suave px-2 py-1.5 text-sm">
                              <span className="sr-only">Unidad: </span>
                              {unidadDeStock}
                            </span>
                          </LecturaDeCantidad>
                          {avisoDeUnidad && (
                            <Aviso variante="advertencia" forma="en-linea" className="w-full">
                              {avisoDeUnidad}
                            </Aviso>
                          )}
                          <CampoNumero name="mermaPorcentaje" defaultValue={String(Number(ing.mermaPorcentaje))} ariaLabel={`Merma de ${ing.insumoProducto.nombre}`} placeholder="Merma %" className="w-24" />
                          {aceptaSustitutos &&
                            (() => {
                              const opcionesBase = opcionesSustitutoPorIngrediente.get(ing.insumoProductoId) ?? [];
                              const slots = [...ing.sustitutos, null]; // uno de más, vacío, para poder agregar otro
                              return (
                                <fieldset className="flex w-full flex-col gap-1">
                                  <legend className="text-xs text-tinta-tenue">Sustitutos si no hay stock (en orden)</legend>
                                  {slots.map((slot, i) => {
                                    const opciones =
                                      slot && !opcionesBase.some((o) => o.id === slot.insumoSustitutoId)
                                        ? [{ id: slot.insumoSustitutoId, nombre: slot.insumoSustituto.nombre }, ...opcionesBase]
                                        : opcionesBase;
                                    return (
                                      <Selector key={slot?.id ?? "nuevo"} etiqueta={`Sustituto ${i + 1}`} tamano="compacto" name="insumoSustitutoIds" defaultValue={slot?.insumoSustitutoId ?? ""}>
                                        <option value="">Ninguno</option>
                                        {opciones.map((o) => (
                                          <option key={o.id} value={o.id}>
                                            {o.nombre}
                                          </option>
                                        ))}
                                      </Selector>
                                    );
                                  })}
                                </fieldset>
                              );
                            })()}
                          <BotonDeServidor type="submit" tamano="compacto">
                            Guardar
                          </BotonDeServidor>
                          <Link href={volver} className="text-sm underline">
                            Cancelar
                          </Link>
                        </FormConResultado>
                      </td>
                    ) : (
                      <>
                        <td className="py-2">
                          {ing.insumoProducto.nombre}
                          {avisoDeUnidad && (
                            <Aviso variante="advertencia" forma="en-linea">
                              {avisoDeUnidad}
                            </Aviso>
                          )}
                          {sucursalesSinIngrediente.has(ing.insumoProductoId) && (
                            <Aviso variante="advertencia" forma="en-linea">
                              No disponible en {sucursalesSinIngrediente.get(ing.insumoProductoId)!.join(", ")} — ahí este plato no se va a poder vender.
                            </Aviso>
                          )}
                          {aceptaSustitutos && ing.sustitutos.length > 0 && (
                            <>
                              <p className="text-xs text-tinta-tenue">Si no hay stock, se usa: {ing.sustitutos.map((s) => s.insumoSustituto.nombre).join(" → ")}</p>
                              {(() => {
                                const opcionesIds = new Set((opcionesSustitutoPorIngrediente.get(ing.insumoProductoId) ?? []).map((o) => o.id));
                                const invalidos = ing.sustitutos.filter((s) => !opcionesIds.has(s.insumoSustitutoId));
                                return invalidos.length > 0 ? (
                                  <Aviso variante="advertencia" forma="en-linea">
                                    {invalidos.map((s) => `"${s.insumoSustituto.nombre}"`).join(", ")} quedó inactivo o con otra unidad de stock — no se va a usar como sustituto hasta que se corrija.
                                  </Aviso>
                                ) : null;
                              })()}
                            </>
                          )}
                          {calibracionesPorIngrediente.has(ing.id) && (
                            <p className="text-xs text-tinta-tenue">
                              Calibrado en {calibracionesPorIngrediente.get(ing.id)!.length} sucursal(es) ({calibracionesPorIngrediente.get(ing.id)!.join(", ")}) —{" "}
                              <EnlaceInterno href="/reportes/rendimiento-recetas/por-sucursal" className="underline">
                                Comparar
                              </EnlaceInterno>
                            </p>
                          )}
                        </td>
                        <td>{Number(ing.cantidad)}</td>
                        <td>{ing.unidad.nombre}</td>
                        <td>{Number(ing.mermaPorcentaje)}</td>
                        <td>
                          {/* flex-wrap: en un celular angosto «Editar» y «Quitar» se apilan en vez de ensanchar la tabla más allá de la pantalla. */}
                          <div className="flex flex-wrap gap-x-3">
                            <Link href={`${volver}?editar=${ing.insumoProductoId}`} className="text-sm underline inline-flex items-center gap-1">
                              <IconoDeAccion id="editar" />
                              Editar
                            </Link>
                            <FormConResultado
                              accion={async () => {
                                "use server";
                                return quitarIngredienteDeReceta(producto.id, ing.insumoProductoId, versionVista);
                              }}
                            >
                              <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                                <IconoDeAccion id="eliminar" />
                                Quitar
                              </BotonDeServidor>
                            </FormConResultado>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AgregarColapsable etiqueta="Agregar ingrediente">
        <FormConResultado
          accion={async (formData: FormData) => {
            "use server";
            const insumoProductoId = String(formData.get("insumoProductoId") ?? "");
            return agregarIngredienteAReceta(producto.id, {
              insumoProductoId,
              cantidad: Number(formData.get("cantidad")),
              // U7 / D3: la unidad es la de stock de la MP elegida (el servidor la vuelve a comparar con la real al guardar).
              unidadId: unidadDeStockPorMp[insumoProductoId] ?? "",
              mermaPorcentaje: Number(formData.get("mermaPorcentaje") || 0),
            }, versionVista);
          }}
          className="flex max-w-lg flex-col gap-2"
        >
          <h3 className="font-medium">Agregar ingrediente (genera la próxima versión)</h3>
          <LecturaDeCantidad campoId="cantidad-ingrediente-nuevo" unidadDeStockPorMp={unidadDeStockPorMp} unidades={lecturaPorUnidad}>
            <Selector etiqueta="Materia prima" etiquetaOculta name="insumoProductoId" required>
              <option value="">Materia prima</option>
              {mpDisponibles.map((mp) => (
                <option key={mp.id} value={mp.id}>
                  {mp.nombre} ({nombreDeUnidad(mp.unidadStockId)})
                </option>
              ))}
            </Selector>
            <p className="text-xs text-tinta-tenue">La cantidad se carga en la unidad de stock de la materia prima (la que figura entre paréntesis).</p>
            <div className="flex gap-2">
              <CampoNumero id="cantidad-ingrediente-nuevo" name="cantidad" placeholder="Cantidad" ariaLabel="Cantidad" required className="flex-1" />
              <CampoNumero name="mermaPorcentaje" placeholder="Merma %" ariaLabel="Merma" className="w-28" />
            </div>
          </LecturaDeCantidad>
          <BotonDeServidor type="submit">
            Agregar
          </BotonDeServidor>
        </FormConResultado>
      </AgregarColapsable>

      {vigente && (
        <div className="flex flex-col gap-2">
          <h2 className="font-medium">Método de preparación</h2>
          {vigente.pasos.length === 0 ? (
            <p className="text-sm text-tinta-tenue">Todavía no hay ningún paso cargado.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {vigente.pasos.map((paso, indice) => {
                const enEdicion = ordenEnEdicion === paso.orden;
                const ordenesVigentes = vigente.pasos.map((p) => p.orden);
                return (
                  <li key={paso.id} className="rounded border p-3 text-sm">
                    {enEdicion ? (
                      <FormConResultado
                        accion={async (formData: FormData) => {
                          "use server";
                          const resultado = await actualizarPasoDeReceta(producto.id, paso.orden, {
                            nombre: String(formData.get("nombre") ?? ""),
                            instruccion: String(formData.get("instruccion") ?? ""),
                            minutos: formData.get("minutos") ? Number(formData.get("minutos")) : undefined,
                            insumoProductoIds: formData.getAll("insumoProductoIds").map(String),
                          }, versionVista);
                          if (resultado.ok) redirect(volver);
                          return resultado;
                        }}
                        className="flex flex-col gap-2"
                      >
                        <Campo aria-label="Nombre corto" name="nombre" defaultValue={paso.nombre ?? ""} placeholder="Nombre corto (opcional)" />
                        <AreaDeTexto etiqueta="Instrucción" etiquetaOculta name="instruccion" defaultValue={paso.instruccion} required rows={2} />
                        <CampoNumero name="minutos" decimales={0} defaultValue={paso.minutos ? String(paso.minutos) : ""} placeholder="Minutos (opcional)" ariaLabel="Minutos del paso" className="w-32" tamano="compacto" />
                        {vigente.ingredientes.length > 0 && (
                          <fieldset className="flex flex-col gap-1">
                            <span className="text-xs text-tinta-tenue">¿Este paso usa solo algunos ingredientes en particular? (opcional)</span>
                            {vigente.ingredientes.map((ing) => (
                              <Casilla
                                key={ing.id}
                                etiqueta={ing.insumoProducto.nombre}
                                name="insumoProductoIds"
                                value={ing.insumoProductoId}
                                defaultChecked={paso.ingredientes.some((pi) => pi.recetaIngrediente.insumoProductoId === ing.insumoProductoId)}
                              />
                            ))}
                          </fieldset>
                        )}
                        <div className="flex gap-3">
                          <BotonDeServidor type="submit" tamano="chico" className="self-start">
                            Guardar
                          </BotonDeServidor>
                          <Link href={volver} className="text-xs underline">
                            Cancelar
                          </Link>
                        </div>
                      </FormConResultado>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium">
                            {paso.orden}. {paso.nombre || "Paso"}
                          </span>
                          {paso.minutos != null && <span className="text-xs text-tinta-tenue">({paso.minutos} min)</span>}
                        </div>
                        <p>{paso.instruccion}</p>
                        {paso.ingredientes.length > 0 && (
                          <p className="text-xs text-tinta-tenue">
                            Ingredientes de este paso: {paso.ingredientes.map((pi) => pi.recetaIngrediente.insumoProducto.nombre).join(", ")}
                          </p>
                        )}
                        <div className="flex gap-3">
                          <Link href={`${volver}?editarPaso=${paso.orden}`} className="text-xs underline inline-flex items-center gap-1">
                            <IconoDeAccion id="editar" />
                            Editar
                          </Link>
                          <FormConResultado
                            accion={async () => {
                              "use server";
                              return quitarPasoDeReceta(producto.id, paso.orden, versionVista);
                            }}
                          >
                            <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                              Quitar
                            </BotonDeServidor>
                          </FormConResultado>
                          {indice > 0 && (
                            <FormConResultado
                              accion={async () => {
                                "use server";
                                return reordenarPasosDeReceta(producto.id, secuenciaMoviendo(ordenesVigentes, paso.orden, "arriba"), versionVista);
                              }}
                            >
                              <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                                Subir
                              </BotonDeServidor>
                            </FormConResultado>
                          )}
                          {indice < vigente.pasos.length - 1 && (
                            <FormConResultado
                              accion={async () => {
                                "use server";
                                return reordenarPasosDeReceta(producto.id, secuenciaMoviendo(ordenesVigentes, paso.orden, "abajo"), versionVista);
                              }}
                            >
                              <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                                Bajar
                              </BotonDeServidor>
                            </FormConResultado>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          <AgregarColapsable etiqueta="Agregar paso">
            <FormConResultado
              accion={async (formData: FormData) => {
                "use server";
                const datos = {
                  nombre: String(formData.get("nombre") ?? ""),
                  instruccion: String(formData.get("instruccion") ?? ""),
                  minutos: formData.get("minutos") ? Number(formData.get("minutos")) : undefined,
                  insumoProductoIds: formData.getAll("insumoProductoIds").map(String),
                };
                const posicion = String(formData.get("posicion") ?? "final");
                if (posicion === "final") return agregarPasoAReceta(producto.id, { orden: siguienteOrdenPaso, ...datos }, versionVista);
                return insertarPasoEnReceta(producto.id, Number(posicion), datos, versionVista);
              }}
              className="flex max-w-lg flex-col gap-2"
            >
              <h3 className="text-sm font-medium">Agregar paso (genera la próxima versión)</h3>
              {vigente.pasos.length > 0 && (
                <Selector etiqueta="Posición" tamano="compacto" name="posicion" defaultValue="final">
                  <option value="final">Al final</option>
                  {vigente.pasos.map((_, indice) => (
                    <option key={indice} value={indice + 1}>
                      Antes del paso {indice + 1}
                    </option>
                  ))}
                </Selector>
              )}
              <Campo aria-label="Nombre corto" name="nombre" placeholder="Nombre corto (opcional)" />
              <AreaDeTexto etiqueta="Instrucción" etiquetaOculta name="instruccion" placeholder="Instrucción" required rows={2} />
              <CampoNumero name="minutos" decimales={0} placeholder="Minutos (opcional)" ariaLabel="Minutos del paso" className="w-32" />
              {vigente.ingredientes.length > 0 && (
                <fieldset className="flex flex-col gap-1">
                  <span className="text-xs text-tinta-tenue">¿Este paso usa solo algunos ingredientes en particular? (opcional)</span>
                  {vigente.ingredientes.map((ing) => (
                    <Casilla key={ing.id} etiqueta={ing.insumoProducto.nombre} name="insumoProductoIds" value={ing.insumoProductoId} />
                  ))}
                </fieldset>
              )}
              <BotonDeServidor type="submit" className="self-start">
                Agregar paso
              </BotonDeServidor>
            </FormConResultado>
          </AgregarColapsable>
        </div>
      )}

      <RecetaDeLaSucursal
        producto={{ id: producto.id, nombre: producto.nombre }}
        sucursalNombre={ctx.sucursalNombre}
        estado={estadoPropia}
        otrasConRecetaPropia={otrasConRecetaPropia}
        puede={{ editar: nivelEditar.editar, copiar: nivelCopiar.editar, volverALaCentral: nivelVolver.editar }}
        unidades={unidades}
        lecturaPorUnidad={lecturaPorUnidad}
        materiasPrimas={mpDisponibles}
        ingredienteEnEdicion={editarPropia ?? null}
        volver={volver}
      />
    </GrupoDeFormularios>
  );

  if (!conMarco || !productoDelEspacio || !marco || !nivelFicha) return editor;
  return (
    <MarcoDelEspacio
      producto={{
        id: producto.id,
        nombre: producto.nombre,
        codigo: producto.codigo,
        tipo: productoDelEspacio.tipo,
        modoDeVenta: productoDelEspacio.modoDeVenta,
        disponibleAca: marco.disponibleAca,
        sucursalNombre: ctx.sucursalNombre,
        fichaVisible: nivelFicha.ver,
      }}
      pasos={marco.pasos}
      actual="receta"
    >
      {editor}
    </MarcoDelEspacio>
  );
}
