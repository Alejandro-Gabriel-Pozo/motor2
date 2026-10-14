"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { lugaresParaPoner, ponerEnElLugar } from "@/core/carta/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import s from "../../carta-mant.module.css";

export interface SeccionParaOrdenar {
  id: string;
  nombre: string;
  activa: boolean;
  /** El `orden` que tiene hoy (el «orden visto» que la acción compara). */
  orden: number;
}

type Pedido = { seccionCartaId: string; ordenVisto: number }[];

/**
 * CARTA-MANT F3 «Secciones de la carta» con «Ordenar» (prototipo aprobado; ADR-034): la lista de las secciones de la EMPRESA en el orden en que salen, con «Oculta» en las apagadas y «⋯» para
 * ocultarla o mostrarla, moverla o ir a sus datos. «Ordenar»: se toca la sección que se quiere mover y después «Poner acá» donde va (sin arrastrar, que en el celular falla, ni flechas fila por
 * fila); la lista misma es la vista del resultado, y «Listo» lo guarda de UNA vez (`ordenarSeccionesCarta`: todo o nada, contra el orden que vio la pantalla). Después, «Deshacer» manda el orden
 * de antes. Sin permiso (`carta_secciones`), la lista sin botones.
 *
 * No hay «cambios sin publicar»: en el código no existe un borrador de la carta (cada cambio rige al guardarse), así que el aviso del prototipo no se muestra (decisión declarada en ADR-034).
 */
export function OrdenarSecciones({
  secciones,
  puede,
  acciones,
}: {
  secciones: SeccionParaOrdenar[];
  puede: boolean;
  acciones: { ordenar: (secciones: Pedido) => Promise<ResultadoAccion>; activa: (seccionCartaId: string, activa: boolean) => Promise<ResultadoAccion> };
}) {
  const router = useRouter();
  const [ordenando, setOrdenando] = useState(false);
  const [lista, setLista] = useState(secciones);
  const [elegida, setElegida] = useState<number | null>(null);
  const [menu, setMenu] = useState<SeccionParaOrdenar | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; mensaje: string; deshacer?: Pedido } | null>(null);
  const [pendiente, startTransition] = useTransition();

  const visible = ordenando ? lista : secciones;
  const cambio = lista.some((x, i) => x.id !== secciones[i]?.id);

  const empezar = (elegir: number | null = null) => {
    setLista(secciones);
    setElegida(elegir);
    setAviso(null);
    setOrdenando(true);
  };

  const enviar = (pedido: Pedido, deshacer?: Pedido) => {
    if (pendiente) return;
    startTransition(async () => {
      const r = await acciones.ordenar(pedido);
      setAviso({ ok: r.ok, mensaje: r.mensaje, deshacer: r.ok ? deshacer : undefined });
      if (r.ok) {
        setOrdenando(false);
        setElegida(null);
        router.refresh();
      }
    });
  };

  const descartar = () => {
    setOrdenando(false);
    setElegida(null);
  };

  const moverDeLugar = (x: SeccionParaOrdenar) => {
    setMenu(null);
    empezar(secciones.findIndex((y) => y.id === x.id));
  };

  const listo = () => {
    if (!cambio) {
      descartar();
      return;
    }
    // Después de guardar, cada sección queda con su posición como orden: el «Deshacer» manda el orden de antes contra esas posiciones.
    const anterior = secciones.map((x) => ({ seccionCartaId: x.id, ordenVisto: lista.findIndex((y) => y.id === x.id) }));
    enviar(
      lista.map((x) => ({ seccionCartaId: x.id, ordenVisto: x.orden })),
      anterior
    );
  };

  const alternarActiva = (x: SeccionParaOrdenar) => {
    setMenu(null);
    startTransition(async () => {
      const r = await acciones.activa(x.id, !x.activa);
      setAviso({ ok: r.ok, mensaje: r.mensaje });
      if (r.ok) router.refresh();
    });
  };

  const irALosDatos = (x: SeccionParaOrdenar) => {
    setMenu(null);
    const fila = document.getElementById(`datos-seccion-${x.id}`);
    fila?.querySelector("details")?.setAttribute("open", "");
    fila?.scrollIntoView({ block: "start" });
    fila?.querySelector<HTMLElement>("summary")?.focus();
  };

  const lugares = new Set(lugaresParaPoner(lista.length, ordenando ? elegida : null));
  const poner = (destino: number) => {
    if (elegida === null) return;
    setLista(ponerEnElLugar(lista, elegida, destino));
    setElegida(null);
  };
  const nombreElegida = elegida === null ? "" : (lista[elegida]?.nombre ?? "");
  const botonPoner = (destino: number) =>
    lugares.has(destino) ? (
      <button
        key={`poner-${destino}`}
        type="button"
        className={s.ponerAca}
        onClick={() => poner(destino)}
        aria-label={destino === lista.length ? `Poner al final: «${nombreElegida}»` : `Poner acá: «${nombreElegida}», antes de «${lista[destino]!.nombre}»`}
        data-poner-aca={destino}
      >
        {destino === lista.length ? "Poner al final" : "Poner acá"}
      </button>
    ) : null;

  return (
    <section aria-labelledby="titulo-orden-secciones" className="flex flex-col gap-3" data-ordenar-secciones>
      <div className="flex items-center gap-2">
        <h2 id="titulo-orden-secciones" className={`${s.h2} flex-1`}>
          Secciones de la carta
        </h2>
        {puede && (
          <button type="button" className={`${s.boton} ${ordenando ? s.botonPrincipal : ""}`} disabled={pendiente} onClick={ordenando ? listo : () => empezar()}>
            {ordenando ? (pendiente ? "Guardando…" : "Listo") : "Ordenar"}
          </button>
        )}
      </div>
      {ordenando ? (
        <div className={s.nota} role="status">
          {elegida === null ? "Tocá la sección que querés mover y después tocá dónde va. Sin flechas fila por fila." : `Ahora tocá dónde va «${nombreElegida}».`}
        </div>
      ) : (
        <p className={s.ayuda}>
          El orden se ve en todas las sucursales y en la carta pública (las secciones son de la empresa).{puede ? " Con «⋯» podés ocultar o mostrar una sección, moverla o cambiar sus datos." : ""}
        </p>
      )}
      <div className={s.tarjeta}>
        {visible.map((x, i) => {
          const contenido = (
            <>
              <span className={s.ordenN}>{i + 1}</span>
              <b style={x.activa ? undefined : { color: "var(--ink2)" }}>{x.nombre}</b>
              {!x.activa && <span className={s.etiqueta}>Oculta</span>}
            </>
          );
          return [
            ordenando ? botonPoner(i) : null,
            ordenando ? (
              <button
                key={x.id}
                type="button"
                className={`${s.orden} ${elegida === i ? s.ordenElegida : ""}`}
                aria-pressed={elegida === i}
                onClick={() => setElegida(elegida === i ? null : i)}
                data-seccion-orden={x.nombre}
              >
                {contenido}
                {elegida === i && (
                  <span className={s.etiqueta} style={{ marginLeft: "auto" }}>
                    Elegida
                  </span>
                )}
              </button>
            ) : (
              <div key={x.id} className={s.orden} data-seccion-orden={x.nombre}>
                {contenido}
                {puede && (
                  <button type="button" className={`${s.boton} ${s.botonSuave}`} style={{ marginLeft: "auto" }} aria-label={`Opciones de ${x.nombre}`} onClick={() => setMenu(x)}>
                    ⋯
                  </button>
                )}
              </div>
            ),
          ];
        })}
        {ordenando && botonPoner(lista.length)}
        {!visible.length && <p className={`${s.ayuda} p-3`}>Todavía no hay secciones de carta.</p>}
      </div>
      {ordenando && (
        <button type="button" className={`${s.boton} ${s.botonSuave} self-start`} onClick={descartar}>
          Descartar el orden nuevo
        </button>
      )}
      {aviso && (
        <div className={`${s.nota} ${aviso.ok ? s.notaOk : s.notaMal} flex flex-wrap items-center gap-2`} role={aviso.ok ? "status" : "alert"} data-aviso-orden>
          <span className="flex-1">{aviso.mensaje}</span>
          {aviso.deshacer && (
            <button type="button" className={`${s.boton} ${s.botonSuave}`} disabled={pendiente} onClick={() => enviar(aviso.deshacer!)}>
              Deshacer
            </button>
          )}
          {!aviso.ok && /Recargá la pantalla/.test(aviso.mensaje) && (
            <button type="button" className={`${s.boton} ${s.botonSuave}`} onClick={() => window.location.reload()}>
              Recargar
            </button>
          )}
        </div>
      )}
      {menu && (
        <div className={s.fondoHoja} onClick={() => setMenu(null)} data-hoja-de-seccion>
          <div
            className={s.hoja}
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-hoja-seccion"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMenu(null);
            }}
          >
            <h2 id="titulo-hoja-seccion">{menu.nombre}</h2>
            <button type="button" className={`${s.boton} ${s.ancho}`} onClick={() => alternarActiva(menu)}>
              {menu.activa ? "Ocultar la sección de la carta" : "Mostrar la sección en la carta"}
            </button>
            <p className={s.ayuda}>
              {menu.activa
                ? "Los productos de la sección dejan de verse en la carta de todas las sucursales; no se borra nada y se puede volver a mostrar."
                : "Hoy no aparece ningún producto de esta sección."}
            </p>
            <button type="button" className={`${s.boton} ${s.botonSuave} ${s.ancho}`} onClick={() => moverDeLugar(menu)}>
              Mover de lugar
            </button>
            <button type="button" className={`${s.boton} ${s.botonSuave} ${s.ancho}`} onClick={() => irALosDatos(menu)}>
              Cambiar el nombre y los datos
            </button>
            <button type="button" className={`${s.boton} ${s.botonSuave}`} onClick={() => setMenu(null)}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
