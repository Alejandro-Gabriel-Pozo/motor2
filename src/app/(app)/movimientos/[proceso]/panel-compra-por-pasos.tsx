"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { registrarMovimiento, type ItemMovimientoInput } from "@/server/actions/movimientos/movimientos";
import { registrarFacturaProveedor } from "@/server/actions/movimientos/facturas-proveedor";
import { BloqueDeReparto, REPARTO_APAGADO, type EstadoDeReparto } from "./bloque-de-reparto";
import { listarProductosDeProveedor } from "@/server/actions/catalogo/proveedor-por-producto";
import { obtenerDatosDeCompraDelProducto } from "@/server/actions/catalogo/productos";
import { useLeerServidor } from "@/lib/use-leer-servidor";
import {
  PASOS_DE_COMPRA,
  avisoDeUnidadNoVigente,
  avisosDeImporteCero,
  cantidadEnStock,
  etiquetaDeUnidad,
  mensajeFinalDeCompra,
  pasoAnterior,
  pasoSiguiente,
  precioPorUnidad,
  seMuestraElPesoReal,
  unidadEfectiva,
  validarPasoDonde,
  validarPasoFactura,
  validarPasoLineas,
  type ErrorDePaso,
  type LineaParaValidar,
  type PasoDeCompra,
  type UnidadesDeCompraDelProducto,
} from "@/core/compras/public";
import type { ProcesoUiConfig } from "@/core/movimientos/public";
import { formatearCantidad, formatearMonto } from "@/core/pos/public";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoNumero } from "@/components/campo-numero";
import { CampoNumeroDeComprobante } from "@/components/campo-numero-de-comprobante";
import { estadoDelNumeroTecleado, PARTES_DE_NUMERO_VACIAS, type PartesDeNumeroDeComprobante } from "@/core/datos/numero-comprobante";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { ZONA_ARGENTINA, diaDeCalendario, fechaDeColumnaDate, mediodiaDelDia } from "@/core/tiempo/zona-horaria";
import { QuickCrearProducto } from "@/components/catalogo/quick-crear-producto";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Casilla } from "@/ui/primitivas/casilla";
import { Selector } from "@/ui/primitivas/selector";
import { CampoFecha } from "@/ui/componentes/selectores/campo-fecha";

/**
 * La COMPRA por pasos (etapa 1 de Compras, paso 6; docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md §9): Factura → Qué compraste → Dónde entra → Pago → Revisar y confirmar. Solo la Compra usa esta pantalla;
 * los otros ocho procesos siguen con `PanelMovimientoForm`. Las mismas Server Actions de siempre (`registrarMovimiento`, y `registrarFacturaProveedor` si se reparte entre sucursales): el servidor revalida todo, lo que
 * valida cada paso acá solo evita ir y volver. Lo que se puede calcular sin ambigüedad (códigos, precios por unidad) se muestra y NO se manda.
 *
 * El formulario va con `noValidate` y solo dibuja el paso actual: la validez nativa de un campo de otro paso no puede frenar el envío. Enter pasa al paso siguiente; confirmar es SIEMPRE el botón «Confirmar compra».
 */
interface Opcion {
  id: string;
  nombre: string;
}

interface FilaCompra {
  productoId: string;
  /** Precarga: evita que SelectorProducto arranque vacío para una fila ya resuelta. */
  etiquetaInicial: string;
  /** NUESTRO código (Producto.codigo) y nombre, solo lectura. Vacíos hasta que el servidor responde. */
  codigo: string;
  nombre: string;
  /** Unidades en que se puede comprar el producto; `null` mientras se leen. */
  unidades: UnidadesDeCompraDelProducto | null;
  /** Vacío = la unidad por defecto del producto; si no, el id de una presentación activa. */
  unidadCompraId: string;
  /** Nombre de la unidad de la última compra cuando ya no está activa (hay que confirmar la que quedó). */
  unidadNoVigente: string | null;
  unidadConfirmada: boolean;
  cantidad: string;
  loteVencimiento: string;
  importe: string;
  pesoReal: string;
  referenciaProveedor: string;
  /** Solo referencia visual, no se manda al servidor. */
  ultimaCompraTexto: string;
}

const FILA_VACIA: FilaCompra = {
  productoId: "",
  etiquetaInicial: "",
  codigo: "",
  nombre: "",
  unidades: null,
  unidadCompraId: "",
  unidadNoVigente: null,
  unidadConfirmada: false,
  cantidad: "",
  loteVencimiento: "",
  importe: "",
  pesoReal: "",
  referenciaProveedor: "",
  ultimaCompraTexto: "",
};

// El día de hoy en Argentina (no en UTC: desde las 21:00 locales UTC ya es mañana).
const hoyISO = () => diaDeCalendario(new Date(), ZONA_ARGENTINA);

const paraValidar = (f: FilaCompra, yaVinculados: ReadonlySet<string>): LineaParaValidar => ({
  productoId: f.productoId,
  nombre: f.nombre,
  cantidad: f.cantidad,
  loteVencimiento: f.loteVencimiento,
  referenciaProveedor: f.referenciaProveedor,
  yaVinculado: yaVinculados.has(f.productoId),
  unidadSinConfirmar: f.unidadNoVigente !== null && !f.unidadConfirmada,
});

export function PanelCompraPorPasos({
  config,
  secciones,
  proveedores,
  unidades,
  productoInicial,
  reparto,
}: {
  config: ProcesoUiConfig;
  secciones: Opcion[];
  proveedores: Opcion[];
  /** Alta rápida de producto inline (QuickCrearProducto). */
  unidades?: Opcion[];
  /** Deep-link accionable desde un reporte: precarga la primera fila con este producto. */
  productoInicial?: { id: string; etiqueta: string };
  /** E3a (ADR-041): solo si quien carga puede repartir y hay otras sucursales activas. */
  reparto?: { sucursalActiva: Opcion; otras: Opcion[] };
}) {
  const router = useRouter();
  const leer = useLeerServidor();
  const [pending, startTransition] = useTransition();
  const enviando = useRef(false);

  const [paso, setPaso] = useState<PasoDeCompra>("FACTURA");
  const [errorDePaso, setErrorDePaso] = useState<{ paso: PasoDeCompra; error: ErrorDePaso } | null>(null);
  const [hoy] = useState(hoyISO);
  const [fecha, setFecha] = useState(hoy);
  const [proveedorId, setProveedorId] = useState("");
  const [numero, setNumero] = useState<PartesDeNumeroDeComprobante>(PARTES_DE_NUMERO_VACIAS);
  // Se muestran los errores del número recién después de intentar avanzar desde «Factura».
  const [intentoFactura, setIntentoFactura] = useState(false);
  const [seccionId, setSeccionId] = useState(() => (config.exigeSeccion ? "" : (secciones[0]?.id ?? "")));
  const [detalleLibre, setDetalleLibre] = useState("");
  const [estadoReparto, setEstadoReparto] = useState<EstadoDeReparto>(REPARTO_APAGADO);
  const repartiendo = Boolean(reparto && estadoReparto.repartir);
  const [items, setItems] = useState<FilaCompra[]>([productoInicial ? { ...FILA_VACIA, productoId: productoInicial.id, etiquetaInicial: productoInicial.etiqueta } : { ...FILA_VACIA }]);
  const [productosYaVinculados, setProductosYaVinculados] = useState<ReadonlySet<string>>(new Set());
  const [cargandoProveedor, setCargandoProveedor] = useState(false);
  const [infoProveedor, setInfoProveedor] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  // I3: un UUID por intento de envío, reenviado tal cual en cada reintento del MISMO envío; se renueva recién después de un éxito.
  const [claveIdempotencia, setClaveIdempotencia] = useState(() => crypto.randomUUID());
  // Se incrementa cuando `items` se reemplaza en bloque: entra en la `key` de cada fila para remontar SelectorProducto (lee `etiquetaInicial` una sola vez).
  const [versionItems, setVersionItems] = useState(0);
  // Número del último pedido de productos del proveedor: un pedido que termina cuando ya se eligió otro proveedor se descarta.
  const pedidoProveedor = useRef(0);

  const actualizarFila = (idx: number, cambios: Partial<FilaCompra>) => setItems((prev) => prev.map((f, i) => (i === idx ? { ...f, ...cambios } : f)));

  /** Lee código, nombre y unidades del producto elegido a mano; si la fila ya cambió de producto cuando responde, se descarta. */
  const cargarDatosDelProducto = (idx: number, productoId: string) => {
    void leer(
      () => obtenerDatosDeCompraDelProducto(productoId),
      () => {
        setMensaje("No se pudieron cargar los datos de ese producto. Revisá tu conexión; si venís trabajando hace rato, tu sesión pudo haber vencido: recargá la página.");
        setOk(false);
      }
    ).then((datos) => {
      if (!datos) return;
      setItems((prev) => prev.map((f, i) => (i === idx && f.productoId === productoId ? { ...f, codigo: datos.codigo, nombre: datos.nombre, unidades: datos.unidades } : f)));
    });
  };

  const cambiarProducto = (idx: number, productoId: string) => {
    actualizarFila(idx, { productoId, codigo: "", nombre: "", unidades: null, unidadCompraId: "", unidadNoVigente: null, unidadConfirmada: false });
    if (productoId) cargarDatosDelProducto(idx, productoId);
  };

  // El producto del deep-link entra con la etiqueta pero sin sus unidades: se leen al montar.
  const idDelProductoInicial = productoInicial?.id;
  useEffect(() => {
    if (idDelProductoInicial) cargarDatosDelProducto(0, idDelProductoInicial);
    // Una sola vez al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const productoCreadoEnFila = (idx: number, id: string, etiqueta: string) => {
    setItems((prev) => prev.map((f, i) => (i === idx ? { ...f, productoId: id, etiquetaInicial: etiqueta, codigo: "", nombre: "", unidades: null, unidadCompraId: "", unidadNoVigente: null, unidadConfirmada: false } : f)));
    setVersionItems((n) => n + 1);
    cargarDatosDelProducto(idx, id);
  };

  const agregarFila = () => setItems((prev) => [...prev, { ...FILA_VACIA }]);
  const quitarFila = (idx: number) => setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const reiniciarFilas = () => {
    setItems([{ ...FILA_VACIA }]);
    setVersionItems((n) => n + 1);
  };

  const elegirProveedor = (id: string) => {
    setProveedorId(id);
    const pedido = ++pedidoProveedor.current;
    setProductosYaVinculados(new Set());

    if (!id) {
      setCargandoProveedor(false);
      reiniciarFilas();
      setInfoProveedor("");
      return;
    }

    setCargandoProveedor(true);
    setInfoProveedor("Buscando lo que le comprás a este proveedor...");
    void leer(
      () => listarProductosDeProveedor(id),
      () => {
        if (pedido !== pedidoProveedor.current) return;
        // Si la carga falla las filas que había eran de OTRO proveedor: se vacían y el proveedor vuelve a «Elegí el proveedor», así se puede elegir el mismo de nuevo para reintentar.
        setCargandoProveedor(false);
        setProveedorId("");
        reiniciarFilas();
        setInfoProveedor("No se pudo cargar lo que le comprás a este proveedor. Volvé a elegirlo para reintentar.");
      }
    ).then((productos) => {
      if (productos === undefined) return;
      if (pedido !== pedidoProveedor.current) return;
      setCargandoProveedor(false);
      if (!productos.length) {
        reiniciarFilas();
        setInfoProveedor("Todavía no le compraste nada a este proveedor — agregalo con \"+ Agregar insumo\". La próxima vez va a aparecer solo acá.");
        return;
      }
      setProductosYaVinculados(new Set(productos.map((p) => p.productoId)));
      setInfoProveedor(`${productos.length} producto(s) que ya le comprás. Completá cantidad solo en los que estés comprando ahora — el resto queda sin cambios.`);
      setItems(
        productos.map((p) => ({
          ...FILA_VACIA,
          productoId: p.productoId,
          etiquetaInicial: `${p.productoCodigo} — ${p.productoNombre}`,
          codigo: p.productoCodigo,
          nombre: p.productoNombre,
          unidades: p.unidades,
          // La unidad de la última compra al proveedor si sigue válida (la por defecto va vacía); si no, la por defecto y hay que confirmarla.
          unidadCompraId: p.unidadElegidaId,
          unidadNoVigente: p.unidadDelVinculoVigente ? null : p.unidadCompraNombre,
          unidadConfirmada: p.unidadDelVinculoVigente,
          referenciaProveedor: p.referenciaProveedor ?? "",
          ultimaCompraTexto:
            p.ultimoPrecioPorUnidadStock > 0
              ? `${p.origenDelPrecio === "EMPRESA" ? "última vez (otra sucursal)" : "última vez"}: $${p.ultimoPrecioPorUnidadStock.toLocaleString("es-AR")} / ${p.unidadStockNombre}`
              : "",
        }))
      );
      setVersionItems((n) => n + 1);
    });
  };

  // ───────────── Validación y navegación ─────────────

  const errorDelPaso = (p: PasoDeCompra): ErrorDePaso | null => {
    if (p === "FACTURA") return validarPasoFactura({ proveedorId, fecha, hoy, numero });
    if (p === "LINEAS") return validarPasoLineas(items.map((f) => paraValidar(f, productosYaVinculados)));
    if (p === "DONDE") return validarPasoDonde({ seccionId });
    return null;
  };

  const irA = (destino: PasoDeCompra) => {
    setErrorDePaso(null);
    setPaso(destino);
  };

  const siguiente = () => {
    if (paso === "FACTURA") setIntentoFactura(true);
    if (paso === "LINEAS" && cargandoProveedor) {
      setErrorDePaso({ paso, error: { mensaje: "Esperá a que termine de cargar lo que le comprás a este proveedor." } });
      return;
    }
    const error = errorDelPaso(paso);
    if (error) {
      setErrorDePaso({ paso, error });
      return;
    }
    irA(pasoSiguiente(paso));
  };

  const lineasAGuardar = items.filter((f) => f.productoId && f.cantidad !== "");
  const totalDeLaCompra = lineasAGuardar.reduce((s, f) => s + (numeroDelCampo(f.importe) ?? 0), 0);
  const avisosDeCero = avisosDeImporteCero(lineasAGuardar.map((f) => ({ nombre: f.nombre || f.etiquetaInicial, cantidad: f.cantidad, importe: f.importe })));
  const numeroArmado = estadoDelNumeroTecleado(numero);

  const confirmar = () => {
    if (enviando.current || pending) return;
    // Se revalidan los tres pasos de carga: el primero que falla se abre con su error.
    for (const p of ["FACTURA", "LINEAS", "DONDE"] as const) {
      const error = errorDelPaso(p);
      if (error) {
        if (p === "FACTURA") setIntentoFactura(true);
        setPaso(p);
        setErrorDePaso({ paso: p, error });
        return;
      }
    }
    if (numeroArmado.tipo !== "valido") return; // ya lo cubre validarPasoFactura; acá solo estrecha el tipo
    setErrorDePaso(null);

    const itemsValidos: ItemMovimientoInput[] = lineasAGuardar.map((f) => ({
      productoId: f.productoId,
      // numeroDelCampo: vacío → undefined, texto inválido → NaN (el servidor lo rechaza); nunca el 0 que daba convertir un texto vacío.
      cantidad: numeroDelCampo(f.cantidad) ?? Number.NaN,
      loteVencimiento: f.loteVencimiento ? fechaDeColumnaDate(f.loteVencimiento) : null,
      precioTotal: numeroDelCampo(f.importe),
      pesoReal: numeroDelCampo(f.pesoReal) ?? null,
      unidadCompraId: f.unidadCompraId || undefined,
      referenciaProveedor: f.referenciaProveedor.trim() || undefined,
    }));
    const avisos = avisosDeCero;
    const nroFactura = numeroArmado.numero;

    enviando.current = true;
    startTransition(async () => {
      try {
        let resultado: { ok: boolean; mensaje: string };
        if (repartiendo && reparto) {
          const partes = estadoReparto.incluidas.map((sucursalId) => ({ sucursalId, valor: numeroDelCampo(estadoReparto.valores[sucursalId] ?? "") ?? Number.NaN }));
          const conParteEnEsta = estadoReparto.incluidas.includes(reparto.sucursalActiva.id);
          resultado = await registrarFacturaProveedor({
            fecha: mediodiaDelDia(fecha, ZONA_ARGENTINA),
            proveedorId,
            nroFactura,
            seccionId: conParteEnEsta ? seccionId : undefined,
            detalleLibre: detalleLibre || undefined,
            items: itemsValidos,
            reparto: { modo: estadoReparto.modo, partes },
            claveIdempotencia,
          });
        } else {
          resultado = await registrarMovimiento({
            proceso: config.proceso,
            fecha: mediodiaDelDia(fecha, ZONA_ARGENTINA),
            seccionId,
            proveedorId,
            nroFactura,
            detalleLibre: detalleLibre || undefined,
            items: itemsValidos,
            claveIdempotencia,
          });
        }
        setOk(resultado.ok);
        setMensaje(resultado.ok ? mensajeFinalDeCompra(resultado.mensaje, avisos) : resultado.mensaje);
        if (resultado.ok) {
          // Se vuelve a empezar para cargar OTRA compra: intento nuevo, clave nueva.
          setPaso("FACTURA");
          setIntentoFactura(false);
          setProveedorId("");
          setNumero(PARTES_DE_NUMERO_VACIAS);
          setDetalleLibre("");
          setProductosYaVinculados(new Set());
          setInfoProveedor("");
          reiniciarFilas();
          setEstadoReparto(REPARTO_APAGADO);
          setClaveIdempotencia(crypto.randomUUID());
          router.refresh();
        }
      } finally {
        enviando.current = false;
      }
    });
  };

  // ───────────── Pantalla ─────────────

  const indicePaso = PASOS_DE_COMPRA.findIndex((p) => p.id === paso);
  const errorAca = errorDePaso && errorDePaso.paso === paso ? errorDePaso.error : null;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        // Enter avanza; confirmar es solo el botón «Confirmar compra».
        if (paso !== "REVISAR") siguiente();
      }}
      className="flex flex-col gap-4"
      data-testid="compra-por-pasos"
    >
      {productoInicial && (
        <Aviso variante="advertencia">
          Viniste desde un reporte para cargar precio de <strong>{productoInicial.etiqueta}</strong> — completá la factura, cantidad e importe para resolverlo.
        </Aviso>
      )}

      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Pasos de la compra">
        {PASOS_DE_COMPRA.map((p, i) => (
          <li key={p.id} aria-current={p.id === paso ? "step" : undefined} className={p.id === paso ? "font-semibold" : "text-tinta-tenue"}>
            {i + 1}. {p.titulo}
          </li>
        ))}
      </ol>

      {mensaje && (
        <Aviso variante={ok ? "exito" : "error"} forma="en-linea">
          {mensaje}
        </Aviso>
      )}

      <h2 className="text-lg font-semibold">
        Paso {indicePaso + 1} de {PASOS_DE_COMPRA.length}: {PASOS_DE_COMPRA[indicePaso].titulo}
      </h2>

      {paso === "FACTURA" && (
        <div className="flex flex-col gap-3">
          <Selector etiqueta="Proveedor" value={proveedorId} onChange={(e) => elegirProveedor(e.target.value)} required>
            <option value="">Elegí el proveedor</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Selector>
          <div className="max-w-52">
            <CampoFecha etiqueta="Fecha de la factura" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} required />
          </div>
          <CampoNumeroDeComprobante partes={numero} onCambio={setNumero} mostrarErrores={intentoFactura} />
        </div>
      )}

      {paso === "LINEAS" && (
        <div className="flex flex-col gap-2">
          {infoProveedor && <p className="text-xs text-tinta-tenue">{infoProveedor}</p>}
          {items.map((fila, idx) => {
            const unidad = fila.unidades ? unidadEfectiva(fila.unidades, fila.unidadCompraId) : null;
            const cantidad = numeroDelCampo(fila.cantidad);
            const enStock = unidad ? cantidadEnStock({ cantidad, factor: unidad.factor, pesoReal: numeroDelCampo(fila.pesoReal) }) : null;
            const importe = numeroDelCampo(fila.importe);
            const porUnidadDeCompra = precioPorUnidad(importe, cantidad);
            const porUnidadDeStock = precioPorUnidad(importe, enStock);
            return (
              <div key={`${versionItems}-${idx}`} className="flex flex-wrap items-end gap-2 rounded border p-2" data-testid="linea-de-compra">
                <div className="flex w-24 flex-col gap-1 text-sm">
                  <span className="font-medium">Código</span>
                  <span className="min-h-6" data-testid="codigo-del-producto">
                    {fila.codigo || "—"}
                  </span>
                </div>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
                  <span className="font-medium">Insumo</span>
                  <SelectorProducto
                    value={fila.productoId}
                    onChange={(id) => cambiarProducto(idx, id)}
                    filtro={config.filtroProducto}
                    proveedorId={proveedorId || undefined}
                    etiquetaInicial={fila.etiquetaInicial}
                    required
                  />
                  {fila.ultimaCompraTexto && <span className="text-xs text-tinta-tenue">{fila.ultimaCompraTexto}</span>}
                  {unidades && (
                    // Deshabilitado mientras se cargan los productos del proveedor: esa carga cambia `versionItems` y remonta la fila, y se llevaría puesto un modal abierto.
                    <QuickCrearProducto unidades={unidades} deshabilitado={cargandoProveedor} onCreado={(item) => productoCreadoEnFila(idx, item.id, item.etiqueta)} />
                  )}
                </label>
                <div className="w-44">
                  {fila.unidades && fila.unidades.presentaciones.length > 0 ? (
                    <Selector etiqueta="UM" tamano="compacto" value={fila.unidadCompraId} onChange={(e) => actualizarFila(idx, { unidadCompraId: e.target.value })}>
                      <option value="">{etiquetaDeUnidad(fila.unidades.porDefecto)}</option>
                      {fila.unidades.presentaciones.map((p) => (
                        <option key={p.unidadCompraId} value={p.unidadCompraId}>
                          {etiquetaDeUnidad(p)}
                        </option>
                      ))}
                    </Selector>
                  ) : (
                    <div className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">UM</span>
                      <span className="min-h-6" data-testid="unidad-de-compra">
                        {unidad ? etiquetaDeUnidad(unidad) : "—"}
                      </span>
                    </div>
                  )}
                </div>
                <label className="flex w-28 flex-col gap-1 text-sm">
                  <span className="font-medium">Cantidad</span>
                  <CampoNumero tipo="cantidad" value={fila.cantidad} onChange={(v) => actualizarFila(idx, { cantidad: v })} tamano="compacto" />
                </label>
                {seMuestraElPesoReal() && (
                  <label className="flex w-44 flex-col gap-1 text-sm">
                    <span className="font-medium">Peso real (en la unidad de stock, opcional)</span>
                    <CampoNumero tipo="cantidad" value={fila.pesoReal} onChange={(v) => actualizarFila(idx, { pesoReal: v })} tamano="compacto" />
                  </label>
                )}
                <label className="flex w-32 flex-col gap-1 text-sm">
                  <span className="font-medium">Importe con IVA</span>
                  <CampoNumero value={fila.importe} onChange={(v) => actualizarFila(idx, { importe: v })} prefijo="$" tamano="compacto" tipo="importe" etiqueta="El importe" />
                </label>
                <div className="w-44">
                  <CampoFecha
                    etiqueta="Lote (Fecha VTO.)"
                    tamano="compacto"
                    value={fila.loteVencimiento}
                    onChange={(e) => actualizarFila(idx, { loteVencimiento: e.target.value })}
                    error={errorAca?.fila === idx && errorAca.campo === "vencimiento" ? errorAca.mensaje : undefined}
                  />
                </div>
                <div className="w-56">
                  <Campo
                    etiqueta="Cómo lo llama el proveedor (código y descripción, como dice la factura)"
                    tamano="compacto"
                    value={fila.referenciaProveedor}
                    onChange={(e) => actualizarFila(idx, { referenciaProveedor: e.target.value })}
                    required={Boolean(fila.productoId && fila.cantidad !== "" && !productosYaVinculados.has(fila.productoId))}
                    placeholder={fila.productoId && !productosYaVinculados.has(fila.productoId) ? "obligatorio en la primera compra" : "opcional"}
                  />
                </div>
                {(porUnidadDeCompra !== null || porUnidadDeStock !== null) && unidad && fila.unidades && (
                  <p className="w-full text-xs text-tinta-tenue" data-testid="precios-calculados">
                    {porUnidadDeCompra !== null && <span>Precio por {unidad.nombre.toLowerCase()}: {formatearMonto(porUnidadDeCompra)}. </span>}
                    {porUnidadDeStock !== null && <span>Precio por {fila.unidades.unidadStockNombre.toLowerCase()} (de stock): {formatearMonto(porUnidadDeStock)}.</span>}
                  </p>
                )}
                {fila.unidadNoVigente !== null && fila.unidades && (
                  <div className="w-full">
                    <Aviso variante="advertencia" forma="en-linea">
                      {avisoDeUnidadNoVigente(fila.unidadNoVigente)} Quedó en {etiquetaDeUnidad(unidadEfectiva(fila.unidades, fila.unidadCompraId))}.
                    </Aviso>
                    <Casilla etiqueta="Confirmo la unidad" checked={fila.unidadConfirmada} onChange={(e) => actualizarFila(idx, { unidadConfirmada: e.target.checked })} />
                  </div>
                )}
                {errorAca?.fila === idx && errorAca.campo !== "vencimiento" && (
                  <div className="w-full">
                    <Aviso variante="error" forma="en-linea">
                      {errorAca.mensaje}
                    </Aviso>
                  </div>
                )}
                <Boton variante="secundario" tamano="compacto" onClick={() => quitarFila(idx)} disabled={items.length === 1}>
                  Quitar
                </Boton>
              </div>
            );
          })}
          <Boton variante="enlace" tamano="en-fila" onClick={agregarFila} disabled={cargandoProveedor} className="self-start">
            + Agregar insumo{proveedorId ? " (que no está en la lista de este proveedor)" : ""}
          </Boton>
        </div>
      )}

      {paso === "DONDE" && (
        <div className="flex flex-col gap-3">
          <Selector etiqueta="Depósito" value={seccionId} onChange={(e) => setSeccionId(e.target.value)} required>
            <option value="">Elegí un depósito</option>
            {secciones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </Selector>
          {reparto && <BloqueDeReparto estado={estadoReparto} onCambio={setEstadoReparto} sucursalActiva={reparto.sucursalActiva} otras={reparto.otras} totalDeLaFactura={totalDeLaCompra} />}
          <Campo etiqueta="Detalle (opcional)" value={detalleLibre} onChange={(e) => setDetalleLibre(e.target.value)} />
        </div>
      )}

      {paso === "PAGO" && <p data-testid="pago-pendiente">Pendiente de completar: la forma y fecha de pago se cargan en una etapa posterior.</p>}

      {paso === "REVISAR" && (
        <div className="flex flex-col gap-3" data-testid="resumen-de-compra">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="font-medium">Proveedor</dt>
            <dd>{proveedores.find((p) => p.id === proveedorId)?.nombre ?? "—"}</dd>
            <dt className="font-medium">Factura</dt>
            <dd>{numeroArmado.tipo === "valido" ? numeroArmado.numero : "—"}</dd>
            <dt className="font-medium">Fecha</dt>
            <dd>{fecha}</dd>
            <dt className="font-medium">Depósito</dt>
            <dd>{secciones.find((s) => s.id === seccionId)?.nombre ?? "—"}</dd>
            {repartiendo && reparto && (
              <>
                <dt className="font-medium">Reparto</dt>
                <dd>
                  {estadoReparto.incluidas
                    .map((id) => {
                      const nombre = [reparto.sucursalActiva, ...reparto.otras].find((s) => s.id === id)?.nombre ?? id;
                      const valor = numeroDelCampo(estadoReparto.valores[id] ?? "") ?? 0;
                      return `${nombre}: ${estadoReparto.modo === "IMPORTE" ? formatearMonto(valor) : `${formatearCantidad(valor)} %`}`;
                    })
                    .join(" · ")}
                </dd>
              </>
            )}
            {detalleLibre && (
              <>
                <dt className="font-medium">Detalle</dt>
                <dd>{detalleLibre}</dd>
              </>
            )}
          </dl>
          <ul className="flex flex-col gap-2 text-sm">
            {lineasAGuardar.map((f, idx) => {
              const unidad = f.unidades ? unidadEfectiva(f.unidades, f.unidadCompraId) : null;
              const cantidad = numeroDelCampo(f.cantidad);
              const pesoReal = numeroDelCampo(f.pesoReal);
              const enStock = unidad ? cantidadEnStock({ cantidad, factor: unidad.factor, pesoReal }) : null;
              const importe = numeroDelCampo(f.importe) ?? 0;
              const porUC = precioPorUnidad(importe, cantidad);
              const porUS = precioPorUnidad(importe, enStock);
              return (
                <li key={idx} className="rounded border p-2" data-testid="linea-del-resumen">
                  <span className="font-medium">
                    {f.codigo ? `${f.codigo} — ` : ""}
                    {f.nombre || f.etiquetaInicial}
                  </span>
                  : {cantidad !== undefined ? formatearCantidad(cantidad) : "?"} {unidad ? etiquetaDeUnidad(unidad) : ""}
                  {pesoReal !== undefined && pesoReal > 0 && unidad && f.unidades ? ` (peso real ${formatearCantidad(pesoReal)} ${f.unidades.unidadStockNombre})` : ""} · {formatearMonto(importe)}
                  {(porUC !== null || porUS !== null) && unidad && f.unidades && (
                    <span className="block text-xs text-tinta-tenue">
                      {porUC !== null && `Por ${unidad.nombre.toLowerCase()}: ${formatearMonto(porUC)}. `}
                      {porUS !== null && `Por ${f.unidades.unidadStockNombre.toLowerCase()} (de stock): ${formatearMonto(porUS)}.`}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-sm font-semibold" data-testid="total-de-la-compra">
            Total: {formatearMonto(totalDeLaCompra)}
          </p>
          {avisosDeCero.map((aviso) => (
            <Aviso key={aviso} variante="advertencia" forma="en-linea">
              {aviso}
            </Aviso>
          ))}
        </div>
      )}

      {errorAca && errorAca.fila === undefined && (
        <Aviso variante="error" forma="en-linea">
          {errorAca.mensaje}
        </Aviso>
      )}

      <div className="flex flex-wrap gap-3">
        {paso !== "FACTURA" && (
          <Boton variante="secundario" onClick={() => irA(pasoAnterior(paso))} disabled={pending}>
            Anterior
          </Boton>
        )}
        {paso !== "REVISAR" ? (
          <Boton onClick={siguiente} disabled={pending}>
            Siguiente
          </Boton>
        ) : (
          <Boton onClick={confirmar} disabled={pending}>
            {pending ? "Guardando..." : "Confirmar compra"}
          </Boton>
        )}
      </div>
    </form>
  );
}
