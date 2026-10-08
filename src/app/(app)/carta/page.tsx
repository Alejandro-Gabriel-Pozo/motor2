import { EnlaceInterno } from "@/components/enlace-interno";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { obtenerMiNivelPermiso, obtenerMiNivelPermisoDeEmpresa, requierePermisoVer } from "@/server/acceso/gate";
import type { ProductoCartaAdmin } from "@/core/carta/public";
import { cargarAdminCarta } from "@/server/consultas/carta/admin";
import { actualizarActivaSeccionCarta, guardarSeccionCarta } from "@/server/actions/carta/secciones";
import { actualizarActivoGeneroCarta, guardarGeneroCarta } from "@/server/actions/carta/generos";
import { guardarContenidoCartaProducto } from "@/server/actions/carta/contenido-producto";
import { guardarDescuentoProducto } from "@/server/actions/carta/descuento-producto";
import {
  actualizarActivaPromoCarta,
  actualizarActivaPromoCartaEnSucursal,
  guardarCuposPromoCarta,
  guardarPrecioLocalPromoCarta,
  guardarPromoCarta,
} from "@/server/actions/carta/promos";
import { precioMinimoPromo } from "@/core/pos/public";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { FormConResultado } from "@/components/form-con-resultado";
import { SeccionYOrden } from "@/components/carta/seccion-y-orden";
import { AvisoSoloLectura, Dato, DatosSoloLectura } from "@/components/carta/datos-solo-lectura";
import { CopiarCartaDeSucursal } from "@/components/carta/copiar-carta-de-sucursal";

/**
 * Admin de la carta pública (docs/plan-carta-catalogo-2026-09-24.md, M10): lo que muestra la carta pública interna
 * (ADR-006). Tres bloques: secciones de carta, el contenido de carta de cada PV disponible en esta sucursal (con
 * su sección de carta, elegida DIRECTO — docs/plan-carta-seccion-directa-2026-09-25.md —, y el aviso de los que todavía no tienen
 * contenido: sin contenido no salen, decisión D3) y las promos (de la empresa, prendidas o no en la sucursal activa). El nombre, el precio y la disponibilidad de
 * cada producto se siguen editando en Catálogo; la Categoría de producto no ubica nada en la carta.
 *
 * Todas las mutaciones pasan por las Server Actions de src/server/actions/carta (una clave por bloque: carta_secciones, carta_generos,
 * carta_contenido_producto y, para las promos, carta_promo_definir / carta_promo_activar / carta_promo_precio_local); el refresco lo piden los
 * closures de acá (ver refrescar.ts). Los closures capturan solo ids (texto): lo que captura un closure "use server" viaja al
 * cliente.
 *
 * Ver ≠ editar (docs/grounding-lista-ver-editar-2026-09-18.md, §7.4: catálogo chico, queda inline): entrar pide «Ver» de "carta_ver";
 * los formularios, las altas y los botones de apagar/prender de cada bloque se dibujan solo con «Editar» de la clave de ESE bloque. Sin «Editar», el bloque muestra los
 * mismos datos como texto (DatosSoloLectura). Es cortesía de la interfaz, no barrera: la acción sigue exigiendo el permiso.
 */
const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

const CLASE_INPUT = "rounded border px-2 py-1";
const CLASE_BOTON = "rounded bg-neutral-900 px-3 py-1.5 text-sm text-white";

type OpcionSeccion = { id: string; nombre: string; activa: boolean };
type OpcionGenero = { id: string; nombre: string; activo: boolean };
/** Para el select de sección + orden sugerido (DA6): las secciones, y cuántos ítems ya tiene cada una. */
type UbicacionEnCarta = { secciones: OpcionSeccion[]; cantidadPorSeccion: Record<string, number>; generos: OpcionGenero[] };

export default async function CartaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta_ver", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  const [nivelSecciones, nivelGeneros, nivelContenido, nivelPromoDefinir, nivelPromoActivar, nivelPromoPrecio, nivelDescuento, nivelCopiar] = await Promise.all([
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "carta_secciones", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "carta_generos", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "carta_contenido_producto", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "carta_promo_definir", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_promo_activar", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_promo_precio_local", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_producto_descuento", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_copiar_de_sucursal", ctx.db),
  ]);
  const puedeEditarSecciones = nivelSecciones.editar;
  const puedeEditarGeneros = nivelGeneros.editar;
  const puedeEditarContenido = nivelContenido.editar;
  const puedeDefinirPromos = nivelPromoDefinir.editar;
  const puedeActivarPromos = nivelPromoActivar.editar;
  const puedePrecioLocalPromos = nivelPromoPrecio.editar;
  const puedeDescuento = nivelDescuento.editar;
  const puedeCopiarCarta = nivelCopiar.editar;
  const puedeEditarAlgo = puedeEditarSecciones || puedeEditarGeneros || puedeEditarContenido || puedeDefinirPromos || puedeActivarPromos || puedePrecioLocalPromos || puedeDescuento;

  // La hora se fija acá, en el borde (O.22-c).
  const datos = await cargarAdminCarta(ctx.sucursalId, ctx.db, new Date());
  const seccionesActivas = datos.secciones.filter((s) => s.activa);
  const ubicacion: UbicacionEnCarta = {
    secciones: datos.secciones.map((s) => ({ id: s.id, nombre: s.nombre, activa: s.activa })),
    cantidadPorSeccion: Object.fromEntries(datos.secciones.map((s) => [s.id, s.cantidadItems])),
    generos: datos.generos.map((g) => ({ id: g.id, nombre: g.nombre, activo: g.activo })),
  };

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Carta pública</h1>
        <p className="text-sm text-neutral-500">
          Lo que la carta pública de la sucursal muestra: secciones, contenido de cada producto de venta y promos. El nombre, el precio y la disponibilidad
          se editan en Catálogo.
        </p>
        {!puedeEditarAlgo && <AvisoSoloLectura />}
      </div>

      {/* Carta PROPIA de cada sucursal (ADR-009, C3/C4): una sucursal sin carta propia no muestra nada hasta que la arma o la copia de otra. */}
      {datos.cartaVacia && (
        <section aria-labelledby="titulo-carta-vacia" className="flex max-w-2xl flex-col gap-3 rounded border border-dashed p-4" data-carta-vacia>
          <h2 id="titulo-carta-vacia" className="text-lg font-medium">
            Tu sucursal no tiene carta propia todavía
          </h2>
          <p role="status" className="text-sm text-neutral-600">
            Mientras no armes la carta, la carta pública y el selector del POS de esta sucursal salen vacíos (las secciones son de la empresa y ya están).
            Podés armarla producto por producto{puedeCopiarCarta ? " o copiar la de otra sucursal" : ""}.
          </p>
          {puedeEditarContenido && (
            <a href="#titulo-contenido" className="self-start rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
              Armar carta
            </a>
          )}
          {puedeCopiarCarta && <CopiarCartaDeSucursal origenes={datos.sucursalesConCarta} />}
        </section>
      )}

      {/* 1. Secciones de carta */}
      <section aria-labelledby="titulo-secciones" className="flex flex-col gap-3">
        <h2 id="titulo-secciones" className="text-lg font-medium">
          Secciones de carta
        </h2>
        <ul className="flex flex-col gap-2">
          {datos.secciones.map((s) => {
            const id = s.id;
            const activa = s.activa;
            return (
              <li key={s.id} className="rounded border p-3" data-seccion-carta={s.nombre}>
                <details>
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">{s.nombre}</span>
                    {s.titulo ? ` — «${s.titulo}»` : ""} · orden {s.orden} · {s.cantidadItems} ítem(s) · {s.activa ? "activa" : "apagada"}
                  </summary>
                  {puedeEditarSecciones ? (
                    <FormConResultado
                      accion={async (fd: FormData) => {
                        "use server";
                        return refrescarSiOk(
                          await guardarSeccionCarta({ id, nombre: campo(fd, "nombre"), titulo: campo(fd, "titulo"), descripcion: campo(fd, "descripcion"), imagenUrl: campo(fd, "imagenUrl"), orden: campo(fd, "orden") })
                        );
                      }}
                      className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
                    >
                      <CamposSeccion valores={s} />
                      <div className="sm:col-span-2">
                        <button type="submit" className={CLASE_BOTON}>
                          Guardar sección
                        </button>
                      </div>
                    </FormConResultado>
                  ) : (
                    <DatosSoloLectura className="mt-3">
                      <Dato etiqueta="Nombre">{s.nombre}</Dato>
                      <Dato etiqueta="Título">{s.titulo}</Dato>
                      <Dato etiqueta="Descripción" ancho>
                        {s.descripcion}
                      </Dato>
                      <Dato etiqueta="Imagen">{s.imagenUrl}</Dato>
                      <Dato etiqueta="Orden">{s.orden}</Dato>
                    </DatosSoloLectura>
                  )}
                </details>
                {puedeEditarSecciones && (
                  <FormConResultado
                    accion={async () => {
                      "use server";
                      return refrescarSiOk(await actualizarActivaSeccionCarta(id, !activa));
                    }}
                    className="mt-2"
                  >
                    <button type="submit" className="text-sm underline">
                      {s.activa ? `Apagar «${s.nombre}»` : `Prender «${s.nombre}»`}
                    </button>
                  </FormConResultado>
                )}
              </li>
            );
          })}
          {!datos.secciones.length && <li className="text-sm text-neutral-500">Todavía no hay secciones de carta.</li>}
        </ul>

        {puedeEditarSecciones && (
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return refrescarSiOk(
                await guardarSeccionCarta({ nombre: campo(fd, "nombre"), titulo: campo(fd, "titulo"), descripcion: campo(fd, "descripcion"), imagenUrl: campo(fd, "imagenUrl"), orden: campo(fd, "orden") })
              );
            }}
            className="grid max-w-2xl grid-cols-1 gap-2 rounded border border-dashed p-3 sm:grid-cols-2"
          >
            <h3 className="text-sm font-medium sm:col-span-2">Nueva sección de carta</h3>
            {/* DA5: una sección nueva cae al final por defecto (orden = cuántas hay). */}
            <CamposSeccion ordenSugerido={datos.secciones.length} />
            <div className="sm:col-span-2">
              <button type="submit" className={CLASE_BOTON}>
                Crear sección
              </button>
            </div>
          </FormConResultado>
        )}
      </section>

      {/* 2. Géneros de carta (docs/plan-genero-carta-2026-09-26.md): carpetas VISUALES del POS, globales como las secciones. */}
      <section aria-labelledby="titulo-generos" className="flex flex-col gap-3">
        <h2 id="titulo-generos" className="text-lg font-medium">
          Géneros de carta
        </h2>
        <p className="text-sm text-neutral-500">
          Carpetas del selector del POS (ej. «Cerveza»): agrupan, dentro de una sección, tanto productos sueltos como ítems agrupados que comparten género. No
          implican mismo precio ni sustituibilidad (eso lo maneja «Ítems agrupados de la carta»); no cambian la carta pública que ve el cliente. Un producto sin
          género (o con uno apagado) sigue apareciendo suelto.
        </p>
        <ul className="flex flex-col gap-2">
          {datos.generos.map((g) => {
            const id = g.id;
            const activo = g.activo;
            return (
              <li key={g.id} className="rounded border p-3" data-genero-carta={g.nombre}>
                <details>
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">{g.nombre}</span> · orden {g.orden} · {g.activo ? "activo" : "apagado"}
                  </summary>
                  {puedeEditarGeneros ? (
                    <FormConResultado
                      accion={async (fd: FormData) => {
                        "use server";
                        return refrescarSiOk(await guardarGeneroCarta({ id, nombre: campo(fd, "nombre"), orden: campo(fd, "orden") }));
                      }}
                      className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
                    >
                      <CamposGenero valores={g} />
                      <div className="sm:col-span-2">
                        <button type="submit" className={CLASE_BOTON}>
                          Guardar género
                        </button>
                      </div>
                    </FormConResultado>
                  ) : (
                    <DatosSoloLectura className="mt-3">
                      <Dato etiqueta="Nombre">{g.nombre}</Dato>
                      <Dato etiqueta="Orden">{g.orden}</Dato>
                    </DatosSoloLectura>
                  )}
                </details>
                {puedeEditarGeneros && (
                  <FormConResultado
                    accion={async () => {
                      "use server";
                      return refrescarSiOk(await actualizarActivoGeneroCarta(id, !activo));
                    }}
                    className="mt-2"
                  >
                    <button type="submit" className="text-sm underline">
                      {g.activo ? `Apagar «${g.nombre}»` : `Prender «${g.nombre}»`}
                    </button>
                  </FormConResultado>
                )}
              </li>
            );
          })}
          {!datos.generos.length && <li className="text-sm text-neutral-500">Todavía no hay géneros.</li>}
        </ul>

        {puedeEditarGeneros && (
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return refrescarSiOk(await guardarGeneroCarta({ nombre: campo(fd, "nombre"), orden: campo(fd, "orden") }));
            }}
            className="grid max-w-2xl grid-cols-1 gap-2 rounded border border-dashed p-3 sm:grid-cols-2"
          >
            <h3 className="text-sm font-medium sm:col-span-2">Nuevo género</h3>
            <CamposGenero ordenSugerido={datos.generos.length} />
            <div className="sm:col-span-2">
              <button type="submit" className={CLASE_BOTON}>
                Crear género
              </button>
            </div>
          </FormConResultado>
        )}
      </section>

      {/* 3. Contenido de carta por PV */}
      <section aria-labelledby="titulo-contenido" className="flex flex-col gap-3">
        <h2 id="titulo-contenido" className="text-lg font-medium">
          Contenido de carta de cada producto de venta
        </h2>
        <p className="text-sm text-neutral-500">
          Solo los productos de venta disponibles en esta sucursal. Un producto sale en la carta cuando tiene contenido cargado, está marcado como visible y
          está en una sección de carta activa.
        </p>

        {datos.sinContenido.length > 0 && (
          <div className="rounded border border-amber-300 p-3 dark:border-amber-700">
            <h3 className="text-sm font-medium text-amber-700 dark:text-amber-600">PV disponibles acá sin contenido de carta (no salen en la carta)</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {datos.sinContenido.map((p) => (
                <li key={p.id}>{p.nombre}</li>
              ))}
            </ul>
          </div>
        )}
        {datos.visiblesSinSeccion.length > 0 && (
          <div className="rounded border border-amber-300 p-3 dark:border-amber-700">
            <h3 className="text-sm font-medium text-amber-700 dark:text-amber-600">Visibles pero sin sección de carta activa (no salen en la carta)</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {datos.visiblesSinSeccion.map((p) => (
                <li key={p.productoId}>{p.nombre}</li>
              ))}
            </ul>
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {datos.productos.map((p) => (
            <ContenidoProducto key={p.id} producto={p} ubicacion={ubicacion} puedeEditar={puedeEditarContenido} puedeDescuento={puedeDescuento} precioLocalActivo={datos.precioLocalActivo} />
          ))}
          {!datos.productos.length && <li className="text-sm text-neutral-500">No hay productos de venta disponibles en esta sucursal.</li>}
        </ul>
      </section>

      {/* 4. Promos (de la empresa; cada sucursal las prende y, si quiere, les pone su precio) */}
      <section aria-labelledby="titulo-promos" className="flex flex-col gap-3">
        <h2 id="titulo-promos" className="text-lg font-medium">
          Promos
        </h2>
        <p className="text-sm text-neutral-500">
          Una promo se define una sola vez para toda la empresa. Cada sucursal decide si la prende (apagada no sale en la carta ni en el POS) y, si quiere, le pone su propio precio.
        </p>
        <ul className="flex flex-col gap-2">
          {datos.promos.map((pr) => {
            const id = pr.id;
            const activa = pr.activa;
            const prendidaAca = pr.prendidaAca;
            return (
              <li key={pr.id} className="rounded border p-3" data-promo-carta={pr.titulo}>
                <details>
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">{pr.titulo}</span> · ${pr.precioAca.toLocaleString("es-AR")}
                    {pr.precioLocal !== null ? (datos.precioLocalActivo ? " (precio de esta sucursal)" : " (no rige: precio local apagado)") : ""} · {pr.seccionCarta} ·{" "}
                    {!pr.activa ? "apagada en toda la empresa" : pr.prendidaAca ? "prendida acá" : "apagada acá"} ·{" "}
                    {pr.cupos.length ? (
                      <>
                        Armable — {pr.cupos.length} cupo{pr.cupos.length === 1 ? "" : "s"}
                      </>
                    ) : (
                      "Informativa (sin cupos)"
                    )}
                  </summary>
                  {puedeDefinirPromos ? (
                    <FormConResultado
                      accion={async (fd: FormData) => {
                        "use server";
                        return refrescarSiOk(
                          await guardarPromoCarta({ id, seccionCartaId: campo(fd, "seccionCartaId"), titulo: campo(fd, "titulo"), descripcion: campo(fd, "descripcion"), precio: campo(fd, "precio"), orden: campo(fd, "orden") })
                        );
                      }}
                      className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
                    >
                      <CamposPromo secciones={datos.secciones} valores={pr} />
                      <div className="sm:col-span-2">
                        <button type="submit" className={CLASE_BOTON}>
                          Guardar promo
                        </button>
                      </div>
                    </FormConResultado>
                  ) : (
                    <DatosSoloLectura className="mt-3">
                      <Dato etiqueta="Título">{pr.titulo}</Dato>
                      <Dato etiqueta="Sección de carta">{pr.seccionCarta}</Dato>
                      <Dato etiqueta="Descripción" ancho>
                        {pr.descripcion}
                      </Dato>
                      <Dato etiqueta="Precio de la empresa">${pr.precio.toLocaleString("es-AR")}</Dato>
                      <Dato etiqueta="Orden">{pr.orden}</Dato>
                    </DatosSoloLectura>
                  )}

                  {/* Precio propio de esta sucursal (opcional): vacío = usa el de la empresa. */}
                  {puedePrecioLocalPromos ? (
                    <FormConResultado
                      accion={async (fd: FormData) => {
                        "use server";
                        const texto = campo(fd, "precioLocal").trim();
                        return refrescarSiOk(await guardarPrecioLocalPromoCarta(id, texto === "" ? null : texto));
                      }}
                      className="mt-3 flex flex-wrap items-end gap-2"
                    >
                      <label className="flex flex-col gap-1 text-sm">
                        Precio en esta sucursal (vacío = el de la empresa)
                        <input name="precioLocal" type="number" min={0} step="0.01" defaultValue={pr.precioLocal ?? ""} className={CLASE_INPUT} />
                      </label>
                      <button type="submit" className={CLASE_BOTON}>
                        Guardar precio de esta sucursal
                      </button>
                    </FormConResultado>
                  ) : (
                    <DatosSoloLectura className="mt-3">
                      <Dato etiqueta="Precio en esta sucursal">
                        {pr.precioLocal !== null ? `$${pr.precioLocal.toLocaleString("es-AR")}${datos.precioLocalActivo ? "" : " (no rige: precio local apagado)"}` : "El de la empresa"}
                      </Dato>
                    </DatosSoloLectura>
                  )}

                  {/* Cupos (Task #16, docs/plan-promo-combo-2026-09-26.md, D1): con uno o más, la promo pasa a ser ARMABLE en el POS. */}
                  <h3 className="mt-3 text-sm font-medium">Cupos</h3>
                  {puedeDefinirPromos ? (
                    <FormConResultado
                      accion={async (fd: FormData) => {
                        "use server";
                        const cupos = datos.secciones.flatMap((s) => {
                          if (!fd.get(`incluir_${s.id}`)) return [];
                          return [{ seccionCartaId: s.id, cantidadMinima: campo(fd, `min_${s.id}`), cantidadMaxima: campo(fd, `max_${s.id}`) }];
                        });
                        return refrescarSiOk(await guardarCuposPromoCarta(id, cupos));
                      }}
                      className="mt-1 flex flex-col gap-2"
                    >
                      <p className="text-sm text-neutral-500">Tildá de qué secciones se arma esta promo, con cuántas unidades mínimas y máximas de cada una (D1).</p>
                      {/* Paso 13 (opcional, no bloqueante): con los cupos YA guardados, cuánta holgura hay hoy antes de tocar el piso de
                          $0,01 por unidad en el peor caso (D3) — guardarCuposPromoCarta rechaza de una si un cambio lo cruza; esto avisa
                          ANTES de intentarlo, con lo que hay guardado ahora mismo (no recalcula en vivo lo que se está tipeando). */}
                      {pr.cupos.length > 0 &&
                        (() => {
                          const unidadesEnElPeorCaso = pr.cupos.reduce((suma, c) => suma + c.cantidadMaxima, 0);
                          const minimo = precioMinimoPromo([{ cantidad: unidadesEnElPeorCaso }]);
                          const holgura = pr.precio - minimo;
                          return (
                            <p className="text-xs text-neutral-500" data-aviso-peor-caso={pr.titulo}>
                              Con los cupos de hoy, el peor caso son {unidadesEnElPeorCaso} unidad{unidadesEnElPeorCaso === 1 ? "" : "es"} y el precio mínimo permitido es $
                              {minimo.toLocaleString("es-AR")}
                              {holgura > 0 ? ` — hay $${holgura.toLocaleString("es-AR")} de margen antes de ese piso si subís algún máximo.` : "."}
                            </p>
                          );
                        })()}
                      <CamposCupos secciones={datos.secciones} guardados={pr.cupos} />
                      <div>
                        <button type="submit" className={CLASE_BOTON}>
                          Guardar cupos
                        </button>
                      </div>
                    </FormConResultado>
                  ) : pr.cupos.length ? (
                    <DatosSoloLectura className="mt-1">
                      {pr.cupos.map((c) => (
                        <Dato key={c.id} etiqueta={c.seccionCarta}>
                          {c.cantidadMinima} a {c.cantidadMaxima}
                        </Dato>
                      ))}
                    </DatosSoloLectura>
                  ) : (
                    <p className="mt-1 text-sm text-neutral-500">Sin cupos: esta promo es solo informativa, el POS la ignora.</p>
                  )}
                </details>
                {puedeActivarPromos && (
                  <FormConResultado
                    accion={async () => {
                      "use server";
                      return refrescarSiOk(await actualizarActivaPromoCartaEnSucursal(id, !prendidaAca));
                    }}
                    className="mt-2"
                  >
                    <button type="submit" className="text-sm underline">
                      {pr.prendidaAca ? `Apagar «${pr.titulo}» en esta sucursal` : `Prender «${pr.titulo}» en esta sucursal`}
                    </button>
                  </FormConResultado>
                )}
                {puedeDefinirPromos && (
                  <FormConResultado
                    accion={async () => {
                      "use server";
                      return refrescarSiOk(await actualizarActivaPromoCarta(id, !activa));
                    }}
                    className="mt-2"
                  >
                    <button type="submit" className="text-sm underline">
                      {pr.activa ? `Apagar «${pr.titulo}» en toda la empresa` : `Prender «${pr.titulo}» en toda la empresa`}
                    </button>
                  </FormConResultado>
                )}
              </li>
            );
          })}
          {!datos.promos.length && <li className="text-sm text-neutral-500">La empresa no tiene promos cargadas.</li>}
        </ul>

        {!puedeDefinirPromos ? null : seccionesActivas.length > 0 ? (
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return refrescarSiOk(
                await guardarPromoCarta({ seccionCartaId: campo(fd, "seccionCartaId"), titulo: campo(fd, "titulo"), descripcion: campo(fd, "descripcion"), precio: campo(fd, "precio"), orden: campo(fd, "orden") })
              );
            }}
            className="grid max-w-2xl grid-cols-1 gap-2 rounded border border-dashed p-3 sm:grid-cols-2"
          >
            <h3 className="text-sm font-medium sm:col-span-2">Nueva promo (queda prendida en esta sucursal)</h3>
            <CamposPromo secciones={seccionesActivas} />
            <div className="sm:col-span-2">
              <button type="submit" className={CLASE_BOTON}>
                Crear promo
              </button>
            </div>
          </FormConResultado>
        ) : (
          <p className="text-sm text-neutral-500">Para cargar una promo hace falta al menos una sección de carta activa.</p>
        )}
      </section>
    </div>
  );
}

function CamposSeccion({
  valores,
  ordenSugerido = 0,
}: {
  valores?: { nombre: string; titulo: string | null; descripcion: string | null; imagenUrl: string | null; orden: number };
  /** Alta (DA5): el orden inicial; al editar se muestra el guardado. */
  ordenSugerido?: number;
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Nombre
        <input name="nombre" required defaultValue={valores?.nombre ?? ""} placeholder="Platos Principales" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Título (opcional, si no se usa el nombre)
        <input name="titulo" defaultValue={valores?.titulo ?? ""} placeholder="Del fuego" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Descripción (opcional)
        <textarea name="descripcion" rows={2} defaultValue={valores?.descripcion ?? ""} className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Imagen (URL https, opcional)
        <input name="imagenUrl" type="url" defaultValue={valores?.imagenUrl ?? ""} placeholder="https://…" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Orden
        <input name="orden" type="number" step={1} defaultValue={valores?.orden ?? ordenSugerido} className={CLASE_INPUT} />
      </label>
    </>
  );
}

function CamposGenero({
  valores,
  ordenSugerido = 0,
}: {
  valores?: { nombre: string; orden: number };
  /** Alta: el orden inicial; al editar se muestra el guardado. */
  ordenSugerido?: number;
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Nombre
        <input name="nombre" required defaultValue={valores?.nombre ?? ""} placeholder="Cerveza" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Orden
        <input name="orden" type="number" step={1} defaultValue={valores?.orden ?? ordenSugerido} className={CLASE_INPUT} />
      </label>
    </>
  );
}

/** El select "Género (opcional)" del contenido de un PV o de un ítem agrupado (docs/plan-genero-carta-2026-09-26.md). */
function SelectGenero({ generos, guardado }: { generos: OpcionGenero[]; guardado: string | null }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      Género (opcional)
      <select name="generoCartaId" defaultValue={guardado ?? ""} className={CLASE_INPUT}>
        <option value="">— sin género (sale suelto) —</option>
        {generos.map((g) => (
          <option key={g.id} value={g.id} disabled={!g.activo}>
            {g.nombre}
            {g.activo ? "" : " (apagado)"}
          </option>
        ))}
      </select>
    </label>
  );
}

function CamposPromo({
  secciones,
  valores,
}: {
  secciones: { id: string; nombre: string; activa: boolean }[];
  valores?: { seccionCartaId: string; titulo: string; descripcion: string | null; precio: number; orden: number };
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Título
        <input name="titulo" required defaultValue={valores?.titulo ?? ""} placeholder="1 pizza + coca 1,5 L" className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Sección de carta
        <select name="seccionCartaId" required defaultValue={valores?.seccionCartaId ?? ""} className={CLASE_INPUT}>
          {!valores && <option value="">— elegí una —</option>}
          {secciones.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
              {s.activa ? "" : " (apagada)"}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Descripción (opcional)
        <textarea name="descripcion" rows={2} defaultValue={valores?.descripcion ?? ""} className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Precio
        <input name="precio" type="number" min={0} step="0.01" required defaultValue={valores?.precio ?? ""} className={CLASE_INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Orden
        <input name="orden" type="number" step={1} defaultValue={valores?.orden ?? 0} className={CLASE_INPUT} />
      </label>
    </>
  );
}

/**
 * Cupos de una promo ARMABLE (Task #16, docs/plan-promo-combo-2026-09-26.md, D1): una fila por CADA sección de carta, con un
 * checkbox "incluir" + mínimo/máximo — full-replace al guardar (`guardarCuposPromoCarta`): la sección tildada con sus
 * cantidades entra, la que no queda tildada se borra si ya era un cupo. Sin cliente propio: los checkboxes e inputs son HTML
 * nativo, `FormConResultado` ya resetea el form entero cuando la acción sale bien (vuelve a los `defaultValue`/`defaultChecked`
 * de lo recién guardado, en el próximo render del servidor).
 */
function CamposCupos({
  secciones,
  guardados,
}: {
  secciones: { id: string; nombre: string; activa: boolean }[];
  guardados: { seccionCartaId: string; cantidadMinima: number; cantidadMaxima: number }[];
}) {
  const porSeccion = new Map(guardados.map((c) => [c.seccionCartaId, c]));
  return (
    <div className="flex flex-col gap-1">
      {secciones.map((s) => {
        const g = porSeccion.get(s.id);
        return (
          <div key={s.id} data-cupo-seccion={s.nombre} className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex min-w-[10rem] items-center gap-2">
              <input type="checkbox" name={`incluir_${s.id}`} defaultChecked={!!g} />
              {s.nombre}
              {s.activa ? "" : " (apagada)"}
            </label>
            <label className="flex items-center gap-1">
              mín.
              <input type="number" name={`min_${s.id}`} min={0} step={1} defaultValue={g?.cantidadMinima ?? 0} className={`${CLASE_INPUT} w-16`} />
            </label>
            <label className="flex items-center gap-1">
              máx.
              <input type="number" name={`max_${s.id}`} min={1} step={1} defaultValue={g?.cantidadMaxima ?? 1} className={`${CLASE_INPUT} w-16`} />
            </label>
          </div>
        );
      })}
    </div>
  );
}

function ContenidoProducto({
  producto: p,
  ubicacion,
  puedeEditar,
  puedeDescuento,
  precioLocalActivo,
}: {
  producto: ProductoCartaAdmin;
  ubicacion: UbicacionEnCarta;
  puedeEditar: boolean;
  puedeDescuento: boolean;
  precioLocalActivo: boolean;
}) {
  const productoId = p.id;
  // Un PV agrupado sale solo dentro de su ítem agrupado (docs/plan-agrupacion-items-carta-2026-09-24.md, D3/M6): su contenido propio se ignora mientras tanto.
  const estado = p.agrupadoEn
    ? `en «${p.agrupadoEn}»`
    : !p.contenido
      ? "sin contenido"
      : p.contenido.visibleEnCarta
        ? (p.seccionCarta ? "se muestra" : "visible, sin sección")
        : "oculto";
  return (
    <li className="rounded border p-3" data-contenido-carta={p.nombre}>
      <details>
        <summary className="cursor-pointer text-sm">
          <span className="font-medium">{p.nombre}</span> · {p.seccionCarta ?? "sin sección de carta"} · ${p.precio.toLocaleString("es-AR")} ·{" "}
          {estado}
          {p.contenido?.especial ? " · ★" : ""}
          {p.generoCarta ? ` · ${p.generoCarta}` : ""}
          {p.descuento !== null ? ` · −${p.descuento} %${precioLocalActivo ? "" : " (no rige: precio local apagado)"}` : ""}
        </summary>
        {p.agrupadoEn && (
          <p className="mt-2 text-sm text-neutral-500">
            Sale en la carta dentro de «{p.agrupadoEn}» (
            <EnlaceInterno href="/carta/agrupados" className="underline">
              Ítems agrupados de la carta
            </EnlaceInterno>
            ): mientras esté agrupado, el contenido de acá no se usa.
          </p>
        )}
        {!puedeEditar ? (
          <ContenidoSoloLectura producto={p} ubicacion={ubicacion} />
        ) : (
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return refrescarSiOk(
                await guardarContenidoCartaProducto(productoId, {
                  visibleEnCarta: fd.get("visibleEnCarta") === "on",
                  seccionCartaId: campo(fd, "seccionCartaId") || null,
                  descripcion: campo(fd, "descripcion"),
                  tags: campo(fd, "tags"),
                  especial: fd.get("especial") === "on",
                  orden: campo(fd, "orden"),
                  generoCartaId: campo(fd, "generoCartaId") || null,
                })
              );
            }}
            className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            <label className="flex items-center gap-2 text-sm">
              <input name="visibleEnCarta" type="checkbox" defaultChecked={p.contenido?.visibleEnCarta ?? true} /> Se muestra en la carta
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input name="especial" type="checkbox" defaultChecked={p.contenido?.especial ?? false} /> Especial (★)
            </label>
            <SeccionYOrden
              secciones={ubicacion.secciones}
              cantidadPorSeccion={ubicacion.cantidadPorSeccion}
              guardado={p.contenido && { seccionCartaId: p.contenido.seccionCartaId, orden: p.contenido.orden }}
              etiquetaSeccion="Sección de carta (obligatoria si se muestra)"
            />
            <SelectGenero generos={ubicacion.generos} guardado={p.contenido?.generoCartaId ?? null} />
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              Descripción (opcional)
              <textarea name="descripcion" rows={2} defaultValue={p.contenido?.descripcion ?? ""} className={CLASE_INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              Tags (separados por coma)
              <input name="tags" defaultValue={p.contenido?.tags.join(", ") ?? ""} placeholder="Regional, Sin TACC" className={CLASE_INPUT} />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className={CLASE_BOTON}>
                Guardar contenido de «{p.nombre}»
              </button>
            </div>
          </FormConResultado>
        )}

        {/* Producto con descuento (% por sucursal; no es una promo). Un producto agrupado no lo admite: el renglón agrupado muestra un solo precio. */}
        {!p.agrupadoEn &&
          (puedeDescuento ? (
            <FormConResultado
              accion={async (fd: FormData) => {
                "use server";
                const texto = campo(fd, "descuento").trim();
                return refrescarSiOk(await guardarDescuentoProducto(productoId, texto === "" ? null : texto));
              }}
              className="mt-3 flex flex-wrap items-end gap-2"
            >
              <label className="flex flex-col gap-1 text-sm">
                Descuento en esta sucursal, % (vacío = sin descuento)
                <input name="descuento" type="number" min={0} max={99.99} step="0.01" defaultValue={p.descuento ?? ""} className={CLASE_INPUT} />
              </label>
              <button type="submit" className={CLASE_BOTON}>
                Guardar descuento de «{p.nombre}»
              </button>
              {!precioLocalActivo && p.descuento !== null && <p className="w-full text-sm text-neutral-500">No rige: el precio local está apagado en esta sucursal (se cobra el precio de lista).</p>}
            </FormConResultado>
          ) : (
            <DatosSoloLectura className="mt-3">
              <Dato etiqueta="Descuento en esta sucursal">{p.descuento !== null ? `${p.descuento} %${precioLocalActivo ? "" : " (no rige: precio local apagado)"}` : "Sin descuento"}</Dato>
            </DatosSoloLectura>
          ))}
      </details>
    </li>
  );
}

/** El contenido de carta de un PV como texto, para quien puede ver la carta pero no editarla. */
function ContenidoSoloLectura({ producto: p, ubicacion }: { producto: ProductoCartaAdmin; ubicacion: UbicacionEnCarta }) {
  const c = p.contenido;
  if (!c) return <p className="mt-3 text-sm text-neutral-500">Todavía no tiene contenido de carta.</p>;
  const seccion = ubicacion.secciones.find((s) => s.id === c.seccionCartaId);
  const genero = ubicacion.generos.find((g) => g.id === c.generoCartaId);
  return (
    <DatosSoloLectura className="mt-3">
      <Dato etiqueta="Se muestra en la carta">{c.visibleEnCarta ? "Sí" : "No"}</Dato>
      <Dato etiqueta="Especial (★)">{c.especial ? "Sí" : "No"}</Dato>
      <Dato etiqueta="Sección de carta">{seccion && `${seccion.nombre}${seccion.activa ? "" : " (apagada)"}`}</Dato>
      <Dato etiqueta="Género">{genero && `${genero.nombre}${genero.activo ? "" : " (apagado)"}`}</Dato>
      <Dato etiqueta="Orden">{c.orden}</Dato>
      <Dato etiqueta="Descripción" ancho>
        {c.descripcion}
      </Dato>
      <Dato etiqueta="Tags" ancho>
        {c.tags.join(", ")}
      </Dato>
    </DatosSoloLectura>
  );
}
