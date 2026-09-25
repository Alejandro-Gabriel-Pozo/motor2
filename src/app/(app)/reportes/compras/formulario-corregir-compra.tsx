"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { corregirCompra, type CabeceraVista } from "@/server/actions/movimientos/compras";
import { LARGO_MAXIMO_NRO_FACTURA } from "@/core/texto";

interface OpcionProveedor {
  id: string;
  nombre: string;
  activo: boolean;
}

/**
 * «Corregir proveedor y factura» del detalle de una compra registrada (K1b). Corrige solo la CABECERA (proveedor, N.º de factura y detalle): las líneas
 * (precios y cantidades) no se tocan, y un precio mal cargado se arregla anulando la compra y cargándola de nuevo. El formulario lo dice para que nadie lo
 * busque acá.
 *
 * Teclado y lector de pantalla: al abrir, el foco va al primer campo; Escape cancela y el foco vuelve al botón que lo abrió; cada campo lleva su
 * `<label>`; un rechazo del servidor (factura repetida, la compra cambió mientras se editaba, etc.) queda a la vista con `role="alert"`; y al guardarse el
 * aviso de éxito (`role="status"`) recibe el foco, porque el formulario desaparece.
 *
 * Guarda optimista: al abrir se guarda lo que la persona VE (`esperado`) y se envía con la corrección; si otra persona la corrigió mientras tanto, el
 * servidor no la pisa en silencio y lo avisa. Este componente sigue montado después de guardar (recibe la compra ya refrescada) para dejar el aviso de éxito.
 */
export function FormularioCorregirCompra({
  idOperacion,
  resumen,
  proveedores,
  actual,
}: {
  idOperacion: string;
  /** Identifica de cuál se trata cuando hay muchos botones iguales en la página (ej. «del 2026-09-21 a Molino SA, factura A-1»). */
  resumen: string;
  proveedores: OpcionProveedor[];
  actual: CabeceraVista;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [esperado, setEsperado] = useState<CabeceraVista>(actual);
  const [proveedorId, setProveedorId] = useState(actual.proveedorId ?? "");
  const [nroFactura, setNroFactura] = useState(actual.nroFactura ?? "");
  const [detalleLibre, setDetalleLibre] = useState(actual.detalleLibre ?? "");
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const idBase = useId();
  const botonAbrir = useRef<HTMLButtonElement>(null);
  const primerCampo = useRef<HTMLSelectElement>(null);
  const avisoDeExito = useRef<HTMLParagraphElement>(null);
  const volverAlBoton = useRef(false);

  useEffect(() => {
    if (abierto) {
      primerCampo.current?.focus();
    } else if (volverAlBoton.current) {
      volverAlBoton.current = false;
      botonAbrir.current?.focus();
    }
  }, [abierto]);

  useEffect(() => {
    if (exito) avisoDeExito.current?.focus();
  }, [exito]);

  // El proveedor actual siempre está entre las opciones (aunque hoy esté inactivo); el resto, solo los activos.
  const opciones = proveedores.filter((p) => p.activo || p.id === actual.proveedorId);
  const hayCambios = (proveedorId || null) !== (esperado.proveedorId ?? null) || nroFactura.trim() !== (esperado.nroFactura ?? "") || detalleLibre.trim() !== (esperado.detalleLibre ?? "");

  function abrir() {
    // Lo que se ve hoy es lo que se envía como «esperado»: la guarda contra pisar la corrección de otra persona.
    setEsperado(actual);
    setProveedorId(actual.proveedorId ?? "");
    setNroFactura(actual.nroFactura ?? "");
    setDetalleLibre(actual.detalleLibre ?? "");
    setError(null);
    setExito(null);
    setAbierto(true);
  }

  function cancelar() {
    volverAlBoton.current = true;
    setAbierto(false);
    setError(null);
  }

  function guardar() {
    startTransition(async () => {
      const r = await corregirCompra(idOperacion, { proveedorId: proveedorId || null, nroFactura, detalleLibre }, esperado);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      setError(null);
      setExito(r.mensaje);
      setAbierto(false);
      router.refresh();
    });
  }

  if (!abierto) {
    return (
      <div className="flex flex-col gap-1">
        <button ref={botonAbrir} type="button" aria-label={`Corregir proveedor y factura ${resumen}`} onClick={abrir} className="self-start text-sm underline">
          Corregir proveedor y factura
        </button>
        {exito && (
          <p ref={avisoDeExito} tabIndex={-1} role="status" className="text-sm text-green-700">
            {exito}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        guardar();
      }}
      onKeyDown={(evento) => {
        if (evento.key === "Escape") cancelar();
      }}
      className="flex max-w-md flex-col gap-2 rounded border p-3"
    >
      <p className="text-xs text-neutral-500">
        Se corrige solo la cabecera de la compra. Para cambiar precios o cantidades, anulá la compra y cargala de nuevo.
      </p>
      {/* El <label> va AL LADO del control, no envolviéndolo: un label que envuelve un <select> o un <input> suma a su nombre accesible el valor
          actual del control («Proveedor Sin proveedor»), y el nombre deja de ser el rótulo. */}
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${idBase}-proveedor`}>Proveedor</label>
        <select id={`${idBase}-proveedor`} ref={primerCampo} value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className="rounded border px-2 py-1.5">
          <option value="">Sin proveedor</option>
          {opciones.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
              {p.activo ? "" : " (inactivo)"}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${idBase}-factura`}>N.º de factura</label>
        <input id={`${idBase}-factura`} value={nroFactura} onChange={(e) => setNroFactura(e.target.value)} maxLength={LARGO_MAXIMO_NRO_FACTURA} className="rounded border px-2 py-1.5" />
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${idBase}-detalle`}>Detalle</label>
        <input id={`${idBase}-detalle`} value={detalleLibre} onChange={(e) => setDetalleLibre(e.target.value)} maxLength={200} className="rounded border px-2 py-1.5" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button type="submit" disabled={pending || !hayCambios} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {pending ? "Guardando…" : "Guardar corrección"}
        </button>
        <button type="button" disabled={pending} onClick={cancelar} className="text-sm underline">
          Cancelar
        </button>
      </div>
    </form>
  );
}
