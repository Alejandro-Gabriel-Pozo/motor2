"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { anularOrdenDeCompra, cerrarOrdenDeCompra, configurarControlDeExceso, crearOrdenDeCompra, pedirOrdenDeCompra } from "@/server/actions/movimientos/ordenes-de-compra";
import type { OrdenParaMostrar } from "@/server/consultas/movimientos/ordenes-de-compra";
import { ETIQUETA_DE_AVANCE_DE_RECEPCION, ETIQUETA_DE_ESTADO_DE_ORDEN, ETIQUETA_DE_MOTIVO_DE_CIERRE, ETIQUETA_DE_NIVEL_DE_CONTROL, NIVELES_DE_CONTROL, type NivelDeControl } from "@/core/compras/public";
import { formatearCantidad, formatearMonto } from "@/core/pos/public";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoNumero } from "@/components/campo-numero";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";
import { CampoFecha } from "@/ui/componentes/selectores/campo-fecha";

/**
 * Compras, orden de compra (etapa OC): crear (BORRADOR), pedir, cerrar y anular una orden, y el nivel del control de exceso. La pantalla solo muestra lo que el servidor deja hacer (cada acción vuelve a exigir su permiso y su módulo). Una orden nace sin
 * nada tildado y sin precio: lo que no se escribe queda vacío («sin precio»). Anular pide un motivo escrito. Los textos son literales de esta etapa.
 */
interface Opcion {
  id: string;
  nombre: string;
}

interface FilaDeLinea {
  productoId: string;
  cantidad: string;
  precio: string;
}

const LINEA_VACIA: FilaDeLinea = { productoId: "", cantidad: "", precio: "" };

export function PanelOrdenesDeCompra({
  ordenes,
  puedeGestionar,
  puedeConfigurar,
  nivelDelControl,
  proveedores,
  sucursalActiva,
  hoy,
}: {
  ordenes: OrdenParaMostrar[];
  puedeGestionar: boolean;
  puedeConfigurar: boolean;
  nivelDelControl: NivelDeControl;
  proveedores: Opcion[];
  sucursalActiva: Opcion;
  hoy: string;
}) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const enviando = useRef(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [claveIdempotencia, setClaveIdempotencia] = useState(() => crypto.randomUUID());
  const [proveedorId, setProveedorId] = useState("");
  const [destino, setDestino] = useState("");
  const [entrega, setEntrega] = useState("");
  const [lineas, setLineas] = useState<FilaDeLinea[]>([{ ...LINEA_VACIA }]);
  const [versionLineas, setVersionLineas] = useState(0);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [nivel, setNivel] = useState<NivelDeControl>(nivelDelControl);

  const correr = (accion: () => Promise<{ ok: boolean; mensaje: string }>, alExito?: () => void) => {
    if (enviando.current) return;
    enviando.current = true;
    empezar(async () => {
      try {
        const r = await accion();
        setMensaje({ ok: r.ok, texto: r.mensaje });
        if (r.ok) {
          alExito?.();
          router.refresh();
        }
      } finally {
        enviando.current = false;
      }
    });
  };

  const actualizarLinea = (i: number, cambios: Partial<FilaDeLinea>) => setLineas((prev) => prev.map((l, k) => (k === i ? { ...l, ...cambios } : l)));

  const guardar = () =>
    correr(
      () =>
        crearOrdenDeCompra({
          proveedorId,
          sucursalId: destino || null,
          fechaDeEntregaPrevista: entrega || null,
          lineas: lineas
            .filter((l) => l.productoId || l.cantidad !== "")
            .map((l) => ({ productoId: l.productoId, cantidad: numeroDelCampo(l.cantidad) ?? Number.NaN, precio: numeroDelCampo(l.precio) ?? null })),
          claveIdempotencia,
        }),
      () => {
        setProveedorId("");
        setDestino("");
        setEntrega("");
        setLineas([{ ...LINEA_VACIA }]);
        setVersionLineas((n) => n + 1);
        setClaveIdempotencia(crypto.randomUUID());
      }
    );

  return (
    <div className="flex flex-col gap-6" data-testid="ordenes-de-compra">
      {mensaje && (
        <Aviso variante={mensaje.ok ? "exito" : "error"} forma="en-linea">
          {mensaje.texto}
        </Aviso>
      )}

      {puedeConfigurar && (
        <section className="flex flex-col gap-2 rounded border p-3" aria-labelledby="titulo-control-exceso">
          <h2 id="titulo-control-exceso" className="text-lg font-semibold">
            Recibir más de lo pedido
          </h2>
          <p className="text-sm text-tinta-tenue">Qué pasa cuando se recibe, contra una orden, más de lo que se pidió. Si no lo configurás, se permite.</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-48">
              <Selector etiqueta="Nivel del control" value={nivel} onChange={(e) => setNivel(e.target.value as NivelDeControl)}>
                {NIVELES_DE_CONTROL.map((n) => (
                  <option key={n} value={n}>
                    {ETIQUETA_DE_NIVEL_DE_CONTROL[n]}
                  </option>
                ))}
              </Selector>
            </div>
            <Boton onClick={() => correr(() => configurarControlDeExceso(nivel))} disabled={pendiente}>
              Guardar nivel
            </Boton>
          </div>
        </section>
      )}

      {puedeGestionar && (
        <section className="flex flex-col gap-3 rounded border p-3" aria-labelledby="titulo-nueva-orden">
          <h2 id="titulo-nueva-orden" className="text-lg font-semibold">
            Nueva orden de compra
          </h2>
          <Selector etiqueta="Proveedor" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} required>
            <option value="">Elegí el proveedor</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Selector>
          <Selector etiqueta="Sucursal destino (opcional)" value={destino} onChange={(e) => setDestino(e.target.value)}>
            <option value="">Toda la empresa</option>
            <option value={sucursalActiva.id}>{sucursalActiva.nombre}</option>
          </Selector>
          <div className="max-w-52">
            <CampoFecha etiqueta="Entrega prevista (opcional)" value={entrega} min={hoy} onChange={(e) => setEntrega(e.target.value)} />
          </div>
          {lineas.map((l, i) => (
            <div key={`${versionLineas}-${i}`} className="flex flex-wrap items-end gap-2 rounded border p-2" data-testid="linea-de-orden">
              <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
                <span className="font-medium">Producto</span>
                <SelectorProducto value={l.productoId} onChange={(id) => actualizarLinea(i, { productoId: id })} filtro={{ soloDisponibles: true, tipo: "MP" }} required />
              </label>
              <label className="flex w-28 flex-col gap-1 text-sm">
                <span className="font-medium">Cantidad</span>
                <CampoNumero tipo="cantidad" value={l.cantidad} onChange={(v) => actualizarLinea(i, { cantidad: v })} tamano="compacto" />
              </label>
              <label className="flex w-36 flex-col gap-1 text-sm">
                <span className="font-medium">Precio por unidad (opcional)</span>
                <CampoNumero value={l.precio} onChange={(v) => actualizarLinea(i, { precio: v })} prefijo="$" tamano="compacto" tipo="importe" etiqueta="El precio" />
              </label>
              <Boton
                variante="secundario"
                tamano="compacto"
                onClick={() => {
                  setLineas((prev) => (prev.length > 1 ? prev.filter((_, k) => k !== i) : prev));
                  setVersionLineas((n) => n + 1);
                }}
                disabled={lineas.length === 1}
              >
                Quitar
              </Boton>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Boton variante="enlace" tamano="en-fila" onClick={() => setLineas((prev) => [...prev, { ...LINEA_VACIA }])}>
              + Agregar producto
            </Boton>
            <Boton onClick={guardar} disabled={pendiente}>
              Guardar borrador
            </Boton>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="titulo-lista-ordenes">
        <h2 id="titulo-lista-ordenes" className="text-lg font-semibold">
          Órdenes
        </h2>
        {ordenes.length === 0 && <p className="text-sm text-tinta-tenue">Todavía no hay órdenes de compra.</p>}
        {ordenes.map((o) => (
          <article key={o.id} className="flex flex-col gap-2 rounded border p-3" data-testid="orden-de-compra">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-semibold">{o.numero ? `N.º ${o.numero}` : "Sin número"}</h3>
              <span className="text-sm">{ETIQUETA_DE_ESTADO_DE_ORDEN[o.estado]}</span>
              {o.avance && o.estado === "PEDIDA" && <span className="text-sm">{ETIQUETA_DE_AVANCE_DE_RECEPCION[o.avance]}</span>}
              {o.estado === "CERRADA" && o.cierreMotivo && <span className="text-sm">{ETIQUETA_DE_MOTIVO_DE_CIERRE[o.cierreMotivo]}</span>}
              <span className="text-sm text-tinta-tenue">
                {o.proveedorNombre} · {o.sucursalNombre ?? "Toda la empresa"}
                {o.fechaDeEntregaPrevista ? ` · entrega ${o.fechaDeEntregaPrevista}` : ""}
              </span>
            </header>
            <ul className="flex flex-col gap-1 text-sm">
              {o.lineas
                .filter((l) => !l.retirada)
                .map((l) => (
                  <li key={l.numero}>
                    {l.productoNombre}: {formatearCantidad(l.cantidadPedida)} {l.unidadNombre.toLowerCase()}
                    {l.cantidadRecibida !== null ? ` (recibido ${formatearCantidad(l.cantidadRecibida)})` : ""}
                    {l.precioPorUnidadStock !== undefined ? (l.precioPorUnidadStock === null ? " · sin precio" : ` · ${formatearMonto(l.precioPorUnidadStock)} por unidad`) : ""}
                  </li>
                ))}
            </ul>
            {o.estado === "ANULADA" && o.motivoDeAnulacion && <p className="text-sm text-tinta-tenue">Motivo de la anulación: {o.motivoDeAnulacion}</p>}
            {puedeGestionar && (o.estado === "BORRADOR" || o.estado === "PEDIDA") && (
              <div className="flex flex-wrap items-end gap-2">
                {o.estado === "BORRADOR" && (
                  <Boton onClick={() => correr(() => pedirOrdenDeCompra(o.id))} disabled={pendiente}>
                    Pedir
                  </Boton>
                )}
                {o.estado === "PEDIDA" && (
                  <Boton onClick={() => correr(() => cerrarOrdenDeCompra(o.id))} disabled={pendiente}>
                    Cerrar
                  </Boton>
                )}
                {anulando === o.id ? (
                  <>
                    <div className="min-w-56 flex-1">
                      <Campo etiqueta="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} required />
                    </div>
                    <Boton
                      variante="secundario"
                      onClick={() =>
                        correr(
                          () => anularOrdenDeCompra(o.id, motivo),
                          () => {
                            setAnulando(null);
                            setMotivo("");
                          }
                        )
                      }
                      disabled={pendiente}
                    >
                      Confirmar anulación
                    </Boton>
                    <Boton variante="enlace" tamano="en-fila" onClick={() => setAnulando(null)}>
                      Cancelar
                    </Boton>
                  </>
                ) : (
                  <Boton variante="secundario" onClick={() => setAnulando(o.id)}>
                    Anular
                  </Boton>
                )}
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
