"use client";

import { useId, useRef, useState, useTransition } from "react";
import { CampoNumero } from "@/components/campo-numero";
import { borradorCerrado, comandoDeLaFila, esCantidadExacta, platosParaTildar, type BorradorDeProducto, type ComandoDeFila, type FilaDeParte, type ModoDeFila, type ProductoParaEntrada } from "@/core/carta/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Casilla } from "@/ui/primitivas/casilla";
import { Selector } from "@/ui/primitivas/selector";
import { ConfiguracionDelProducto } from "../../agregar-entrada-de-lugar";

/**
 * UNA parte de una promo en la fila de «Qué lleva» (E2b de `docs/diseno-promo-parte-de-seccion-2026-11-11.md`, detrás de `ARMADO_DE_PROMO_COMO_PEDERNAL`). TODO NACE CERRADO: una parte que no entra se ve sin tildar; al tildarla no queda elegida ninguna de las dos
 * modalidades (en una sección hay que elegir «Toda la sección» o «Solo estos platos»); en «Solo estos platos» ningún plato nace tildado y, de un plato tildado en «el mozo elige», las opciones permitidas tampoco.
 *
 * Una sola acción por fila (`guardarParteDePromo`: el cupo y los platos juntos, todo o nada). Lo que ya lleva la parte se ve tildado y, al destildarlo, se saca; para cambiar la configuración de un plato que ya está se saca y se vuelve a sumar (igual que en la lista de siempre).
 * La cantidad es EXACTA (mín. = máx.); una parte heredada con rango «de mín. a máx.» se sigue mostrando así hasta que alguien la reemplace. Un doble toque no manda dos veces. El servidor vuelve a validar y decidir todo.
 */
export function ParteDePromo({
  fila,
  productos,
  puedeEditar,
  guardar,
}: {
  fila: FilaDeParte;
  productos: ProductoParaEntrada[];
  puedeEditar: boolean;
  guardar: (comando: ComandoDeFila) => Promise<ResultadoAccion>;
}) {
  const base = useId();
  const esSeccion = fila.lugar.tipo === "SECCION";
  const [entra, setEntra] = useState(fila.modo !== "NO_ENTRA");
  // Una sección recién tildada no tiene modalidad elegida (todo nace cerrado); una lista con nombre propio solo puede ser «Solo estos platos».
  const [modo, setModo] = useState<"" | "TODA" | "SOLO_ESTOS">(fila.modo === "NO_ENTRA" ? (esSeccion ? "" : "SOLO_ESTOS") : fila.modo);
  const [minimo, setMinimo] = useState(String(fila.cantidadMinima));
  const [maximo, setMaximo] = useState(String(fila.cantidadMaxima));
  const exacta = esCantidadExacta(fila.cantidadMinima, fila.cantidadMaxima);
  const [mantenidas, setMantenidas] = useState<Set<string>>(() => new Set(fila.entradas.map((e) => e.id)));
  const [nuevos, setNuevos] = useState<Record<string, BorradorDeProducto>>({});
  const [resultado, setResultado] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [pendiente, startTransition] = useTransition();
  const enviando = useRef(false);

  const modoEfectivo: ModoDeFila = !entra ? "NO_ENTRA" : modo === "" ? "NO_ENTRA" : modo;
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
    cantidadMinima: exacta ? maximo : minimo,
    cantidadMaxima: maximo,
    mantenidas,
    nuevos: nuevosConProducto,
  });
  // Una sección tildada sin modalidad elegida no se puede guardar todavía (no se elige por el dueño).
  const falta = entra && modo === "" ? "Elegí si entra toda la sección o solo ciertos platos." : null;

  const guardarLaParte = () => {
    if (enviando.current || falta !== null || !armado.ok) return;
    enviando.current = true;
    const comando = armado.comando;
    startTransition(async () => {
      try {
        const r = await guardar(comando);
        setResultado({ ok: r.ok, mensaje: r.mensaje });
      } finally {
        enviando.current = false;
      }
    });
  };

  const sinCambios = fila.modo === "NO_ENTRA" && !entra;
  return (
    <div data-cupo-seccion={fila.nombre} data-parte-de-promo={fila.nombre} className="flex flex-col gap-2 rounded border p-2 text-sm">
      <Casilla
        etiqueta={`${fila.nombre}${fila.apagada ? " (apagada)" : ""}`}
        checked={entra}
        disabled={!puedeEditar || pendiente}
        onChange={(e) => {
          setResultado(null);
          setEntra(e.target.checked);
        }}
      />
      {entra && (
        <div className="ml-7 flex flex-col gap-2">
          {esSeccion ? (
            <Selector etiqueta={`Qué entra de «${fila.nombre}»`} id={`${base}-modo`} value={modo} onChange={(e) => cambioElModo(e.target.value)} disabled={!puedeEditar || pendiente} className="min-w-0 max-w-full">
              <option value="">Elegí…</option>
              <option value="TODA">Toda la sección</option>
              <option value="SOLO_ESTOS">Solo estos platos</option>
            </Selector>
          ) : (
            <p className="text-xs text-tinta-tenue">Solo estos platos (los que no están en la carta se tildan de a uno).</p>
          )}

          {modo !== "" && (
            <div className="flex flex-wrap items-end gap-2">
              {exacta ? (
                <label className="flex flex-col gap-1">
                  Cantidad
                  <CampoNumero tipo="entero" etiqueta="La cantidad exacta" value={maximo} onChange={setMaximo} className="w-full sm:w-20" />
                </label>
              ) : (
                <>
                  <label className="flex flex-col gap-1">
                    mín.
                    <CampoNumero tipo="entero" etiqueta="El mínimo" value={minimo} onChange={setMinimo} className="w-full sm:w-20" />
                  </label>
                  <label className="flex flex-col gap-1">
                    máx.
                    <CampoNumero tipo="entero" etiqueta="El máximo" value={maximo} onChange={setMaximo} className="w-full sm:w-20" />
                  </label>
                </>
              )}
            </div>
          )}

          {modo === "SOLO_ESTOS" && (
            <div className="flex flex-col gap-2" data-solo-estos-platos>
              {fila.entradas.length > 0 && (
                <fieldset className="flex flex-col divide-y rounded border px-3">
                  <legend className="px-1 text-sm font-medium">Lo que ya lleva</legend>
                  {fila.entradas.map((e) => (
                    <div key={e.id} className="py-1" data-entrada-de-lugar={e.nombre}>
                      <Casilla
                        etiqueta={e.nombre}
                        checked={mantenidas.has(e.id)}
                        disabled={!puedeEditar || pendiente}
                        onChange={(ev) =>
                          setMantenidas((antes) => {
                            const sig = new Set(antes);
                            if (ev.target.checked) sig.add(e.id);
                            else sig.delete(e.id);
                            return sig;
                          })
                        }
                      />
                    </div>
                  ))}
                </fieldset>
              )}
              {paraTildar.length === 0 ? (
                <p className="text-xs text-tinta-tenue">{fila.origen === "FUERA" ? "No hay más platos de venta que no estén en la carta." : "No hay más platos de venta en esta sección."}</p>
              ) : (
                <fieldset className="flex flex-col divide-y rounded border px-3">
                  <legend className="px-1 text-sm font-medium">Tildá los platos que entran (ninguno entra solo)</legend>
                  {paraTildar.map((p) => {
                    const borrador = nuevos[p.productoId];
                    const c = borrador ? comandoDeLaFila({ fila: { lugar: fila.lugar, entradas: [] }, modo: "SOLO_ESTOS", cantidadMinima: "0", cantidadMaxima: "1", mantenidas: new Set(), nuevos: [{ producto: p, borrador }] }) : null;
                    return (
                      <div key={p.productoId} className="py-1" data-producto-de-origen={p.nombre}>
                        <Casilla etiqueta={p.nombreParaMostrar} checked={!!borrador} disabled={!puedeEditar || pendiente} onChange={(e) => (e.target.checked ? tildar(p) : destildar(p.productoId))} />
                        {borrador && <ConfiguracionDelProducto producto={p} borrador={borrador} alCambiar={(cambio) => cambiarBorrador(p.productoId, cambio)} motivo={c && !c.ok ? c.motivo : null} />}
                      </div>
                    );
                  })}
                </fieldset>
              )}
            </div>
          )}
        </div>
      )}
      {puedeEditar && (
        <div className="ml-7 flex flex-col gap-2">
          {falta !== null && <p className="text-xs text-tinta-tenue">{falta}</p>}
          {falta === null && !armado.ok && entra && <p className="text-xs text-tinta-tenue">{armado.motivo}</p>}
          <div>
            <Boton tamano="tactil" disabled={sinCambios || falta !== null || !armado.ok || pendiente} cargando={pendiente} onClick={guardarLaParte}>
              {entra ? `Guardar «${fila.nombre}»` : `Sacar «${fila.nombre}» de la promo`}
            </Boton>
          </div>
        </div>
      )}
      {resultado && (
        <Aviso variante={resultado.ok ? "exito" : "error"} forma="en-linea">
          {resultado.mensaje}
        </Aviso>
      )}
    </div>
  );
}
