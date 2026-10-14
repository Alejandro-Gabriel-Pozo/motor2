"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useReducer, useState } from "react";
import { SelectorProducto } from "@/components/selector-producto";
import { agregarItems } from "@/server/actions/pos/cuenta-pedido";
import { pediblesDeEntrada, type EntradaPromoSelectorCarta, type ProductoPedible, type SelectorCartaPos, estadoInicialSelectorCarta, reducirSelectorCarta, estadoInicialListaPorAgregar, itemsDeListaPorAgregar, listaPorAgregarLlena, puedeConfirmarListaPorAgregar, reducirListaPorAgregar, type EleccionParaAgregar, MAXIMO_ITEMS_POR_AGREGADO, formatearCantidad, formatearMonto, avisoEnPromo, claveDeConfiguracion, resumenDeConfiguracion, vistaPreviaDeConfiguracion, type ConfiguracionDelSelector } from "@/core/pos/public";
import { BOTON_CHICO, BOTON_PRIMARIO, CAMPO } from "./estilos";
import { SelectorCarta } from "./selector-carta";
import { ArmarPromo } from "./armar-promo";
import { ElegirOpciones } from "./elegir-opciones";
import { useAccionMesa } from "./usar-accion";
import { useRegistrarOtroIgual } from "./otro-igual";

/** Una promo ya armada, esperando en «Por agregar» junto con los sueltos (Task #16) — cada instancia es una línea propia, sin
 *  acumularse (dos menús pueden llevar elecciones distintas): `id` interno del cliente, nunca viaja al servidor. */
interface PromoPorAgregar {
  id: string;
  promoCartaId: string;
  titulo: string;
  precio: number;
  elecciones: EleccionParaAgregar[];
}

/**
 * Suma productos a una lista «Por agregar» DEL CLIENTE (nunca guardada hasta confirmar, docs/plan-pos-agregar-varios-2026-09-26.md)
 * y los manda TODOS JUNTOS a la cuenta en un solo `agregarItems(cuentaId, líneas)` — quedan en «Sin enviar» hasta «Enviar a
 * cocina», como siempre; ese botón sigue sacando un solo KOT sin cambios ahí. Antes, cada «Agregar» era un viaje al servidor por
 * producto: elegir varias cosas para la misma mesa obligaba a esperar y re-elegir cantidad una por una antes de poder mandar algo
 * a cocina.
 *
 * Tocar un producto —en la grilla de carta (`SelectorCarta`) o elegirlo en el buscador (`SelectorProducto`)— lo suma con cantidad
 * 1; tocarlo de nuevo (o volver a elegirlo) ACUMULA en la MISMA línea, nunca abre una segunda. La cantidad de cada línea se edita
 * con los botones −/+ o tecleando (parser `interpretarNumero`, nunca `Number(...)` a secas); al salir del campo se normaliza con
 * `validarCantidadPedido` — la MISMA función que usará el servidor al confirmar — así lo que se ve es lo que se va a guardar (una
 * cantidad que redondea, ej. "1,4" en una unidad entera, queda mostrada en "1", nunca oculta).
 *
 * Venta fraccionada (Task #25, docs/plan-venta-fraccionada-2026-09-26.md): si el producto elegido tiene `pasoVenta` (ej. "se vende
 * de a 0,5"), la ayuda bajo la línea lo dice, y `normalizarCantidad` valida contra el paso en vez de redondear — una cantidad que
 * no sea múltiplo exacto se RECHAZA (mensaje a la vista), nunca se redondea en silencio.
 *
 * Todo o nada: si al confirmar algún producto dejó de estar disponible justo en ese instante, el servidor no guarda nada (misma
 * transacción serializable de `agregarItems`) y la lista del cliente queda INTACTA (no se vacía) con el error a la vista — no hay
 * que volver a elegir todo de nuevo.
 *
 * Dos reductores puros, independientes (`selector-carta-estado.ts` para qué sección/agrupado/carpeta está a la vista;
 * `agregar-lista-estado.ts` para qué hay en la lista): coexisten, uno no reemplaza al otro. Sin `pos_tomar_pedido` todo el
 * formulario queda deshabilitado (un solo `<fieldset>`).
 *
 * Promos armables (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 11): tocar una en `SelectorCarta` abre `ArmarPromo`
 * (otro diálogo, otro reductor puro); confirmarla la agrega a `promosPorAgregar` (estado LOCAL de este componente, sin
 * reductor propio — cada instancia es una línea aparte, sin acumularse, así que alcanza con un array simple). Al confirmar
 * TODO junto se manda en una sola llamada, `agregarItems(cuentaId, items, promos)` — el tercer parámetro es opcional, así
 * que sin ninguna promo armada el llamado es idéntico al de siempre.
 *
 * Clave de idempotencia (P3 del Paquete 1, I3): cada envío lleva un UUID (`useState(() => crypto.randomUUID())`, como el resto de los formularios) que el servidor usa para no agregar dos veces el MISMO pedido si
 * la respuesta se pierde (corte de red) o se toca dos veces. La clave es de UN contenido: se reutiliza mientras el pedido no cambia (reintento) y se RENUEVA al tener éxito y en cuanto cambia el contenido de
 * «Por agregar» (otro pedido, otra intención: con la misma clave el servidor respondería conflicto). Ante un error de RED no se sabe si el servidor llegó a agregarlo: se refresca la cuenta (para que «Sin enviar»
 * muestre la verdad) y se avisa; volver a tocar «Agregar» con el mismo contenido es seguro (no duplica). No protege dos pestañas con dos pedidos distintos: son dos claves, o sea dos intenciones.
 */
export function AgregarItems({
  cuentaId,
  puede,
  selectorCarta,
  configuraciones = {},
  puedeAgotar = false,
}: {
  cuentaId: string;
  puede: boolean;
  selectorCarta: SelectorCartaPos | null;
  /** GO-2d (opcional): los productos que admiten opciones, por id (`cargarOpcionesDelSelector`). Tocarlos abre «Elegir opciones»; sin esto, todo se suma con un toque como siempre. */
  configuraciones?: Readonly<Record<string, ConfiguracionDelSelector>>;
  /** GO-2d: si el rol puede marcar opciones agotadas (el diálogo muestra el enlace). */
  puedeAgotar?: boolean;
}) {
  const { ejecutar, pending, error } = useAccionMesa();
  const router = useRouter();
  // P3 (I3): la clave del envío y la firma del contenido con el que se usó por última vez (`null` = todavía no se usó).
  const [envio, setEnvio] = useState<{ firma: string | null; clave: string }>(() => ({ firma: null, clave: crypto.randomUUID() }));
  const [estado, despachar] = useReducer(reducirSelectorCarta, selectorCarta, estadoInicialSelectorCarta);
  const [lista, despacharLista] = useReducer(reducirListaPorAgregar, estadoInicialListaPorAgregar());
  // Task #16 (docs/plan-promo-combo-2026-09-26.md, paso 11): promos ya armadas, esperando junto con los sueltos — `promoAbierta`
  // es la que está siendo armada AHORA en el diálogo (null = cerrado).
  const [promosPorAgregar, setPromosPorAgregar] = useState<PromoPorAgregar[]>([]);
  const [promoAbierta, setPromoAbierta] = useState<EntradaPromoSelectorCarta | null>(null);
  // GO-2d: el producto con opciones que se está eligiendo AHORA en «Elegir opciones» (null = cerrado), con la elección de arranque de «Otro igual».
  const [opcionesAbiertas, setOpcionesAbiertas] = useState<{ productoId: string; inicial?: { opcionId: string; cantidad: number }[] } | null>(null);
  const hayCarta = !!selectorCarta && selectorCarta.seccionesCarta.length > 0;

  // Para mostrar nombre/precio/decimales de cada línea: cualquier pedible, lo haya sumado la carta o el buscador — la carta
  // pública no lo tiene todo (DP1/DP2: «Fuera de carta»), así que se busca en el selector completo, no en `selectorCarta.seccionesCarta` solo.
  const pediblePorId = useMemo(() => {
    const todos: ProductoPedible[] = [
      ...(selectorCarta?.seccionesCarta ?? []).flatMap((s) => s.entradas.flatMap(pediblesDeEntrada)),
      ...(selectorCarta?.fueraDeCarta ?? []),
    ];
    return new Map(todos.map((p) => [p.productoId, p]));
  }, [selectorCarta]);

  const llena = listaPorAgregarLlena(lista, MAXIMO_ITEMS_POR_AGREGADO);
  // Con al menos una promo armada, siempre se puede confirmar (aunque la lista de sueltos esté vacía) — mismo criterio que
  // "elegí al menos un producto" del servidor, que también acepta solo promos.
  const puedeConfirmar = puedeConfirmarListaPorAgregar(lista) || promosPorAgregar.length > 0;

  /**
   * Tocar un producto —desde la carta o el buscador—: lo suma a la lista y limpia el buscador / cierra el agrupado suelto (G3). GO-2d: un producto que admite opciones abre
   * «Elegir opciones» en vez de sumarse directo (uno sin opciones se sigue sumando con un toque).
   */
  const sumar = (productoId: string) => {
    if (configuraciones[productoId]) setOpcionesAbiertas({ productoId });
    else despacharLista({ tipo: "sumarProducto", productoId, tope: MAXIMO_ITEMS_POR_AGREGADO });
    despachar({ tipo: "productoSumado" });
  };

  /** GO-2d: lo elegido en el diálogo va a «Por agregar» como su propia línea (la misma configuración se acumula). */
  const confirmarOpciones = (elegidas: { opcionId: string; cantidad: number; versionDeOpcionId: string }[], cantidad: number) => {
    if (!opcionesAbiertas) return;
    const { productoId } = opcionesAbiertas;
    despacharLista({ tipo: "sumarConfiguracion", productoId, clave: claveDeConfiguracion(productoId, elegidas), opciones: elegidas, cantidad, tope: MAXIMO_ITEMS_POR_AGREGADO });
    setOpcionesAbiertas(null);
  };
  // GO-2d: «Otro igual» desde una línea de la cuenta abre este mismo diálogo con esa elección (si el producto hoy se puede pedir con opciones desde el selector).
  const registrarOtroIgual = useRegistrarOtroIgual();
  useEffect(() => {
    registrarOtroIgual((p) => {
      if (!puede || !configuraciones[p.productoId]?.vendible || !pediblePorId.has(p.productoId)) return false;
      setOpcionesAbiertas({ productoId: p.productoId, inicial: p.elegidas });
      return true;
    });
    return () => registrarOtroIgual(null);
  }, [registrarOtroIgual, puede, configuraciones, pediblePorId]);
  // GO-2d: los productos que en una promo no se pueden armar (tienen un grupo obligatorio), con el aviso para `ArmarPromo`.
  const noSeArmanEnPromo = useMemo(
    () => new Map(Object.entries(configuraciones).flatMap(([id, c]) => { const aviso = avisoEnPromo(c.grupos); return aviso ? [[id, aviso] as const] : []; })),
    [configuraciones]
  );
  const productoAbierto = opcionesAbiertas ? pediblePorId.get(opcionesAbiertas.productoId) : undefined;
  const configuracionAbierta = opcionesAbiertas ? configuraciones[opcionesAbiertas.productoId] : undefined;

  const confirmarPromo = (elecciones: EleccionParaAgregar[]) => {
    if (!promoAbierta) return;
    setPromosPorAgregar((antes) => [...antes, { id: `${promoAbierta.promoCartaId}-${antes.length}-${Date.now()}`, promoCartaId: promoAbierta.promoCartaId, titulo: promoAbierta.titulo, precio: promoAbierta.precio, elecciones }]);
    setPromoAbierta(null);
  };

  /**
   * GO-3b (ADR-032): el precio de LISTA que el mozo está viendo de cada ítem (el de la vista previa con su configuración y su combinación, o el del pedible), para que el servidor no cobre otro en
   * silencio si cambió entre medio (`PRECIO_CAMBIO`). Uno que no se puede calcular acá no se manda (el servidor cobra el de hoy, como siempre).
   */
  const precioQueSeVe = (item: ReturnType<typeof itemsDeListaPorAgregar>[number]): number | null => {
    const conf = configuraciones[item.productoId];
    if (item.opciones && conf) {
      const vista = vistaPreviaDeConfiguracion({ grupos: conf.grupos, elegidas: item.opciones, precioBase: conf.precioBase, descuentoDeProducto: conf.descuentoDeProducto, cantidad: 1, ...(conf.combinaciones ? { combinaciones: conf.combinaciones } : {}) });
      return vista.ok ? (vista.precioLista ?? vista.precioUnitario) : null;
    }
    const p = pediblePorId.get(item.productoId);
    return item.opciones || !p ? null : (p.precioLista ?? p.precio);
  };

  const confirmar = () => {
    const items = itemsDeListaPorAgregar(lista).map((i) => {
      const visto = precioQueSeVe(i);
      return visto === null ? i : { ...i, precioDeListaEsperado: visto };
    });
    // GO-3b: el precio de la promo que se vio (si cambió, el servidor responde PROMO_CAMBIO y no cobra otro).
    const promos = promosPorAgregar.map((p) => ({ promoCartaId: p.promoCartaId, elecciones: p.elecciones, precioEsperado: p.precio }));
    // Misma clave solo para el MISMO contenido (el reintento); si cambió algo de «Por agregar», es otro pedido y lleva clave nueva.
    const firma = JSON.stringify([items, promos]);
    const clave = envio.firma === null || envio.firma === firma ? envio.clave : crypto.randomUUID();
    setEnvio({ firma, clave });
    ejecutar(
      async () => {
        try {
          return await agregarItems(cuentaId, items, promos, clave);
        } catch {
          // Error de red: no se sabe si el servidor lo agregó. Se refresca la cuenta y la lista queda intacta con la misma clave: reintentar es seguro.
          router.refresh();
          return { ok: false as const, mensaje: "Se cortó la conexión y no sabemos si el pedido se agregó. Revisá «Sin enviar» (ya se actualizó); si falta, volvé a tocar «Agregar»: si ya estaba, no se duplica." };
        }
      },
      () => {
        despacharLista({ tipo: "vaciar" });
        setPromosPorAgregar([]);
        setEnvio({ firma: null, clave: crypto.randomUUID() });
      }
    );
  };

  /**
   * GO-2d: una línea de «Por agregar» de un producto CON opciones: «Café · Mediano · Con leche» y, debajo y con sangría, sus adicionales «+ Huevo frito ×1» (por unidad). El precio
   * es la vista previa de la configuración (la misma regla que la venta). «Otro igual» abre el diálogo con esta elección para pedir otra parecida; el «+» suma una igual.
   */
  const lineaConOpciones = (clave: string, opciones: { opcionId: string; cantidad: number; versionDeOpcionId: string }[], cantidad: number, cantidadTexto: string, error: string | null, p: ProductoPedible, conf: ConfiguracionDelSelector) => {
    const { titulo, adicionales } = resumenDeConfiguracion(p.nombre, conf.grupos, opciones);
    const vista = vistaPreviaDeConfiguracion({ grupos: conf.grupos, elegidas: opciones, precioBase: conf.precioBase, descuentoDeProducto: conf.descuentoDeProducto, cantidad, ...(conf.combinaciones ? { combinaciones: conf.combinaciones } : {}) });
    const idError = `error-linea-${clave}`;
    return (
      <li key={clave} data-linea-por-agregar={titulo} className="flex flex-col gap-1 bg-white py-2 first:rounded-t-lg last:rounded-b-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 px-2">
          <span className="min-w-0 flex-1 text-[14px] font-semibold [overflow-wrap:anywhere]">{titulo}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className={BOTON_CHICO} aria-label={`Restar uno a ${titulo}`} onClick={() => despacharLista({ tipo: "decrementar", productoId: p.productoId, clave })}>
              −
            </button>
            <input
              aria-label={`Cantidad de ${titulo}`}
              inputMode="numeric"
              autoComplete="off"
              value={cantidadTexto}
              onChange={(e) => despacharLista({ tipo: "cambiarCantidadTexto", productoId: p.productoId, clave, texto: e.target.value })}
              onFocus={(e) => e.target.select()}
              onBlur={() => despacharLista({ tipo: "normalizarCantidad", productoId: p.productoId, clave, decimales: 0 })}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? idError : undefined}
              className={`${CAMPO} w-16 text-center tabular-nums max-md:min-h-11`}
            />
            <button type="button" className={BOTON_CHICO} aria-label={`Sumar uno a ${titulo}`} onClick={() => despacharLista({ tipo: "incrementar", productoId: p.productoId, clave })}>
              +
            </button>
            <span className="w-24 text-right text-[13.5px] tabular-nums">{vista.ok ? formatearMonto(vista.total) : "—"}</span>
            <button type="button" className={BOTON_CHICO} aria-label={`Otro igual a ${titulo}, para cambiarle algo`} onClick={() => setOpcionesAbiertas({ productoId: p.productoId, inicial: opciones })}>
              Otro igual
            </button>
            <button type="button" className={BOTON_CHICO} aria-label={`Quitar ${titulo} de la lista`} onClick={() => despacharLista({ tipo: "quitarLinea", productoId: p.productoId, clave })}>
              Quitar
            </button>
          </div>
        </div>
        {adicionales.map((a) => (
          <p key={a} className="pl-6 pr-2 text-[12.5px] text-[var(--ink-soft)]">
            {a}
          </p>
        ))}
        {(error || !vista.ok) && (
          <p id={idError} role="alert" className="px-2 text-[12.5px] text-red-700">
            {error ?? (vista.ok ? "" : `${vista.mensaje} Quitala y volvé a elegir.`)}
          </p>
        )}
      </li>
    );
  };

  return (
    // Sin `action` ni `onSubmit` real: Enter en cualquier campo (el buscador, la cantidad de una línea) NO tiene que confirmar
    // nada (precedente: test/e2e/form-con-resultado-enter.spec.ts) — y, sin este `onSubmit` que lo frena, el navegador haría un
    // submit NATIVO (recarga de la página, GET a la URL actual) que además borraría la lista «Por agregar» del cliente. El botón
    // de confirmar es `type="button"` con su propio `onClick` (`confirmar`), nunca el submit del formulario.
    <form aria-label="Agregar producto" onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
      {/* min-w-0: un `<fieldset>` trae `min-width: min-content` por defecto y, sin esto, la fila más ancha de «Por agregar» ensanchaba la página entera en el celular (437 px sobre 375). */}
      <fieldset disabled={!puede} title={puede ? undefined : "Tu rol puede ver la mesa pero no tomar pedidos."} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="agregar-producto" className="text-[12.5px] font-semibold">
              Producto
            </label>
            <SelectorProducto
              id="agregar-producto"
              value=""
              onChange={(id) => {
                if (id) sumar(id);
              }}
              filtro={{ tipo: "PV", soloDisponibles: true }}
              placeholder="Buscar por nombre o código…"
              limpiarSenal={estado.limpiarBuscador}
              siempreClaro
            />
          </div>
        </div>
        {hayCarta && <SelectorCarta selector={selectorCarta} estado={estado} lista={lista} despachar={despachar} sumar={sumar} abrirPromo={setPromoAbierta} configuraciones={configuraciones} />}
        {llena && <p className="text-[13px] text-[var(--ink-soft)]">Llegaste al máximo de {MAXIMO_ITEMS_POR_AGREGADO} productos distintos: sacá alguno de la lista antes de sumar otro.</p>}

        <div className="flex flex-col gap-2 rounded-[14px] border border-[var(--border)] bg-[#F1EFEA] p-3">
          <h2 className="text-[14px] font-bold">Por agregar · {lista.lineas.length + promosPorAgregar.length}</h2>
          {promosPorAgregar.length > 0 && (
            <ul className="flex flex-col divide-y divide-[var(--border)]">
              {promosPorAgregar.map((p) => (
                <li key={p.id} data-promo-por-agregar={p.titulo} className="flex items-center justify-between gap-2 bg-[#FFF7E6] px-2 py-2 first:rounded-t-lg">
                  <span className="min-w-0 flex-1 text-[14px] font-semibold [overflow-wrap:anywhere]">{p.titulo}</span>
                  <span className="text-[13.5px] tabular-nums">{formatearMonto(p.precio)}</span>
                  <button
                    type="button"
                    className={BOTON_CHICO}
                    aria-label={`Quitar ${p.titulo} de la lista`}
                    onClick={() => setPromosPorAgregar((antes) => antes.filter((x) => x.id !== p.id))}
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
          {lista.lineas.length === 0 && promosPorAgregar.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-soft)]">Ningún producto elegido todavía: tocá uno de la carta o buscalo por nombre o código.</p>
          ) : lista.lineas.length === 0 ? null : (
            <ul className="flex flex-col divide-y divide-[var(--border)]">
              {lista.lineas.flatMap((l) => {
                const p = pediblePorId.get(l.productoId);
                if (!p) return []; // defensivo: nunca debería faltar (todo pedible sale del mismo selector)
                const conf = l.clave && l.opciones ? configuraciones[l.productoId] : undefined;
                if (l.clave && l.opciones && conf) return [lineaConOpciones(l.clave, l.opciones, l.cantidad, l.cantidadTexto, l.error, p, conf)];
                const idError = `error-linea-${l.productoId}`;
                return [
                  <li key={l.productoId} data-linea-por-agregar={p.nombre} className="flex flex-col gap-1 bg-white py-2 first:rounded-t-lg last:rounded-b-lg">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-2">
                      <span className="min-w-0 flex-1 text-[14px] font-semibold [overflow-wrap:anywhere]">{p.nombre}</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button type="button" className={BOTON_CHICO} aria-label={`Restar uno a ${p.nombre}`} onClick={() => despacharLista({ tipo: "decrementar", productoId: l.productoId })}>
                          −
                        </button>
                        <input
                          aria-label={`Cantidad de ${p.nombre}`}
                          inputMode="decimal"
                          autoComplete="off"
                          value={l.cantidadTexto}
                          onChange={(e) => despacharLista({ tipo: "cambiarCantidadTexto", productoId: l.productoId, texto: e.target.value })}
                          onFocus={(e) => e.target.select()}
                          onBlur={() =>
                            despacharLista({
                              tipo: "normalizarCantidad",
                              productoId: l.productoId,
                              decimales: p.decimales,
                              pasoVenta: p.pasoVenta,
                              tieneStockReal: p.tieneStockReal,
                            })
                          }
                          aria-invalid={l.error ? true : undefined}
                          aria-describedby={l.error ? idError : p.pasoVenta ? `${idError}-ayuda` : undefined}
                          className={`${CAMPO} w-16 text-center tabular-nums max-md:min-h-11`}
                        />
                        <button type="button" className={BOTON_CHICO} aria-label={`Sumar uno a ${p.nombre}`} onClick={() => despacharLista({ tipo: "incrementar", productoId: l.productoId })}>
                          +
                        </button>
                        <span className="w-24 text-right text-[13.5px] tabular-nums">{formatearMonto(l.cantidad * p.precio)}</span>
                        <button
                          type="button"
                          className={BOTON_CHICO}
                          aria-label={`Quitar ${p.nombre} de la lista`}
                          onClick={() => despacharLista({ tipo: "quitarLinea", productoId: l.productoId })}
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                    {l.error ? (
                      <p id={idError} role="alert" className="px-2 text-[12.5px] text-red-700">
                        {l.error}
                      </p>
                    ) : (
                      p.pasoVenta && (
                        <p id={`${idError}-ayuda`} className="px-2 text-[12.5px] text-[var(--ink-soft)]">
                          Se vende de a {formatearCantidad(p.pasoVenta)}.
                        </p>
                      )
                    )}
                  </li>,
                ];
              })}
            </ul>
          )}
          <button type="button" className={BOTON_PRIMARIO} disabled={pending || !puedeConfirmar} onClick={confirmar}>
            {pending ? "Agregando…" : `Agregar ${lista.lineas.length + promosPorAgregar.length} al pedido`}
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-[13px] text-red-700">
          {error}
        </p>
      )}
      {promoAbierta && <ArmarPromo entrada={promoAbierta} onCerrar={() => setPromoAbierta(null)} onConfirmar={confirmarPromo} noSeArman={noSeArmanEnPromo} />}
      {opcionesAbiertas && productoAbierto && configuracionAbierta && (
        <ElegirOpciones
          nombre={productoAbierto.nombre}
          configuracion={configuracionAbierta}
          precargas={configuracionAbierta.masPedidas}
          inicial={opcionesAbiertas.inicial}
          puedeAgotar={puedeAgotar}
          onCerrar={() => setOpcionesAbiertas(null)}
          onConfirmar={confirmarOpciones}
        />
      )}
    </form>
  );
}
