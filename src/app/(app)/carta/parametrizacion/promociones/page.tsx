import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { EnlaceInterno } from "@/components/enlace-interno";
import { obtenerMiNivelPermiso, obtenerMiNivelPermisoDeEmpresa, requierePermisoVer } from "@/server/acceso/gate";
import { cargarAdminCarta } from "@/server/consultas/carta/admin";
import { cargarCombosDeLaCarta } from "@/server/consultas/carta/combos";
import {
  actualizarActivaPromoCarta,
  actualizarActivaPromoCartaEnSucursal,
  guardarCuposPromoCarta,
  guardarPrecioLocalPromoCarta,
  guardarPromoCarta,
  guardarSoloSalonPromoCarta,
} from "@/server/actions/carta/promos";
import { actualizarActivaEntradaDeCupo, agregarEntradaDeCupo, guardarVigenciaPromoCarta } from "@/server/actions/carta/combos";
import { precioMinimoPromo } from "@/core/pos/public";
import { MENU_DEL_DIA_VISIBLE } from "@/core/carta/public";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { FormConResultado } from "@/components/form-con-resultado";
import { AvisoSoloLectura, Dato, DatosSoloLectura } from "@/components/carta/datos-solo-lectura";
import { AgregarEntradaDeLugar } from "../../agregar-entrada-de-lugar";
import { DondeSeVe } from "./donde-se-ve";
import { lugaresDelFormulario } from "./lugares-del-formulario";
import { FilaDeCarta } from "@/components/fila-de-carta";
import { PESTANAS_DE_PROMOCIONES } from "@/core/carta/public";
import { EncabezadoDeCarta } from "../../encabezado-de-carta";
import estilos from "../../carta-mant.module.css";
import { CamposCupos, CamposLugares, CamposPromo, CamposVigencia, esFijo, textoDeVigencia } from "../formularios";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { CampoNumero } from "@/components/campo-numero";
import { Casilla } from "@/ui/primitivas/casilla";

/** Ayudantes puros de los closures "use server" de esta página (locales a propósito: `use-server-solo-donde-corresponde` solo los acepta definidos en el mismo archivo). */
const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

/**
 * CARTA-MANT: Parametrización › Promociones (prototipo aprobado). Las promos de la empresa (prendidas o no en esta sucursal, con su precio local, sus cupos, sus lugares de entradas y su vigencia), con el
 * MISMO bloque que antes estaba apilado en `/carta`: entrar pide «Ver» de `carta_ver`; cada formulario se dibuja solo con «Editar» de su clave (`carta_promo_definir`, `carta_promo_activar`,
 * `carta_promo_precio_local`); la acción vuelve a exigirlo.
 */
export default async function PromocionesDeCartaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta_ver", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;
  const [nivelPromoDefinir, nivelPromoActivar, nivelPromoPrecio] = await Promise.all([
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "carta_promo_definir", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_promo_activar", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_promo_precio_local", ctx.db),
  ]);
  const puedeDefinirPromos = nivelPromoDefinir.editar;
  const puedeActivarPromos = nivelPromoActivar.editar;
  const puedePrecioLocalPromos = nivelPromoPrecio.editar;
  const datos = await cargarAdminCarta(ctx.sucursalId, ctx.db, new Date());
  // GO-3b (U1): los combos de cada promo (lugares de entradas, sus entradas y la vigencia), aparte de `cargarAdminCarta` (que no cambia).
  const combos = await cargarCombosDeLaCarta(ctx.db, ctx.sucursalId);
  const seccionesActivas = datos.secciones.filter((x) => x.activa);

  return (
    <div className={estilos.raiz}>
      <EncabezadoDeCarta entrada="Promociones" pestana="Combos, cupos y vigencia" sucursal={ctx.sucursalNombre}>
        <FilaDeCarta ctx={ctx} etiqueta="Promociones" pestanas={PESTANAS_DE_PROMOCIONES} ruta="/carta/parametrizacion/promociones" />
      </EncabezadoDeCarta>
      <div className={estilos.contenido}>
        <div className={estilos.pad}>
          <div className={`${estilos.formulario} flex flex-col gap-10`}>
            {!(puedeDefinirPromos || puedeActivarPromos || puedePrecioLocalPromos) && <AvisoSoloLectura />}
      {/* 4. Promos (de la empresa; cada sucursal las prende y, si quiere, les pone su precio) */}
      <section aria-labelledby="titulo-promos" className="flex flex-col gap-3">
        <h2 id="titulo-promos" className="text-lg font-medium">
          Promos
        </h2>
        <p className="text-sm text-tinta-tenue">
          Una promo se define una sola vez para toda la empresa. Cada sucursal decide si la prende (apagada no sale en la carta ni en el POS) y, si quiere, le pone su propio precio.
        </p>
        <ul className="flex flex-col gap-2">
          {datos.promos.map((pr) => {
            const id = pr.id;
            // El precio de esta sucursal que muestra el formulario (lo que vio quien guarda: si otra persona lo cambió en el medio, la acción no lo pisa y pide recargar).
            const precioLocalVisto = pr.precioLocal;
            const activa = pr.activa;
            const prendidaAca = pr.prendidaAca;
            const combo = combos.porPromo[pr.id] ?? { lugares: [], vigencia: { version: 1, vigenteDesde: null, vigenteHasta: null, diasDeSemana: null }, soloSalon: false };
            const lugares = combo.lugares;
            const versionDeLaPromo = combo.vigencia.version;
            return (
              <li key={pr.id} className="rounded border p-3" data-promo-carta={pr.titulo}>
                <details>
                  <summary className="cursor-pointer text-sm max-md:min-h-11 max-md:py-2">
                    <span className="font-medium">{pr.titulo}</span> · ${pr.precioAca.toLocaleString("es-AR")}
                    {pr.precioLocal !== null ? (datos.precioLocalActivo ? " (precio de esta sucursal)" : " (no rige: precio local apagado)") : ""} · {pr.seccionCarta} ·{" "}
                    {!pr.activa ? "apagada en toda la empresa" : pr.prendidaAca ? "prendida acá" : "apagada acá"} ·{" "}
                    {combo.soloSalon ? "solo salón · " : ""}
                    {pr.cupos.length + lugares.length ? (
                      <>
                        Armable — {pr.cupos.length + lugares.length} cupo{pr.cupos.length + lugares.length === 1 ? "" : "s"}
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
                        <BotonDeServidor type="submit" tamano="compacto">
                          Guardar promo
                        </BotonDeServidor>
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
                        return refrescarSiOk(await guardarPrecioLocalPromoCarta(id, texto === "" ? null : texto, precioLocalVisto));
                      }}
                      className="mt-3 flex flex-wrap items-end gap-2"
                    >
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`precio-local-${id}`} className="text-sm font-medium">
                          Precio en esta sucursal (vacío = el de la empresa)
                        </label>
                        <CampoNumero id={`precio-local-${id}`} name="precioLocal" tipo="importe" etiqueta="El precio en esta sucursal" prefijo="$" defaultValue={pr.precioLocal === null ? "" : String(pr.precioLocal)} />
                      </div>
                      <BotonDeServidor type="submit" tamano="compacto">
                        Guardar precio de esta sucursal
                      </BotonDeServidor>
                    </FormConResultado>
                  ) : (
                    <DatosSoloLectura className="mt-3">
                      <Dato etiqueta="Precio en esta sucursal">
                        {pr.precioLocal !== null ? `$${pr.precioLocal.toLocaleString("es-AR")}${datos.precioLocalActivo ? "" : " (no rige: precio local apagado)"}` : "El de la empresa"}
                      </Dato>
                    </DatosSoloLectura>
                  )}

                  {/* Interruptor «solo salón» (docs/diseno-promo-solo-salon-2026-10-26.md): de la empresa, con la versión que vio la pantalla (la misma de la vigencia). */}
                  <DondeSeVe
                    titulo={pr.titulo}
                    soloSalon={combo.soloSalon}
                    tieneCupos={pr.cupos.length + lugares.length > 0}
                    puedeDefinir={puedeDefinirPromos}
                    guardar={async (fd: FormData) => {
                      "use server";
                      return refrescarSiOk(await guardarSoloSalonPromoCarta({ promoCartaId: id, versionEsperada: versionDeLaPromo, soloSalon: fd.get("soloSalon") !== null }));
                    }}
                  />

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
                        // GO-3b (D3): la lista que se guarda es la FINAL, de todos los tipos: los lugares de entradas que siguen tildados van también (si no, se darían de baja).
                        const deEntradas = lugaresDelFormulario(fd);
                        return refrescarSiOk(await guardarCuposPromoCarta(id, [...cupos, ...deEntradas]));
                      }}
                      className="mt-1 flex flex-col gap-2"
                    >
                      <p className="text-sm text-tinta-tenue">Tildá de qué secciones se arma esta promo, con cuántas unidades mínimas y máximas de cada una (D1).</p>
                      {/* Paso 13 (opcional, no bloqueante): con los cupos YA guardados, cuánta holgura hay hoy antes de tocar el piso de
                          $0,01 por unidad en el peor caso (D3) — guardarCuposPromoCarta rechaza de una si un cambio lo cruza; esto avisa
                          ANTES de intentarlo, con lo que hay guardado ahora mismo (no recalcula en vivo lo que se está tipeando). */}
                      {pr.cupos.length > 0 &&
                        (() => {
                          const unidadesEnElPeorCaso = pr.cupos.reduce((suma, c) => suma + c.cantidadMaxima, 0);
                          const minimo = precioMinimoPromo([{ cantidad: unidadesEnElPeorCaso }]);
                          const holgura = pr.precio - minimo;
                          return (
                            <p className="text-xs text-tinta-tenue" data-aviso-peor-caso={pr.titulo}>
                              Con los cupos de hoy, el peor caso son {unidadesEnElPeorCaso} unidad{unidadesEnElPeorCaso === 1 ? "" : "es"} y el precio mínimo permitido es $
                              {minimo.toLocaleString("es-AR")}
                              {holgura > 0 ? ` — hay $${holgura.toLocaleString("es-AR")} de margen antes de ese piso si subís algún máximo.` : "."}
                            </p>
                          );
                        })()}
                      <CamposCupos secciones={datos.secciones} guardados={pr.cupos} />
                      <CamposLugares lugares={lugares} />
                      <div>
                        <BotonDeServidor type="submit" tamano="compacto">
                          Guardar cupos
                        </BotonDeServidor>
                      </div>
                    </FormConResultado>
                  ) : pr.cupos.length + lugares.length ? (
                    <DatosSoloLectura className="mt-1">
                      {pr.cupos.map((c) => (
                        <Dato key={c.id} etiqueta={c.seccionCarta}>
                          {c.cantidadMinima} a {c.cantidadMaxima}
                        </Dato>
                      ))}
                      {lugares.map((l) => (
                        <Dato key={l.id} etiqueta={`${l.nombre} (${l.tipo === "DEL_DIA" ? "del día" : "lista"})`}>
                          {l.cantidadMinima} a {l.cantidadMaxima}
                        </Dato>
                      ))}
                    </DatosSoloLectura>
                  ) : (
                    <p className="mt-1 text-sm text-tinta-tenue">Sin cupos: esta promo es solo informativa, el POS la ignora.</p>
                  )}

                  {/* GO-3b (U1): las entradas de cada lugar LISTA (con una sola y mínimo = máximo, viene FIJO). Los platos de un lugar «del día» se cargan en Movimientos → Menú del día. */}
                  {lugares.map((l) => {
                    // Los closures "use server" capturan solo el id del lugar (texto): lo que capturan viaja al cliente.
                    const cupoId = l.id;
                    return (
                    <div key={l.id} className="mt-3 flex flex-col gap-1" data-lugar-de-combo={l.nombre}>
                      <h4 className="text-sm font-medium">
                        {l.nombre} · {l.tipo === "DEL_DIA" ? "del día" : esFijo(l) ? "viene fijo" : `se elige ${l.cantidadMinima === l.cantidadMaxima ? l.cantidadMaxima : `de ${l.cantidadMinima} a ${l.cantidadMaxima}`}`}
                      </h4>
                      {l.tipo === "DEL_DIA" ? (
                        // Con el menú del día apagado (`MENU_DEL_DIA_VISIBLE`, decisión del dueño 2026-10-20) no se nombra ni se enlaza su pantalla (no existe).
                        MENU_DEL_DIA_VISIBLE ? (
                          <p className="text-sm text-tinta-tenue">
                            El plato lo carga cada sucursal por día en{" "}
                            <EnlaceInterno href="/movimientos/menu-del-dia" className="underline">
                              Menú del día
                            </EnlaceInterno>
                            .
                          </p>
                        ) : null
                      ) : (
                        <>
                          {l.entradas.length === 0 ? (
                            <p className="text-sm text-tinta-tenue">Sin entradas todavía: sumá los productos que se pueden elegir acá.</p>
                          ) : (
                            <ul className="flex flex-col divide-y text-sm">
                              {l.entradas.map((e) => {
                                const entradaId = e.id;
                                const activaAhora = e.activa;
                                return (
                                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1" data-entrada-de-lugar={e.nombre}>
                                    <span className={e.activa ? "" : "text-tinta-tenue line-through"}>{e.nombre}</span>
                                    {puedeDefinirPromos && (
                                      <FormConResultado
                                        accion={async () => {
                                          "use server";
                                          return refrescarSiOk(await actualizarActivaEntradaDeCupo({ entradaId, activa: !activaAhora }));
                                        }}
                                      >
                                        <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                                          {e.activa ? `Sacar «${e.nombre}»` : `Volver a ofrecer «${e.nombre}»`}
                                        </BotonDeServidor>
                                      </FormConResultado>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          {puedeDefinirPromos && (
                            <AgregarEntradaDeLugar
                              lugar={l.nombre}
                              productos={combos.productos}
                              agregar={async (productoId: string, opciones: { opcionId: string; cantidad: number }[]) => {
                                "use server";
                                return refrescarSiOk(await agregarEntradaDeCupo({ cupoId, productoId, opciones }));
                              }}
                            />
                          )}
                        </>
                      )}
                    </div>
                    );
                  })}

                  {/* GO-3b (D-7): la vigencia de la promo (fechas y días de la semana); sin nada = vale siempre. Se evalúa al agregarla a una mesa. */}
                  <h3 className="mt-3 text-sm font-medium">Vigencia</h3>
                  {puedeDefinirPromos ? (
                    <FormConResultado
                      accion={async (fd: FormData) => {
                        "use server";
                        const dias = [0, 1, 2, 3, 4, 5, 6].filter((d) => fd.get(`dia_${d}`));
                        const desde = campo(fd, "vigenteDesde").trim();
                        const hasta = campo(fd, "vigenteHasta").trim();
                        return refrescarSiOk(
                          await guardarVigenciaPromoCarta({ promoCartaId: id, versionEsperada: versionDeLaPromo, vigenteDesde: desde || null, vigenteHasta: hasta || null, diasDeSemana: dias })
                        );
                      }}
                      className="mt-1 flex flex-col gap-2"
                    >
                      <CamposVigencia vigencia={combo.vigencia} />
                      <div>
                        <BotonDeServidor type="submit" tamano="compacto">
                          Guardar vigencia
                        </BotonDeServidor>
                      </div>
                    </FormConResultado>
                  ) : (
                    <p className="mt-1 text-sm">{textoDeVigencia(combo.vigencia)}</p>
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
                    <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                      {pr.prendidaAca ? `Apagar «${pr.titulo}» en esta sucursal` : `Prender «${pr.titulo}» en esta sucursal`}
                    </BotonDeServidor>
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
                    <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
                      {pr.activa ? `Apagar «${pr.titulo}» en toda la empresa` : `Prender «${pr.titulo}» en toda la empresa`}
                    </BotonDeServidor>
                  </FormConResultado>
                )}
              </li>
            );
          })}
          {!datos.promos.length && <li className="text-sm text-tinta-tenue">La empresa no tiene promos cargadas.</li>}
        </ul>

        {!puedeDefinirPromos ? null : seccionesActivas.length > 0 ? (
          <FormConResultado
            accion={async (fd: FormData) => {
              "use server";
              return refrescarSiOk(
                await guardarPromoCarta({
                  seccionCartaId: campo(fd, "seccionCartaId"),
                  titulo: campo(fd, "titulo"),
                  descripcion: campo(fd, "descripcion"),
                  precio: campo(fd, "precio"),
                  orden: campo(fd, "orden"),
                  ...(fd.get("soloSalon") !== null ? { soloSalon: true } : {}),
                })
              );
            }}
            className="grid max-w-2xl grid-cols-1 gap-2 rounded border border-dashed p-3 sm:grid-cols-2"
          >
            <h3 className="text-sm font-medium sm:col-span-2">Nueva promo (queda prendida en esta sucursal)</h3>
            <CamposPromo secciones={seccionesActivas} />
            <div className="sm:col-span-2">
              <Casilla
                name="soloSalon"
                etiqueta="Solo salón: se vende desde el POS, pero no aparece en la carta pública (web, QR ni impresa)"
                ayuda="Útil para un menú pactado con una empresa: el precio no queda publicado."
              />
            </div>
            <div className="sm:col-span-2">
              <BotonDeServidor type="submit" tamano="compacto">
                Crear promo
              </BotonDeServidor>
            </div>
          </FormConResultado>
        ) : (
          <p className="text-sm text-tinta-tenue">Para cargar una promo hace falta al menos una sección de carta activa.</p>
        )}
      </section>
          </div>
        </div>
      </div>
    </div>
  );
}
