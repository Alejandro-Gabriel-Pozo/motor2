"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { registrarMovimiento, type ItemMovimientoInput } from "@/server/actions/movimientos/movimientos";
import { listarProductosDeProveedor } from "@/server/actions/catalogo/proveedor-por-producto";
import { useLeerServidor } from "@/lib/use-leer-servidor";
import { listarPresentaciones, type PresentacionOpcion } from "@/server/actions/catalogo/productos";
import type { ProcesoUiConfig } from "@/core/movimientos/public";
import { LARGO_MAXIMO_NRO_FACTURA } from "@/core/texto";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoNumero } from "@/components/campo-numero";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { AyudaIcono } from "@/components/ayuda-campo";
import { QuickCrearProducto } from "@/components/catalogo/quick-crear-producto";

interface Opcion {
  id: string;
  nombre: string;
}

interface FilaItem {
  productoId: string;
  /** Precarga desde el proveedor elegido — evita que SelectorProducto arranque vacío para una fila ya resuelta. */
  etiquetaInicial: string;
  cantidad: string;
  loteVencimiento: string;
  precioTotal: string;
  pesoReal: string;
  /** Solo Compra/Devolución a proveedor: Presentacion.unidadCompraId elegida — vacío = usa la unidad de compra por defecto del producto. */
  unidadCompraId: string;
  /** Solo Compra: cómo llama el proveedor a este producto — se guarda en ProveedorPorProducto. */
  referenciaProveedor: string;
  /** Solo referencia visual, no se manda al servidor. */
  ultimaCompraTexto: string;
}

const FILA_VACIA: FilaItem = {
  productoId: "",
  etiquetaInicial: "",
  cantidad: "",
  loteVencimiento: "",
  precioTotal: "",
  pesoReal: "",
  unidadCompraId: "",
  referenciaProveedor: "",
  ultimaCompraTexto: "",
};

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export function PanelMovimientoForm({
  config,
  secciones,
  proveedores,
  unidades,
  motivos,
  destinos,
  productoInicial,
}: {
  config: ProcesoUiConfig;
  secciones: Opcion[];
  proveedores: Opcion[];
  /** Solo se usa (y solo se pasa desde la página) en Compra — alta rápida de producto inline, ver QuickCrearProducto. */
  unidades?: Opcion[];
  /** Solo se usa (y solo se pasa desde la página) en Merma — catálogo MotivoMerma activo (plan "motivos de Consumo/Merma como catálogo administrable", P5). */
  motivos?: Opcion[];
  /** Solo se usa (y solo se pasa desde la página) en Consumo — catálogo DestinoConsumo activo. */
  destinos?: Opcion[];
  /** Deep-link accionable (ej. "Costo incompleto" en Reportes → Costos, "falta precio de este insumo") — precarga la primera fila con este producto en vez de arrancar vacía. */
  productoInicial?: { id: string; etiqueta: string };
}) {
  const router = useRouter();
  const [fecha, setFecha] = useState(hoyISO());
  // TRANSICIONES[proceso].exigeSeccion=false (Compra/Producción/Transferencia/
  // Dev. cliente): dan de alta stock nuevo o el origen ya es obligatorio
  // aparte, no hay ambigüedad de "dónde ya está" que resolver — preseleccionar
  // ahorra un clic. exigeSeccion=true (Consumo/Ajuste/Merma/Dev. consignación/
  // Dev. proveedor): arranca vacío a propósito, nunca se adivina.
  const [seccionId, setSeccionId] = useState(() => (config.exigeSeccion ? "" : (secciones[0]?.id ?? "")));
  const [seccionDestinoId, setSeccionDestinoId] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [nroFactura, setNroFactura] = useState("");
  const [motivoId, setMotivoId] = useState("");
  const [destinoId, setDestinoId] = useState("");
  const [detalleLibre, setDetalleLibre] = useState("");
  const [items, setItems] = useState<FilaItem[]>([
    productoInicial ? { ...FILA_VACIA, productoId: productoInicial.id, etiquetaInicial: productoInicial.etiqueta } : { ...FILA_VACIA },
  ]);
  /** Presentaciones de compra activas del producto de cada fila, por índice — se completa al elegir un producto (ver cambiarProducto). Solo tiene entradas cuando hay alguna presentación alternativa cargada para ese producto (agregarPresentacionAlternativa, en /catalogo/productos). */
  const [presentacionesPorFila, setPresentacionesPorFila] = useState<Record<number, PresentacionOpcion[]>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const leer = useLeerServidor();
  const [pending, startTransition] = useTransition();
  const [cargandoProveedor, setCargandoProveedor] = useState(false);
  const [infoProveedor, setInfoProveedor] = useState("");
  // I3 — un UUID por intento de envío (docs/auditoria-motor2-plan-i3-
  // idempotencia-2026-09-17.md §9.3): se genera al montar el formulario y
  // se reenvía tal cual en cada reintento del MISMO envío (ver `submit`);
  // recién se renueva después de un éxito, cuando el formulario se
  // resetea para cargar OTRO movimiento — ese es un intento nuevo.
  const [claveIdempotencia, setClaveIdempotencia] = useState(() => crypto.randomUUID());
  // Se incrementa cada vez que `items` se reemplaza en bloque (no fila por
  // fila) — entra en la `key` de cada fila para forzar el remount de
  // SelectorProducto, que solo lee `etiquetaInicial` una vez al montar
  // (useState perezoso): sin esto, precargar los productos del proveedor
  // dejaría el buscador vacío a la vista aunque `productoId` ya esté puesto.
  const [versionItems, setVersionItems] = useState(0);
  // Número del último pedido de productos del proveedor. Cuando un pedido termina, si ya se eligió otro proveedor se
  // descarta: sobre todo un FALLO tardío, que ahora vacía las filas y deselecciona el proveedor y, sin esto, borraría
  // la elección nueva. (Next ejecuta las server actions de a una, así que un pedido no adelanta a otro: el fallo del
  // anterior llega cuando el siguiente todavía no respondió.) Ver `elegirProveedor`.
  const pedidoProveedor = useRef(0);

  const precargaPorProveedor = config.proceso === "COMPRA";

  const actualizarFila = (idx: number, cambios: Partial<FilaItem>) => {
    setItems((prev) => prev.map((f, i) => (i === idx ? { ...f, ...cambios } : f)));
  };

  const cambiarProducto = (idx: number, productoId: string) => {
    actualizarFila(idx, { productoId, unidadCompraId: "" });
    setPresentacionesPorFila((prev) => {
      if (!(idx in prev)) return prev;
      const resto = { ...prev };
      delete resto[idx];
      return resto;
    });
    if (!config.esCompraLike || !productoId) return;
    // `leer` nunca rechaza (atrapa el error y corre el callback de abajo) — fire-and-forget explícito, no una promesa sin manejar.
    void leer(
      () => listarPresentaciones(productoId),
      () => {
        setMensaje("No se pudieron cargar las presentaciones de compra de ese producto. Revisá tu conexión; si venís trabajando hace rato, tu sesión pudo haber vencido: recargá la página.");
        setOk(false);
      }
    ).then((todas) => {
      if (!todas) return;
      const activas = todas.filter((p) => p.activa);
      if (activas.length) setPresentacionesPorFila((prev) => ({ ...prev, [idx]: activas }));
    });
  };

  // Alta rápida de producto (QuickCrearProducto, solo Compra): a diferencia
  // de cambiarProducto (el usuario eligió algo que YA existía, vía
  // SelectorProducto, que mantiene su propio texto de búsqueda), acá hace
  // falta también pisar `etiquetaInicial` + `versionItems` — mismo truco de
  // remount que la precarga por proveedor de abajo, porque el producto
  // recién creado nunca pasó por el buscador.
  const productoCreadoEnFila = (idx: number, id: string, etiqueta: string) => {
    setItems((prev) => prev.map((f, i) => (i === idx ? { ...f, productoId: id, etiquetaInicial: etiqueta, unidadCompraId: "" } : f)));
    setVersionItems((n) => n + 1);
  };

  const agregarFila = () => setItems((prev) => [...prev, { ...FILA_VACIA }]);
  const quitarFila = (idx: number) => setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const elegirProveedor = (id: string) => {
    setProveedorId(id);
    if (!precargaPorProveedor) return;

    const pedido = ++pedidoProveedor.current;

    if (!id) {
      setCargandoProveedor(false); // un pedido anterior que quedó en vuelo ya no va a apagar esta bandera (se descarta)
      setItems([{ ...FILA_VACIA }]);
      setPresentacionesPorFila({});
      setVersionItems((n) => n + 1);
      setInfoProveedor("");
      return;
    }

    setCargandoProveedor(true);
    setInfoProveedor("Buscando lo que le comprás a este proveedor...");
    // `leer` maneja el fallo: corre el bloque de abajo (avisar y dejar todo listo para reintentar) y, si el servidor respondió con un
    // error (sesión vencida), refresca la pantalla para que el layout mande al login. Devuelve `undefined` si falló. Nunca rechaza:
    // fire-and-forget explícito, no una promesa sin manejar.
    void leer(
      () => listarProductosDeProveedor(id),
      () => {
        if (pedido !== pedidoProveedor.current) return; // se eligió otro proveedor mientras tanto
        // Si la carga falla (red caída, sesión vencida, error del servidor) `cargandoProveedor` quedaba en `true` para siempre
        // y «+ Agregar producto» / «+ Nuevo producto» seguían deshabilitados hasta recargar la página.
        // Además las filas que había eran de OTRO proveedor: se vacían (igual que cuando la carga sale bien y se reemplazan)
        // y el selector vuelve a «Sin proveedor», así se puede elegir el mismo proveedor de nuevo para reintentar
        // (elegir la opción que ya está seleccionada no dispara ningún cambio).
        setCargandoProveedor(false);
        setProveedorId("");
        setItems([{ ...FILA_VACIA }]);
        setPresentacionesPorFila({});
        setVersionItems((n) => n + 1);
        setInfoProveedor("No se pudo cargar lo que le comprás a este proveedor. Volvé a elegirlo para reintentar.");
      }
    ).then((productos) => {
      if (productos === undefined) return; // falló: ya se avisó arriba
      if (pedido !== pedidoProveedor.current) return; // se eligió otro proveedor mientras tanto
      setCargandoProveedor(false);
      if (!productos.length) {
        setItems([{ ...FILA_VACIA }]);
        setPresentacionesPorFila({});
        setVersionItems((n) => n + 1);
        setInfoProveedor("Todavía no le compraste nada a este proveedor — agregalo con \"+ Agregar producto\". La próxima vez va a aparecer solo acá.");
        return;
      }
      setInfoProveedor(`${productos.length} producto(s) que ya le comprás. Completá cantidad solo en los que estés comprando ahora — el resto queda sin cambios.`);
      setItems(
        productos.map((p) => ({
          productoId: p.productoId,
          etiquetaInicial: `${p.productoCodigo} — ${p.productoNombre}`,
          cantidad: "",
          loteVencimiento: "",
          precioTotal: "",
          pesoReal: "",
          unidadCompraId: "",
          referenciaProveedor: p.referenciaProveedor ?? "",
          ultimaCompraTexto: p.ultimoPrecioPorUnidadStock > 0 ? `última vez: $${p.ultimoPrecioPorUnidadStock.toLocaleString("es-AR")} / ${p.unidadStockNombre}` : "",
        }))
      );
      setPresentacionesPorFila({});
      setVersionItems((n) => n + 1);
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    const itemsValidos: ItemMovimientoInput[] = items
      .filter((f) => f.productoId && f.cantidad !== "")
      .map((f) => ({
        productoId: f.productoId,
        // numeroDelCampo: vacío → undefined, texto inválido → NaN (el servidor lo rechaza); nunca el 0 que daba convertir un texto vacío.
        cantidad: numeroDelCampo(f.cantidad) ?? Number.NaN,
        loteVencimiento: f.loteVencimiento ? new Date(f.loteVencimiento) : null,
        precioTotal: numeroDelCampo(f.precioTotal),
        pesoReal: numeroDelCampo(f.pesoReal) ?? null,
        unidadCompraId: config.esCompraLike && f.unidadCompraId ? f.unidadCompraId : undefined,
        referenciaProveedor: precargaPorProveedor ? f.referenciaProveedor || undefined : undefined,
      }));

    if (!itemsValidos.length) {
      setMensaje("Cargá al menos un producto con cantidad.");
      setOk(false);
      return;
    }

    startTransition(async () => {
      const resultado = await registrarMovimiento({
        proceso: config.proceso,
        fecha: new Date(fecha),
        seccionId,
        seccionDestinoId: config.proceso === "TRANSFERENCIA" ? seccionDestinoId : undefined,
        proveedorId: proveedorId || undefined,
        nroFactura: nroFactura || undefined,
        motivoId: config.pideMotivo && motivoId ? motivoId : undefined,
        destinoId: config.pideDestino && destinoId ? destinoId : undefined,
        detalleLibre: detalleLibre || undefined,
        items: itemsValidos,
        claveIdempotencia,
      });
      setMensaje(resultado.mensaje);
      setOk(resultado.ok);
      if (resultado.ok) {
        setItems([{ ...FILA_VACIA }]);
        setPresentacionesPorFila({});
        setInfoProveedor("");
        setVersionItems((n) => n + 1);
        setClaveIdempotencia(crypto.randomUUID());
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {productoInicial && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Viniste desde un reporte para cargar precio de <strong>{productoInicial.etiqueta}</strong> — completá sección, cantidad y precio para resolverlo.
        </p>
      )}
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Fecha
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {config.proceso === "TRANSFERENCIA" ? "Sección origen" : "Sección"}
          <select value={seccionId} onChange={(e) => setSeccionId(e.target.value)} required className="rounded border px-3 py-2">
            <option value="">Elegí una sección</option>
            {secciones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
        {config.proceso === "TRANSFERENCIA" && (
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Sección destino
            <select value={seccionDestinoId} onChange={(e) => setSeccionDestinoId(e.target.value)} required className="rounded border px-3 py-2">
              <option value="">Elegí una sección</option>
              {secciones.filter((s) => s.id !== seccionId).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {config.requiereProveedor && (
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Proveedor
            <select value={proveedorId} onChange={(e) => elegirProveedor(e.target.value)} className="rounded border px-3 py-2">
              <option value="">Sin proveedor</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            N° de factura
            <input value={nroFactura} onChange={(e) => setNroFactura(e.target.value)} maxLength={LARGO_MAXIMO_NRO_FACTURA} className="rounded border px-3 py-2" />
          </label>
        </div>
      )}

      {config.pideMotivo && (
        <label className="flex flex-col gap-1 text-sm">
          Motivo
          <select value={motivoId} onChange={(e) => setMotivoId(e.target.value)} required className="rounded border px-3 py-2">
            <option value="">Elegí un motivo</option>
            {motivos?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>
      )}

      {config.pideDestino && (
        <label className="flex flex-col gap-1 text-sm">
          Destino
          <select value={destinoId} onChange={(e) => setDestinoId(e.target.value)} className="rounded border px-3 py-2">
            <option value="">Sin destino específico</option>
            {destinos?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Productos</span>
        {precargaPorProveedor && infoProveedor && <p className="text-xs text-neutral-500">{infoProveedor}</p>}
        {items.map((fila, idx) => (
          <div key={`${versionItems}-${idx}`} className="flex flex-wrap items-end gap-2 rounded border p-2">
            <label className="flex flex-1 min-w-40 flex-col gap-1 text-xs text-neutral-500">
              Producto
              <SelectorProducto
                value={fila.productoId}
                onChange={(id) => cambiarProducto(idx, id)}
                filtro={config.filtroProducto}
                etiquetaInicial={fila.etiquetaInicial}
                required
              />
              {fila.ultimaCompraTexto && <span className="text-neutral-500 dark:text-neutral-400">{fila.ultimaCompraTexto}</span>}
              {config.proceso === "COMPRA" && unidades && (
                // Deshabilitado mientras se cargan los productos del proveedor: cuando esa carga responde
                // cambia `versionItems`, y con él la `key` de la fila, que se remonta y se lleva puesto un
                // modal que ya estuviera abierto (con lo tipeado). Ver `cargandoProveedor` en `elegirProveedor`.
                <QuickCrearProducto
                  unidades={unidades}
                  deshabilitado={cargandoProveedor}
                  onCreado={(item) => productoCreadoEnFila(idx, item.id, item.etiqueta)}
                />
              )}
            </label>
            <label className="flex w-28 flex-col gap-1 text-xs text-neutral-500">
              <span>
                Cantidad
                {config.cantidadConSigno && (
                  <AyudaIcono texto="El ajuste es el DELTA, ya con signo: cargá negativo (ej. -5) para bajar el stock, positivo para subirlo." />
                )}
              </span>
              <CampoNumero
                value={fila.cantidad}
                onChange={(v) => actualizarFila(idx, { cantidad: v })}
                placeholder={config.cantidadConSigno ? "ej. -5 o 5" : undefined}
                required
                tamano="compacto"
              />
            </label>
            <label className="flex w-36 flex-col gap-1 text-xs text-neutral-500">
              Lote (Fecha VTO.)
              <input
                type="date"
                value={fila.loteVencimiento}
                onChange={(e) => actualizarFila(idx, { loteVencimiento: e.target.value })}
                className="rounded border px-2 py-1.5 text-sm"
              />
            </label>
            {config.esCompraLike && (
              <>
                <label className="flex w-32 flex-col gap-1 text-xs text-neutral-500">
                  Precio total
                  <CampoNumero
                    value={fila.precioTotal}
                    onChange={(v) => actualizarFila(idx, { precioTotal: v })}
                    prefijo="$"
                    tamano="compacto"
                    tipo="importe"
                    etiqueta="El precio total"
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-neutral-500">
                  Peso real
                  <CampoNumero value={fila.pesoReal} onChange={(v) => actualizarFila(idx, { pesoReal: v })} tamano="compacto" />
                </label>
                {(presentacionesPorFila[idx]?.length ?? 0) > 0 && (
                  <label className="flex w-44 flex-col gap-1 text-xs text-neutral-500">
                    Presentación
                    <select
                      value={fila.unidadCompraId}
                      onChange={(e) => actualizarFila(idx, { unidadCompraId: e.target.value })}
                      className="rounded border px-2 py-1.5 text-sm"
                    >
                      <option value="">Unidad de compra por defecto</option>
                      {presentacionesPorFila[idx].map((p) => (
                        <option key={p.id} value={p.unidadCompraId}>
                          {p.unidadCompraNombre} (×{p.factorConversion})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {precargaPorProveedor && (
              <label className="flex w-40 flex-col gap-1 text-xs text-neutral-500">
                Código/nombre del proveedor
                <input
                  value={fila.referenciaProveedor}
                  onChange={(e) => actualizarFila(idx, { referenciaProveedor: e.target.value })}
                  placeholder="opcional"
                  className="rounded border px-2 py-1.5 text-sm"
                />
              </label>
            )}
            <button
              type="button"
              onClick={() => quitarFila(idx)}
              disabled={items.length === 1}
              className="rounded border px-2 py-1.5 text-sm text-neutral-500 disabled:opacity-30"
            >
              Quitar
            </button>
          </div>
        ))}
        <button type="button" onClick={agregarFila} disabled={cargandoProveedor} className="self-start text-sm underline disabled:opacity-50">
          + Agregar producto{precargaPorProveedor && proveedorId ? " (que no está en la lista de este proveedor)" : ""}
        </button>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Detalle (opcional)
        <input value={detalleLibre} onChange={(e) => setDetalleLibre(e.target.value)} className="rounded border px-3 py-2" />
      </label>

      {mensaje && <p className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}

      <button type="submit" disabled={pending} className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Guardando..." : "Confirmar"}
      </button>
    </form>
  );
}
