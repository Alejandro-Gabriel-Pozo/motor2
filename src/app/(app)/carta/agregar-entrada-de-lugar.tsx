"use client";

import { useId, useRef, useState, useTransition } from "react";
import {
  ORIGEN_FUERA_DE_LA_CARTA,
  borradorInicial,
  categoriasDe,
  comandoDeProducto,
  origenInferido,
  productosDelOrigen,
  tieneOpciones,
  type BorradorDeProducto,
  type ProductoParaEntrada,
} from "@/core/carta/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Casilla } from "@/ui/primitivas/casilla";
import { OpcionesExcluyentes } from "@/ui/primitivas/opciones-excluyentes";
import { Selector } from "@/ui/primitivas/selector";

/**
 * Armar el LUGAR de una promo (GO-3b U1 y etapa N1 «promo a elegir», PR B; docs/diseno-promo-subconjunto-2026-11-04.md §11 nivel 8): el lugar LISTA elige su ORIGEN (una sección de la carta o «no está en la
 * carta»), la pantalla muestra los productos de venta de ese origen para TILDAR (con el atajo «tildar todos los de la categoría» y el aviso de los que no están en la lista) y de cada producto tildado se
 * define su configuración FIJA («Café · Mediano · Almendras») o «el mozo elige» (casillas de opciones permitidas por grupo; los límites del grupo, en solo lectura; los adicionales, bloqueados).
 *
 * El origen es solo la fuente para tildar: no se guarda ni es una regla viva (la lista queda como se tildó). Cambiar el origen de un lugar que ya tiene opciones SACA esas opciones de la lista (baja
 * lógica, se pueden volver a ofrecer), después de un aviso y de confirmarlo. Los productos que ya están en la lista se ven tildados y no se vuelven a tildar (para cambiarlos, se sacan y se vuelven a sumar).
 * Lo valida el servidor (que el producto pueda ser componente: con receta y precio; la configuración, como la venta) y responde con el motivo si no. Un doble toque no manda dos veces: se suma de a un
 * producto, en orden, y se frena en el primer rechazo (lo ya sumado queda; repetir lo ya hecho no escribe nada).
 */
export function AgregarEntradaDeLugar({
  lugar,
  secciones,
  productos,
  entradasActivas,
  agregar,
  sacar,
}: {
  lugar: string;
  secciones: { id: string; nombre: string }[];
  productos: ProductoParaEntrada[];
  /** Las opciones que hoy tiene la lista del lugar (activas): su producto y su id (para sacarlas al cambiar el origen). */
  entradasActivas: { id: string; productoId: string }[];
  agregar: (productoId: string, modoDeOpciones: "FIJAS" | "A_ELEGIR", opciones: { opcionId: string; cantidad: number }[]) => Promise<ResultadoAccion>;
  sacar: (entradaId: string) => Promise<ResultadoAccion>;
}) {
  const base = useId();
  const [origen, setOrigen] = useState(() => origenInferido(entradasActivas.map((e) => e.productoId), productos));
  const [origenPendiente, setOrigenPendiente] = useState<string | null>(null);
  const [tildados, setTildados] = useState<Record<string, BorradorDeProducto>>({});
  const [resultados, setResultados] = useState<{ clave: string; ok: boolean; mensaje: string }[]>([]);
  const [pendiente, startTransition] = useTransition();
  const enviando = useRef(false);

  const enLaLista = new Set(entradasActivas.map((e) => e.productoId));
  const delOrigen = productosDelOrigen(productos, origen);
  const sinTildar = delOrigen.filter((p) => !enLaLista.has(p.productoId) && !tildados[p.productoId]);
  const nombreDelOrigen = (o: string) => (o === ORIGEN_FUERA_DE_LA_CARTA ? "los productos que no están en la carta" : `la sección «${secciones.find((s) => s.id === o)?.nombre ?? "?"}»`);
  const porProducto = delOrigen.flatMap((p) => (tildados[p.productoId] ? [{ p, b: tildados[p.productoId]!, comando: comandoDeProducto(p, tildados[p.productoId]!) }] : []));
  const incompletos = porProducto.filter((x) => !x.comando.ok);

  const tildar = (p: ProductoParaEntrada) => setTildados((antes) => ({ ...antes, [p.productoId]: antes[p.productoId] ?? borradorInicial(p) }));
  const destildar = (id: string) =>
    setTildados((antes) => {
      const resto = { ...antes };
      delete resto[id];
      return resto;
    });
  const cambiarBorrador = (id: string, cambio: (b: BorradorDeProducto) => BorradorDeProducto) => setTildados((antes) => (antes[id] ? { ...antes, [id]: cambio(antes[id]!) } : antes));

  const elegirOrigen = (nuevo: string) => {
    if (nuevo === origen) return;
    setResultados([]);
    // Con opciones ya en la lista, cambiar el origen las saca: se avisa y se espera la confirmación.
    if (entradasActivas.length > 0) {
      setOrigenPendiente(nuevo);
      return;
    }
    setTildados({});
    setOrigen(nuevo);
  };

  const confirmarCambioDeOrigen = () => {
    if (origenPendiente === null || enviando.current) return;
    enviando.current = true;
    const nuevo = origenPendiente;
    startTransition(async () => {
      try {
        const salida: { clave: string; ok: boolean; mensaje: string }[] = [];
        for (const e of entradasActivas) {
          const r = await sacar(e.id);
          if (!r.ok) {
            salida.push({ clave: e.id, ok: false, mensaje: r.mensaje });
            setResultados(salida);
            return;
          }
        }
        setTildados({});
        setOrigen(nuevo);
        setOrigenPendiente(null);
        setResultados([]);
      } finally {
        enviando.current = false;
      }
    });
  };

  const tildarCategoria = (categoriaId: string) => {
    const nuevos = delOrigen.filter((p) => p.categoria?.id === categoriaId && !enLaLista.has(p.productoId));
    setTildados((antes) => {
      const siguiente = { ...antes };
      for (const p of nuevos) siguiente[p.productoId] = siguiente[p.productoId] ?? borradorInicial(p);
      return siguiente;
    });
  };

  const sumar = () => {
    if (porProducto.length === 0 || incompletos.length > 0 || enviando.current) return;
    enviando.current = true;
    startTransition(async () => {
      try {
        const salida: { clave: string; ok: boolean; mensaje: string }[] = [];
        for (const { p, comando } of porProducto) {
          if (!comando.ok) continue;
          const r = await agregar(p.productoId, comando.modoDeOpciones, comando.opciones);
          salida.push({ clave: p.productoId, ok: r.ok, mensaje: r.mensaje });
          if (!r.ok) break;
          destildar(p.productoId);
        }
        setResultados(salida);
      } finally {
        enviando.current = false;
      }
    });
  };

  const categorias = categoriasDe(delOrigen.filter((p) => !enLaLista.has(p.productoId)));

  return (
    <div className="mt-1 flex flex-col gap-3 text-sm" data-agregar-entrada={lugar}>
      <Selector etiqueta={`De dónde salen los productos de «${lugar}»`} id={`${base}-origen`} value={origen} onChange={(e) => elegirOrigen(e.target.value)} className="min-w-0 max-w-full">
        <option value="">Elegí el origen…</option>
        {secciones.map((s) => (
          <option key={s.id} value={s.id}>
            Sección «{s.nombre}»
          </option>
        ))}
        <option value={ORIGEN_FUERA_DE_LA_CARTA}>No está en la carta</option>
      </Selector>

      {origenPendiente !== null && (
        <Aviso variante="advertencia">
          <p>
            Cambiar el origen saca de «{lugar}» las {entradasActivas.length} opción{entradasActivas.length === 1 ? "" : "es"} que ya tiene (después las podés volver a ofrecer). El origen es solo de dónde se tildan los productos.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Boton tamano="tactil" variante="peligro" disabled={pendiente} onClick={confirmarCambioDeOrigen}>
              Cambiar y sacar las {entradasActivas.length} opciones
            </Boton>
            <Boton tamano="tactil" variante="secundario" disabled={pendiente} onClick={() => setOrigenPendiente(null)}>
              Dejar el origen como está
            </Boton>
          </div>
        </Aviso>
      )}

      {origen === "" && origenPendiente === null && <p className="text-xs text-tinta-tenue">Elegí de dónde salen los productos para ver cuáles se pueden tildar.</p>}

      {origen !== "" && delOrigen.length === 0 && <p className="text-xs text-tinta-tenue">No hay productos de venta en {nombreDelOrigen(origen)}.</p>}

      {origen !== "" && delOrigen.length > 0 && (
        <>
          {categorias.length > 0 && (
            <Selector
              etiqueta="Tildar todos los de una categoría"
              id={`${base}-categoria`}
              value=""
              onChange={(e) => {
                if (e.target.value) tildarCategoria(e.target.value);
              }}
              className="min-w-0 max-w-full"
            >
              <option value="">Elegí una categoría…</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} ({c.cantidad})
                </option>
              ))}
            </Selector>
          )}

          <fieldset className="flex flex-col divide-y rounded border px-3">
            <legend className="px-1 text-sm font-medium">Productos de {nombreDelOrigen(origen)}</legend>
            {delOrigen.map((p) => {
              const yaEsta = enLaLista.has(p.productoId);
              const borrador = tildados[p.productoId];
              return (
                <div key={p.productoId} className="py-1" data-producto-de-origen={p.nombre}>
                  <Casilla
                    etiqueta={p.nombre}
                    ayuda={yaEsta ? "Ya está en la lista." : undefined}
                    checked={yaEsta || !!borrador}
                    disabled={yaEsta || pendiente}
                    onChange={(e) => (e.target.checked ? tildar(p) : destildar(p.productoId))}
                  />
                  {borrador && !yaEsta && (
                    <ConfiguracionDelProducto
                      producto={p}
                      borrador={borrador}
                      alCambiar={(cambio) => cambiarBorrador(p.productoId, cambio)}
                      motivo={(() => {
                        const c = comandoDeProducto(p, borrador);
                        return c.ok ? null : c.motivo;
                      })()}
                    />
                  )}
                </div>
              );
            })}
          </fieldset>

          {sinTildar.length > 0 && (
            <Aviso variante="informacion" forma="en-linea">
              {sinTildar.length === 1 ? "Hay 1 producto" : `Hay ${sinTildar.length} productos`} de {nombreDelOrigen(origen)} que no {sinTildar.length === 1 ? "está" : "están"} en la lista de «{lugar}»: ninguno entra solo, hay que tildarlo.
            </Aviso>
          )}

          <div>
            <Boton tamano="tactil" disabled={porProducto.length === 0 || incompletos.length > 0 || pendiente} cargando={pendiente} onClick={sumar}>
              {porProducto.length > 1 ? `Sumar ${porProducto.length} productos` : "Sumar"}
            </Boton>
          </div>
        </>
      )}

      {resultados.map((r) => (
        <Aviso key={r.clave} variante={r.ok ? "exito" : "error"} forma="en-linea">
          {r.mensaje}
        </Aviso>
      ))}
    </div>
  );
}

/** Lo que se define de UN producto tildado: configuración fija o «el mozo elige». */
function ConfiguracionDelProducto({
  producto,
  borrador,
  alCambiar,
  motivo,
}: {
  producto: ProductoParaEntrada;
  borrador: BorradorDeProducto;
  alCambiar: (cambio: (b: BorradorDeProducto) => BorradorDeProducto) => void;
  motivo: string | null;
}) {
  const base = useId();
  if (!tieneOpciones(producto)) return null;
  return (
    <div className="mb-2 ml-7 flex flex-col gap-2 rounded bg-superficie-suave p-2" data-configuracion-de={producto.nombre}>
      <OpcionesExcluyentes
        leyenda={`Qué pasa con las opciones de «${producto.nombre}»`}
        nombre={`${base}-modo`}
        presentacion="fila"
        valorInicial={borrador.modo}
        alCambiar={(v) => alCambiar((b) => ({ ...b, modo: v === "A_ELEGIR" ? "A_ELEGIR" : "FIJAS" }))}
        opciones={[
          { valor: "FIJAS", etiqueta: "Vienen fijas" },
          { valor: "A_ELEGIR", etiqueta: "El mozo elige" },
        ]}
      />
      {borrador.modo === "FIJAS" ? (
        <div className="flex flex-wrap items-end gap-2">
          {producto.grupos.length === 0 && <p className="text-xs text-tinta-tenue">Este producto no tiene grupos de una sola elección para fijar.</p>}
          {producto.grupos.map((g) => (
            <div key={g.grupoId} className="flex min-w-0 max-w-full flex-col">
              <Selector
                etiqueta={`${g.nombre}${g.obligatorio ? "" : " (opcional)"}`}
                value={borrador.fijas[g.grupoId] ?? ""}
                onChange={(e) => alCambiar((b) => ({ ...b, fijas: { ...b.fijas, [g.grupoId]: e.target.value } }))}
                className="min-w-0 max-w-full"
              >
                <option value="">{g.obligatorio ? "Elegí…" : "Sin elegir"}</option>
                {g.opciones.map((o) => (
                  <option key={o.opcionId} value={o.opcionId}>
                    {o.nombre}
                  </option>
                ))}
              </Selector>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-tinta-tenue">El precio de la promo es fijo, elija lo que elija el mozo. Cuántas elige de cada grupo lo fijan los límites del grupo (no se cambian acá).</p>
          {producto.gruposAElegir.map((g) =>
            g.adicional ? (
              <p key={g.grupoId} className="text-xs text-tinta-tenue">
                «{g.nombre}» es un adicional: no entra en una promo de precio fijo.
              </p>
            ) : (
              <fieldset key={g.grupoId} className="flex flex-col">
                <legend className="text-sm font-medium">{g.nombre}</legend>
                <p className="text-xs text-tinta-tenue">
                  El mozo elige {g.cantidadMinima === g.cantidadMaxima ? g.cantidadMaxima : `de ${g.cantidadMinima} a ${g.cantidadMaxima}`}
                  {g.cantidadMinima > 0 ? " (obligatorio)" : " (opcional)"}.
                </p>
                {g.opciones.map((o) => (
                  <Casilla
                    key={o.opcionId}
                    etiqueta={o.nombre}
                    checked={!!borrador.permitidas[o.opcionId]}
                    onChange={(e) => alCambiar((b) => ({ ...b, permitidas: { ...b.permitidas, [o.opcionId]: e.target.checked } }))}
                  />
                ))}
              </fieldset>
            ),
          )}
        </div>
      )}
      {motivo && <p className="text-xs text-tinta-tenue">{motivo}</p>}
    </div>
  );
}
