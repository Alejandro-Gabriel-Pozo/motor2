"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { aceptarPropuestaDeFactura, confirmarRecepcionDeFactura } from "@/server/actions/movimientos/facturas-proveedor";
import { ZONA_ARGENTINA, mediodiaDelDia } from "@/core/tiempo/zona-horaria";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Selector } from "@/ui/primitivas/selector";
import { CampoFecha } from "@/ui/componentes/selectores/campo-fecha";
import { formatearCantidad } from "@/core/formato-de-numero";

/**
 * E3a (ADR-041): «Para aceptar», las partes de facturas de proveedor que otra sucursal compró para ESTA sucursal. Muestra solo productos y cantidades (decisión del dueño, 2026-10-28: nada de importes ni de
 * partes de otras sucursales). Al aceptar se elige la sección y la fecha de stock (por defecto la de la factura; entre esa fecha y hoy): recién ahí entran el stock, el costo y el gasto de esta sucursal.
 */
export interface PropuestaVista {
  id: string;
  proveedorNombre: string;
  nroFactura: string | null;
  /** Día de la factura (AAAA-MM-DD, hora argentina). */
  diaFactura: string;
  origenNombre: string;
  /** Días desde que la propusieron. */
  antiguedadDias: number;
  renglones: { productoNombre: string; unidadNombre: string; cantidadStock: number }[];
}

function TarjetaDePropuesta({ propuesta, secciones }: { propuesta: PropuestaVista; secciones: { id: string; nombre: string }[] }) {
  const router = useRouter();
  const [seccionId, setSeccionId] = useState(secciones[0]?.id ?? "");
  const [dia, setDia] = useState(propuesta.diaFactura);
  const [clave, setClave] = useState(() => crypto.randomUUID());
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const aceptar = () =>
    startTransition(async () => {
      const r = await aceptarPropuestaDeFactura(propuesta.id, seccionId, mediodiaDelDia(dia, ZONA_ARGENTINA), clave);
      setMensaje({ ok: r.ok, texto: r.mensaje });
      if (r.ok) {
        setClave(crypto.randomUUID());
        router.refresh();
      }
    });

  return (
    <li className="flex flex-col gap-2 rounded border p-3" data-testid="propuesta-para-aceptar">
      <p className="text-sm">
        <strong>{propuesta.proveedorNombre}</strong>
        {propuesta.nroFactura ? ` · Factura ${propuesta.nroFactura}` : ""} · del {propuesta.diaFactura} · la compró «{propuesta.origenNombre}»
        {propuesta.antiguedadDias > 0 ? ` · hace ${propuesta.antiguedadDias} día(s)` : " · hoy"}
      </p>
      <ul className="list-disc pl-5 text-sm">
        {propuesta.renglones.map((r, i) => (
          <li key={i}>
            {r.productoNombre}: {formatearCantidad(r.cantidadStock)} {r.unidadNombre}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-52">
          <Selector etiqueta="Depósito" tamano="compacto" value={seccionId} onChange={(e) => setSeccionId(e.target.value)}>
            {secciones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </Selector>
        </div>
        <div className="w-44">
          <CampoFecha etiqueta="Fecha de stock" tamano="compacto" value={dia} onChange={(e) => setDia(e.target.value)} />
        </div>
        <Boton tamano="compacto" onClick={aceptar} disabled={pending || !seccionId}>
          {pending ? "Aceptando..." : "Aceptar"}
        </Boton>
      </div>
      {mensaje && (
        <Aviso variante={mensaje.ok ? "exito" : "error"} forma="en-linea">
          {mensaje.texto}
        </Aviso>
      )}
    </li>
  );
}

export function BandejaParaAceptar({ propuestas, secciones }: { propuestas: PropuestaVista[]; secciones: { id: string; nombre: string }[] }) {
  if (!propuestas.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="titulo-para-aceptar">
      <h2 id="titulo-para-aceptar" className="text-lg font-semibold">
        Para aceptar ({propuestas.length})
      </h2>
      <p className="text-xs text-tinta-tenue">Mercadería que otra sucursal compró para esta. Hasta que la aceptes no cuenta en el stock ni en el gasto de esta sucursal.</p>
      <ul className="flex flex-col gap-2">
        {propuestas.map((p) => (
          <TarjetaDePropuesta key={p.id} propuesta={p} secciones={secciones} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Compras, recepción separada (N3-a): una compra cargada «pendiente de recibir» (módulo `recepcion_de_compras` encendido): todavía no entró al stock. La ve quien tiene `compra_recibir` (gerente o administrador), sin importes. Al confirmar se elige la sección (depósito) y la fecha de stock (por defecto la de la factura; entre esa fecha y hoy): recién ahí entran el stock, el costo y el gasto.
 */
export interface CompraPorRecibirVista {
  facturaId: string;
  proveedorNombre: string;
  nroFactura: string | null;
  /** Día de la factura (AAAA-MM-DD, hora argentina). */
  diaFactura: string;
  cantidadDeRenglones: number;
  /** Días desde que se cargó. */
  antiguedadDias: number;
}

function TarjetaDeCompraPorRecibir({ compra, secciones }: { compra: CompraPorRecibirVista; secciones: { id: string; nombre: string }[] }) {
  const router = useRouter();
  const [seccionId, setSeccionId] = useState(secciones[0]?.id ?? "");
  const [dia, setDia] = useState(compra.diaFactura);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const confirmar = () =>
    startTransition(async () => {
      const r = await confirmarRecepcionDeFactura(compra.facturaId, seccionId, mediodiaDelDia(dia, ZONA_ARGENTINA));
      setMensaje({ ok: r.ok, texto: r.mensaje });
      // Con éxito la compra sale de la lista (ya no está pendiente); si ya estaba recibida o anulada, también: se refresca para verlo.
      router.refresh();
    });

  return (
    <li className="flex flex-col gap-2 rounded border p-3" data-testid="compra-por-recibir">
      <p className="text-sm">
        <strong>{compra.proveedorNombre}</strong>
        {compra.nroFactura ? ` · Factura ${compra.nroFactura}` : ""} · del {compra.diaFactura} · {compra.cantidadDeRenglones} renglón(es)
        {compra.antiguedadDias > 0 ? ` · cargada hace ${compra.antiguedadDias} día(s)` : " · cargada hoy"}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-52">
          <Selector etiqueta="Depósito" tamano="compacto" value={seccionId} onChange={(e) => setSeccionId(e.target.value)}>
            {secciones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </Selector>
        </div>
        <div className="w-44">
          <CampoFecha etiqueta="Fecha de stock" tamano="compacto" value={dia} onChange={(e) => setDia(e.target.value)} />
        </div>
        <Boton tamano="compacto" onClick={confirmar} disabled={pending || !seccionId}>
          {pending ? "Confirmando..." : "Confirmar recepción"}
        </Boton>
      </div>
      {mensaje && (
        <Aviso variante={mensaje.ok ? "exito" : "error"} forma="en-linea">
          {mensaje.texto}
        </Aviso>
      )}
    </li>
  );
}

export function BandejaPorRecibir({ compras, secciones }: { compras: CompraPorRecibirVista[]; secciones: { id: string; nombre: string }[] }) {
  if (!compras.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="titulo-por-recibir">
      <h2 id="titulo-por-recibir" className="text-lg font-semibold">
        Por recibir ({compras.length})
      </h2>
      <p className="text-xs text-tinta-tenue">Compras cargadas que todavía no entraron al stock. Confirmá la recepción cuando llegue la mercadería: ahí entra al depósito que elijas.</p>
      <ul className="flex flex-col gap-2">
        {compras.map((c) => (
          <TarjetaDeCompraPorRecibir key={c.facturaId} compra={c} secciones={secciones} />
        ))}
      </ul>
    </section>
  );
}
