"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { EnlaceInterno } from "@/components/enlace-interno";
import { coincideConLaBusqueda } from "@/core/carta/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import s from "./carta-mant.module.css";

export type NivelDeMantenimiento = "hoy" | "precios" | "visibilidad";

export interface ProductoDeMantenimiento {
  id: string;
  nombre: string;
  /** Ya formateado por el servidor («$ 15.600»): formatearlo acá podría salir distinto en el navegador y romper la hidratación. */
  precio: string;
  disponible: boolean;
  visible: boolean;
}

export interface SeccionDeMantenimiento {
  id: string;
  nombre: string;
  /** De la EMPRESA (`SeccionCarta.activa`): apagada no sale en la carta de ninguna sucursal. */
  activa: boolean;
  productos: ProductoDeMantenimiento[];
}

export interface ProductoFueraDeCarta {
  id: string;
  nombre: string;
  precio: string;
  /** «Va a mostrar: …» / «Sin opciones.» (lo arma el servidor con la presentación de la carta pública). */
  vistaPrevia: string;
}

type Cambio = { productoId: string; disponible: boolean };

interface Aviso {
  id: number;
  mensaje: string;
  ok: boolean;
  deshacer?: () => Promise<ResultadoAccion>;
}

const NIVELES: [NivelDeMantenimiento, string][] = [
  ["hoy", "Hoy"],
  ["precios", "Precios"],
  ["visibilidad", "Visibilidad"],
];

function Chevron() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}

/**
 * CARTA-MANT (prototipo APROBADO, pestaña «Mantenimiento»): los tres niveles de lo de todos los días, con la misma cara del prototipo.
 *  - «Hoy»: lo que se acabó hoy. Contadores (en carta ahora / sin stock hoy, que filtra), buscador y una tarjeta por sección con el botón-estado que apaga o prende la sección entera de un toque y,
 *    desplegada, la pastilla de cada producto. Es la disponibilidad por producto y sucursal de siempre (`fijarDisponibilidadDeHoy`, todo o nada).
 *  - «Precios»: los precios de esta sucursal por sección (el ajuste por sección es la fase F4, con una decisión de redondeo del dueño pendiente).
 *  - «Visibilidad»: qué se muestra de forma estable: la sección (de la empresa) o el producto, con Sí/No; al final, plegado, «Fuera de carta (POS y menú del día)» con buscador y «Agregar a la carta».
 * Cada cambio lo decide y lo escribe el servidor (las Server Actions, con el eco de la sucursal que vio la pantalla); la pantalla se refresca y avisa abajo, con «Deshacer» (el cambio inverso).
 */
export function MantenimientoDeCarta({
  nivelInicial,
  secciones,
  ocultosSinSeccion,
  fueraDeCarta,
  puede,
  acciones,
}: {
  nivelInicial: NivelDeMantenimiento;
  secciones: SeccionDeMantenimiento[];
  ocultosSinSeccion: { id: string; nombre: string }[];
  fueraDeCarta: ProductoFueraDeCarta[];
  puede: { hoy: boolean; contenido: boolean; secciones: boolean };
  acciones: {
    fijarHoy: (cambios: Cambio[]) => Promise<ResultadoAccion>;
    visibleProducto: (productoId: string, visible: boolean) => Promise<ResultadoAccion>;
    activaSeccion: (seccionId: string, activa: boolean) => Promise<ResultadoAccion>;
    agregar: (productoId: string, seccionCartaId: string) => Promise<ResultadoAccion>;
    quitar: (productoId: string) => Promise<ResultadoAccion>;
  };
}) {
  const router = useRouter();
  const [nivel, setNivel] = useState<NivelDeMantenimiento>(nivelInicial);
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  const [soloSinStock, setSoloSinStock] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [pendiente, startTransition] = useTransition();
  const enviando = useRef(false);
  const secuencia = useRef(0);

  // El aviso se va solo a los 7 segundos (como en el prototipo); uno nuevo reemplaza al anterior.
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso((a) => (a?.id === aviso.id ? null : a)), 7000);
    return () => clearTimeout(t);
  }, [aviso]);

  const cambiarNivel = (n: NivelDeMantenimiento) => {
    setNivel(n);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("nivel", n);
      window.history.replaceState(null, "", url);
    } catch {
      // Sin la URL (un navegador raro) el nivel igual cambia; solo no se recuerda al recargar.
    }
  };

  /** Un toque: lo hace el servidor; si salió bien se refresca y el aviso ofrece «Deshacer» (otro pedido, el inverso, que ya no se puede deshacer). */
  const ejecutar = (accion: () => Promise<ResultadoAccion>, deshacer?: () => Promise<ResultadoAccion>) => {
    if (enviando.current) return;
    enviando.current = true;
    startTransition(async () => {
      try {
        const r = await accion();
        secuencia.current += 1;
        setAviso({ id: secuencia.current, mensaje: r.mensaje, ok: r.ok, deshacer: r.ok ? deshacer : undefined });
        if (r.ok) router.refresh();
      } finally {
        enviando.current = false;
      }
    });
  };

  const alternar = (clave: string, porDefecto: boolean) => setAbiertas((a) => ({ ...a, [clave]: !(a[clave] ?? porDefecto) }));
  const visibles = (sec: SeccionDeMantenimiento) => (sec.activa ? sec.productos.filter((p) => p.visible) : []);

  // Los contadores de «Hoy»: lo que se muestra (visible, en una sección prendida) y, de eso, lo que está sin stock hoy.
  const todos = secciones.flatMap(visibles);
  const sinStock = todos.filter((p) => !p.disponible).length;

  const sinPermiso = (permitido: boolean) => (permitido ? undefined : "Tu rol puede ver esta pantalla pero no cambiar esto.");

  const hoy = () => {
    const filtroActivo = buscar.trim() !== "" || soloSinStock;
    let algo = false;
    const tarjetas = secciones.map((sec) => {
      if (!sec.activa) {
        if (filtroActivo) return null;
        algo = true;
        return (
          <section key={sec.id} className={s.sec} data-seccion-hoy={sec.nombre}>
            <div className={s.secCabeza}>
              <div className={s.secTitulo}>
                <b className={s.apagada}>{sec.nombre}</b>
                <span>Sección oculta en la carta</span>
              </div>
              <button
                type="button"
                className={`${s.boton} ${s.botonSuave}`}
                disabled={!puede.secciones || pendiente}
                title={sinPermiso(puede.secciones)}
                onClick={() => ejecutar(() => acciones.activaSeccion(sec.id, true), () => acciones.activaSeccion(sec.id, false))}
              >
                <span className="sr-only">{sec.nombre}: </span>Mostrar
              </button>
            </div>
          </section>
        );
      }
      const v = visibles(sec);
      const disponibles = v.filter((p) => p.disponible);
      const ocultos = sec.productos.filter((p) => !p.visible).length;
      let items = sec.productos.filter((p) => coincideConLaBusqueda(p.nombre, buscar));
      if (soloSinStock) items = items.filter((p) => p.visible && !p.disponible);
      if (!items.length) return null;
      algo = true;
      const clave = `hoy:${sec.id}`;
      const abierta = abiertas[clave] ?? filtroActivo;
      const estado = v.length && !disponibles.length ? "off" : disponibles.length === v.length ? "on" : "mixto";
      const rotulo = estado === "on" ? "Todo disponible" : estado === "off" ? "Todo agotado" : "Algunos agotados";
      const apagar = disponibles.length > 0;
      return (
        <section key={sec.id} className={`${s.sec} ${abierta ? s.abierta : ""}`} data-seccion-hoy={sec.nombre}>
          <div className={s.secCabeza}>
            <button type="button" className={s.secTitulo} aria-expanded={abierta} onClick={() => alternar(clave, filtroActivo)}>
              <b>{sec.nombre}</b>
              <span>
                {disponibles.length} de {v.length} disponibles{ocultos ? ` · ${ocultos} oculto${ocultos > 1 ? "s" : ""}` : ""}
              </span>
            </button>
            <button
              type="button"
              className={`${s.maestro} ${estado === "mixto" ? s.mixto : estado === "off" ? s.todoAgotado : ""}`}
              disabled={!puede.hoy || v.length === 0 || pendiente}
              title={sinPermiso(puede.hoy)}
              aria-label={`${sec.nombre}: ${rotulo}. Tocá para ${apagar ? "apagar toda la sección" : "prender toda la sección"}`}
              onClick={() =>
                ejecutar(
                  () => acciones.fijarHoy(v.map((p) => ({ productoId: p.id, disponible: !apagar }))),
                  () => acciones.fijarHoy(v.map((p) => ({ productoId: p.id, disponible: p.disponible })))
                )
              }
            >
              <i className={s.punto} />
              {rotulo}
            </button>
            <button type="button" className={s.chevron} aria-expanded={abierta} aria-label={`${abierta ? "Plegar" : "Desplegar"} ${sec.nombre}`} onClick={() => alternar(clave, filtroActivo)}>
              <Chevron />
            </button>
          </div>
          {abierta && (
            <div className={s.filas}>
              {items.map((p) => (
                <div key={p.id} className={s.fila} data-producto-hoy={p.nombre}>
                  <div className={s.nombre}>
                    <b>{p.nombre}</b>
                    <small>{p.precio}</small>
                  </div>
                  {!p.visible ? (
                    <span className={s.etiqueta}>Oculto · decisión tuya</span>
                  ) : (
                    <button
                      type="button"
                      className={s.pastilla}
                      aria-pressed={p.disponible}
                      disabled={!puede.hoy || pendiente}
                      title={sinPermiso(puede.hoy)}
                      onClick={() =>
                        ejecutar(
                          () => acciones.fijarHoy([{ productoId: p.id, disponible: !p.disponible }]),
                          () => acciones.fijarHoy([{ productoId: p.id, disponible: p.disponible }])
                        )
                      }
                    >
                      <span className="sr-only">{p.nombre}: </span>
                      {p.disponible ? "En carta" : "Sin stock hoy"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      );
    });
    return (
      <>
        <p className={s.ayuda}>
          Lo que se acabó hoy. Tocá una sección para ver sus productos, o apagá la sección entera de una vez. Las opciones (guarniciones, tamaños) se agotan en{" "}
          <EnlaceInterno href="/movimientos/opciones-agotadas">Opciones agotadas</EnlaceInterno>
          .
        </p>
        <div className={`${s.tarjeta} ${s.contadores}`}>
          <div className={s.contador} data-contador="en-carta">
            <small>En carta ahora</small>
            <b>{todos.length - sinStock}</b>
            <span>de {todos.length} que se muestran</span>
          </div>
          <button type="button" className={s.contador} aria-pressed={soloSinStock} onClick={() => setSoloSinStock((x) => !x)} data-contador="sin-stock">
            <small>Sin stock hoy</small>
            <b>{sinStock}</b>
            <span>{soloSinStock ? "Mostrando solo estos · tocá para ver todos" : "Tocá para ver solo estos"}</span>
          </button>
        </div>
        <input className={s.buscar} type="search" placeholder="Buscar producto" aria-label="Buscar producto" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        <div className={s.secciones}>{tarjetas}</div>
        {!algo && <div className={`${s.nota} ${s.notaOk}`}>{secciones.length ? "No hay nada para mostrar con ese filtro." : "Todavía no hay secciones de carta."}</div>}
      </>
    );
  };

  const precios = () => (
    <>
      <p className={s.ayuda}>Para cambiar precios, de a uno o por sección completa. Antes de aplicar ves cómo queda cada producto.</p>
      <div className={`${s.nota}`}>
        Cambiar precios desde acá llega en la próxima entrega: el ajuste por sección espera la decisión del dueño sobre el redondeo. Mientras tanto, los precios se cambian en Catálogo
        (o el precio de esta sucursal en Precio local).
      </div>
      <div className={s.secciones}>
        {secciones
          .filter((sec) => sec.activa)
          .map((sec) => {
            const clave = `precios:${sec.id}`;
            const abierta = abiertas[clave] ?? false;
            const items = sec.productos.filter((p) => p.visible);
            return (
              <section key={sec.id} className={`${s.sec} ${abierta ? s.abierta : ""}`} data-seccion-precios={sec.nombre}>
                <div className={s.secCabeza}>
                  <button type="button" className={s.secTitulo} aria-expanded={abierta} onClick={() => alternar(clave, false)}>
                    <b>{sec.nombre}</b>
                    <span>{items.length} productos</span>
                  </button>
                  <button type="button" className={s.boton} disabled title="Llega en la próxima entrega (F4)">
                    <span className="sr-only">{sec.nombre}: </span>Ajustar sección
                  </button>
                  <button type="button" className={s.chevron} aria-expanded={abierta} aria-label={`${abierta ? "Plegar" : "Desplegar"} ${sec.nombre}`} onClick={() => alternar(clave, false)}>
                    <Chevron />
                  </button>
                </div>
                {abierta && (
                  <div className={s.filas}>
                    {items.map((p) => (
                      <div key={p.id} className={s.fila}>
                        <div className={s.nombre}>
                          <b>{p.nombre}</b>
                        </div>
                        <span className={s.precio}>{p.precio}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
      </div>
    </>
  );

  const siNo = (valor: boolean, etiqueta: string, permitido: boolean, cambiar: (v: boolean) => void, ancho: string) => (
    <div className={`${s.seg} ${ancho}`} role="group" aria-label={etiqueta}>
      <button type="button" aria-pressed={valor} disabled={!permitido || pendiente} title={sinPermiso(permitido)} onClick={() => !valor && cambiar(true)}>
        Sí
      </button>
      <button type="button" aria-pressed={!valor} disabled={!permitido || pendiente} title={sinPermiso(permitido)} onClick={() => valor && cambiar(false)}>
        No
      </button>
    </div>
  );

  const visibilidad = () => (
    <>
      <p className={s.ayuda}>Qué se muestra en la carta de forma estable: una sección entera o un producto. Lo que se acaba por un día va en «Hoy». Las secciones son de toda la empresa.</p>
      <div className={s.secciones}>
        {secciones.map((sec) => {
          const clave = `vis:${sec.id}`;
          const ocultos = sec.productos.filter((p) => !p.visible).length;
          const abierta = sec.activa && (abiertas[clave] ?? ocultos > 0);
          return (
            <section key={sec.id} className={`${s.sec} ${abierta ? s.abierta : ""}`} data-seccion-visibilidad={sec.nombre}>
              <div className={s.secCabeza}>
                <button type="button" className={s.secTitulo} aria-expanded={abierta} disabled={!sec.activa} onClick={() => alternar(clave, ocultos > 0)}>
                  <b className={sec.activa ? undefined : s.apagada}>{sec.nombre}</b>
                  <span>{sec.activa ? `${sec.productos.length - ocultos} se muestran · ${ocultos} ocultos` : "Sección oculta: no aparece ningún producto"}</span>
                </button>
                <div className={s.rotuloSeccion}>
                  <span className={s.rotulo} aria-hidden="true">
                    Sección
                  </span>
                  {siNo(sec.activa, `Sección «${sec.nombre}» en la carta`, puede.secciones, (v) => ejecutar(() => acciones.activaSeccion(sec.id, v), () => acciones.activaSeccion(sec.id, !v)), s.segSiNo)}
                </div>
              </div>
              {abierta && (
                <div className={s.filas}>
                  {sec.productos.map((p) => (
                    <div key={p.id} className={s.fila} data-producto-visibilidad={p.nombre}>
                      <div className={s.nombre}>
                        <b>{p.nombre}</b>
                      </div>
                      {siNo(p.visible, `«${p.nombre}» en la carta`, puede.contenido, (v) => ejecutar(() => acciones.visibleProducto(p.id, v), () => acciones.visibleProducto(p.id, !v)), s.segSiNo)}
                    </div>
                  ))}
                  {!sec.productos.length && (
                    <div className={s.fila}>
                      <span className={s.ayuda}>Todavía no tiene productos en esta sucursal.</span>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {ocultosSinSeccion.length > 0 && (
        <section className={s.sec} data-ocultos-sin-seccion>
          <div className={s.secCabeza}>
            <div className={s.secTitulo}>
              <b>Ocultos, sin sección</b>
              <span>Para mostrarlos, elegí su sección en su ficha (Parametrización › Secciones).</span>
            </div>
          </div>
          <div className={s.filas}>
            {ocultosSinSeccion.map((p) => (
              <div key={p.id} className={s.fila}>
                <div className={s.nombre}>
                  <b>{p.nombre}</b>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <FueraDeCarta productos={fueraDeCarta} secciones={secciones.filter((sec) => sec.activa)} puedeAgregar={puede.contenido} pendiente={pendiente} ejecutar={ejecutar} acciones={acciones} />
    </>
  );

  return (
    <>
      <div className={s.nivel} role="group" aria-label="Nivel de mantenimiento">
        {NIVELES.map(([n, etiqueta]) => (
          <button key={n} type="button" aria-pressed={nivel === n} onClick={() => cambiarNivel(n)}>
            {etiqueta}
          </button>
        ))}
      </div>
      {nivel === "hoy" ? hoy() : nivel === "precios" ? precios() : visibilidad()}
      <div className={`${s.tarjeta} ${s.irAParte}`}>
        <b>¿Secciones, géneros, promociones o apariencia?</b>
        <span className={s.ayuda}>Eso se cambia pocas veces y vive aparte.</span>
        <Link href="/carta/parametrizacion" className={`${s.boton} ${s.botonSuave}`}>
          Ir a Parametrización de la carta
        </Link>
      </div>
      {aviso && (
        <div className={`${s.aviso} ${aviso.ok ? "" : s.avisoMal}`} role={aviso.ok ? "status" : "alert"} data-aviso-carta>
          <span>{aviso.mensaje}</span>
          {aviso.deshacer && (
            <button type="button" disabled={pendiente} onClick={() => ejecutar(aviso.deshacer!)}>
              Deshacer
            </button>
          )}
        </div>
      )}
    </>
  );
}

/**
 * «Fuera de carta (POS y menú del día)», plegado al final de «Visibilidad» (decisión del dueño: no es un faltante, es lo que nunca sale en la carta pública). Buscador y, por producto, «Agregar a la
 * carta»: un toque abre las secciones (con la vista previa de las opciones que va a mostrar) y otro elige. El aviso ofrece «Deshacer» (vuelve a «Fuera de carta»).
 */
function FueraDeCarta({
  productos,
  secciones,
  puedeAgregar,
  pendiente,
  ejecutar,
  acciones,
}: {
  productos: ProductoFueraDeCarta[];
  secciones: { id: string; nombre: string }[];
  puedeAgregar: boolean;
  pendiente: boolean;
  ejecutar: (accion: () => Promise<ResultadoAccion>, deshacer?: () => Promise<ResultadoAccion>) => void;
  acciones: { agregar: (productoId: string, seccionCartaId: string) => Promise<ResultadoAccion>; quitar: (productoId: string) => Promise<ResultadoAccion> };
}) {
  const [buscar, setBuscar] = useState("");
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const visibles = productos.filter((p) => coincideConLaBusqueda(p.nombre, buscar));
  return (
    <details className={`${s.sec} ${s.fueraDeCarta}`} data-fuera-de-carta>
      <summary className={s.secCabeza}>
        <span className={s.secTitulo}>
          <b>Fuera de carta (POS y menú del día): {productos.length}</b>
          <span>Se venden en el POS o en el menú del día y no salen en la carta pública.</span>
        </span>
        <span className={s.chevron} aria-hidden="true">
          <Chevron />
        </span>
      </summary>
      <div className={`${s.filas} ${s.pad}`}>
        <p className={s.ayuda}>No hace falta hacer nada.{puedeAgregar ? " Para publicar uno, tocá «Agregar a la carta» y elegí la sección." : ""}</p>
        {productos.length > 0 && <input className={s.buscar} type="search" placeholder="Buscar producto" aria-label="Buscar en «Fuera de carta»" value={buscar} onChange={(e) => setBuscar(e.target.value)} />}
        {productos.length > 0 && visibles.length === 0 && (
          <p role="status" className={s.ayuda}>
            No hay productos que coincidan.
          </p>
        )}
        <div className={s.tarjeta}>
          {visibles.map((p) => {
            const abierto = eligiendo === p.id;
            return (
              <div key={p.id} data-fuera-de-carta-producto={p.nombre}>
                <div className={s.fila}>
                  <div className={s.nombre}>
                    <b>{p.nombre}</b>
                    <small>{p.precio}</small>
                  </div>
                  {puedeAgregar && (
                    <button type="button" className={`${s.boton} ${abierto ? s.botonSuave : ""}`} aria-expanded={abierto} disabled={secciones.length === 0} onClick={() => setEligiendo(abierto ? null : p.id)}>
                      <span className="sr-only">{p.nombre}: </span>
                      {abierto ? "Cancelar" : "Agregar a la carta"}
                    </button>
                  )}
                </div>
                {abierto && (
                  <fieldset className={`${s.pad} ${s.eleccion}`}>
                    <legend className={s.ayuda}>
                      ¿En qué sección de la carta va «{p.nombre}»?
                    </legend>
                    <p className={s.vistaPrevia} data-vista-previa>
                      {p.vistaPrevia}
                    </p>
                    <div className={s.chips}>
                      {secciones.map((sec) => (
                        <button
                          key={sec.id}
                          type="button"
                          className={s.chip}
                          disabled={pendiente}
                          onClick={() => {
                            setEligiendo(null);
                            ejecutar(() => acciones.agregar(p.id, sec.id), () => acciones.quitar(p.id));
                          }}
                        >
                          {sec.nombre}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}
              </div>
            );
          })}
        </div>
        {puedeAgregar && secciones.length === 0 && productos.length > 0 && <p className={s.ayuda}>Para agregar un producto a la carta hace falta al menos una sección activa.</p>}
      </div>
    </details>
  );
}
