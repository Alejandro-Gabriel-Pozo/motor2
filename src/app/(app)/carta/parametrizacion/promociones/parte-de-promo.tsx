"use client";

import { useId, useRef, useState, useTransition } from "react";
import { ARMADO_DE_PROMO_COMO_PEDERNAL, borradorCerrado, comandoDeLaFila, platosParaTildar, textosDeLaPantallaDePromos, type BorradorDeProducto, type ComandoDeFila, type FilaDeParte, type ModoDeFila, type ProductoParaEntrada } from "@/core/carta/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Casilla } from "@/ui/primitivas/casilla";
import { Selector } from "@/ui/primitivas/selector";
import { ConfiguracionDelProducto } from "../../agregar-entrada-de-lugar";

/**
 * UNA parte nueva de un combo dentro de la hoja «Agregar componente» (E2b de `docs/diseno-promo-parte-de-seccion-2026-11-11.md`, detrás de `ARMADO_DE_PROMO_COMO_PEDERNAL`). TODO NACE CERRADO: al abrir la hoja no queda elegida ninguna de las dos
 * modalidades (en una sección hay que elegir «Toda la sección» o «Solo estos platos»); en «Solo estos platos» ningún plato nace tildado y, de un plato tildado en «el mozo elige», las opciones permitidas tampoco.
 *
 * Una sola acción (`guardarParteDePromo`: el cupo y los platos juntos, todo o nada). La cantidad es EXACTA (mín. = máx.), con los botones − y +: el servidor acepta de 1 a 999 y la pantalla no pone un tope propio. Para quitar una parte se usa «Quitar» de
 * su tarjeta (el mismo comando en modo «No entra»). Un doble toque no manda dos veces. El servidor vuelve a validar y decidir todo.
 */
const MAXIMO_QUE_ACEPTA_EL_SERVIDOR = 999;

export function ParteDePromo({
  fila,
  productos,
  guardar,
  alGuardar,
  alCancelar,
}: {
  fila: FilaDeParte;
  productos: ProductoParaEntrada[];
  guardar: (comando: ComandoDeFila) => Promise<ResultadoAccion>;
  /** Se llama cuando el servidor confirmó la parte (la hoja se cierra). */
  alGuardar: () => void;
  alCancelar: () => void;
}) {
  const base = useId();
  const t = textosDeLaPantallaDePromos(ARMADO_DE_PROMO_COMO_PEDERNAL);
  const esSeccion = fila.lugar.tipo === "SECCION";
  // Una sección recién elegida no tiene modalidad elegida (todo nace cerrado); una lista con nombre propio solo puede ser «Solo estos platos».
  const [modo, setModo] = useState<"" | "TODA" | "SOLO_ESTOS">(esSeccion ? "" : "SOLO_ESTOS");
  const [cantidad, setCantidad] = useState(Math.max(1, fila.cantidadMaxima));
  const [nuevos, setNuevos] = useState<Record<string, BorradorDeProducto>>({});
  const [resultado, setResultado] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [pendiente, startTransition] = useTransition();
  const enviando = useRef(false);

  const modoEfectivo: ModoDeFila = modo === "" ? "NO_ENTRA" : modo;
  const paraTildar = platosParaTildar(fila, productos);
  const cambioElModo = (v: string) => {
    setResultado(null);
    setModo(v === "TODA" ? "TODA" : v === "SOLO_ESTOS" ? "SOLO_ESTOS" : "");
  };
  const tildar = (p: ProductoParaEntrada) => setNuevos((antes) => ({ ...antes, [p.productoId]: antes[p.productoId] ?? borradorCerrado(p) }));
  const destildar = (id: string) =>
    setNuevos((antes) => {
      const resto = { ...antes };
      delete resto[id];
      return resto;
    });
  const cambiarBorrador = (id: string, cambio: (b: BorradorDeProducto) => BorradorDeProducto) => setNuevos((antes) => (antes[id] ? { ...antes, [id]: cambio(antes[id]!) } : antes));

  const nuevosConProducto = paraTildar.flatMap((p) => (nuevos[p.productoId] ? [{ producto: p, borrador: nuevos[p.productoId]! }] : []));
  const armado = comandoDeLaFila({
    fila,
    modo: modoEfectivo,
    cantidadMinima: String(cantidad),
    cantidadMaxima: String(cantidad),
    mantenidas: new Set(),
    nuevos: nuevosConProducto,
  });
  // Una sección elegida sin modalidad no se puede guardar todavía (no se elige por el dueño).
  const falta = modo === "" ? "Elegí si entra toda la sección o solo ciertos platos." : null;

  const guardarLaParte = () => {
    if (enviando.current || falta !== null || !armado.ok) return;
    enviando.current = true;
    const comando = armado.comando;
    startTransition(async () => {
      try {
        const r = await guardar(comando);
        setResultado({ ok: r.ok, mensaje: r.mensaje });
        if (r.ok) alGuardar();
      } finally {
        enviando.current = false;
      }
    });
  };

  return (
    <div data-cupo-seccion={fila.nombre} data-parte-de-promo={fila.nombre} className="flex flex-col gap-4 text-sm">
      {esSeccion ? (
        <Selector etiqueta={`Qué entra de «${fila.nombre}»`} id={`${base}-modo`} value={modo} onChange={(e) => cambioElModo(e.target.value)} disabled={pendiente} className="min-w-0 max-w-full">
          <option value="">Elegí…</option>
          <option value="TODA">Toda la sección</option>
          <option value="SOLO_ESTOS">Solo estos platos</option>
        </Selector>
      ) : (
        <p className="text-tinta-tenue">{t.modalidadDeLaListaPropia}</p>
      )}

      {modo !== "" && (
        <div className="flex flex-col gap-1" data-cantidad-de-la-parte>
          <span className="font-medium">{t.rotuloDeLaCantidad}</span>
          <div className="flex items-center gap-3">
            <Boton variante="secundario" tamano="tactil" aria-label="Menos" disabled={pendiente || cantidad <= 1} onClick={() => setCantidad((c) => Math.max(1, c - 1))}>
              −
            </Boton>
            <span className="min-w-10 flex-1 text-center font-medium" aria-live="polite" data-cantidad>
              {cantidad}
            </span>
            <Boton variante="secundario" tamano="tactil" aria-label="Más" disabled={pendiente || cantidad >= MAXIMO_QUE_ACEPTA_EL_SERVIDOR} onClick={() => setCantidad((c) => Math.min(MAXIMO_QUE_ACEPTA_EL_SERVIDOR, c + 1))}>
              +
            </Boton>
          </div>
        </div>
      )}

      {modo === "SOLO_ESTOS" && (
        <div className="flex flex-col gap-2" data-solo-estos-platos>
          {paraTildar.length === 0 ? (
            <p className="text-xs text-tinta-tenue">{fila.origen === "FUERA" ? "No hay más platos de venta que no estén en la carta." : "No hay más platos de venta en esta sección."}</p>
          ) : (
            <fieldset className="flex flex-col divide-y rounded border px-3">
              <legend className="px-1 font-medium">Tildá los platos que entran (ninguno entra solo)</legend>
              {paraTildar.map((p) => {
                const borrador = nuevos[p.productoId];
                const c = borrador ? comandoDeLaFila({ fila: { lugar: fila.lugar, entradas: [] }, modo: "SOLO_ESTOS", cantidadMinima: "0", cantidadMaxima: "1", mantenidas: new Set(), nuevos: [{ producto: p, borrador }] }) : null;
                return (
                  <div key={p.productoId} className="py-1" data-producto-de-origen={p.nombre}>
                    <Casilla etiqueta={p.nombreParaMostrar} checked={!!borrador} disabled={pendiente} onChange={(e) => (e.target.checked ? tildar(p) : destildar(p.productoId))} />
                    {borrador && <ConfiguracionDelProducto producto={p} borrador={borrador} alCambiar={(cambio) => cambiarBorrador(p.productoId, cambio)} motivo={c && !c.ok ? c.motivo : null} />}
                  </div>
                );
              })}
            </fieldset>
          )}
        </div>
      )}

      {falta !== null && <p className="text-xs text-tinta-tenue">{falta}</p>}
      {falta === null && !armado.ok && <p className="text-xs text-tinta-tenue">{armado.motivo}</p>}
      {resultado && !resultado.ok && (
        <Aviso variante="error" forma="en-linea">
          {resultado.mensaje}
        </Aviso>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Boton variante="secundario" tamano="tactil" disabled={pendiente} onClick={alCancelar}>
          {t.cancelar}
        </Boton>
        <Boton tamano="tactil" disabled={falta !== null || !armado.ok || pendiente} cargando={pendiente} onClick={guardarLaParte}>
          {t.agregarComponente}
        </Boton>
      </div>
    </div>
  );
}
