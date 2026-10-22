"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { corregirCompra, type CabeceraVista } from "@/server/actions/movimientos/compras";
import { LARGO_MAXIMO_NRO_FACTURA } from "@/core/texto";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";

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
 * Teclado y lector de pantalla: al abrir, el foco va al primer campo; Escape cancela y el foco vuelve al botón que lo abrió (`Boton` no recibe `ref`: se busca
 * por `id`); cada campo lleva su `<label>` (`Selector` y `Campo` lo atan con `htmlFor`, AL LADO del control: uno que lo envuelve suma el valor actual a su nombre
 * accesible); un rechazo del servidor (factura repetida, la compra cambió mientras se editaba, etc.) queda a la vista con `role="alert"` (`Aviso` de error); y al
 * guardarse el aviso de éxito (`role="status"`, `Aviso` de éxito) recibe el foco, porque el formulario desaparece.
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
  const idBotonAbrir = `${idBase}-abrir`;
  const primerCampo = useRef<HTMLSelectElement>(null);
  const avisoDeExito = useRef<HTMLDivElement>(null);
  const volverAlBoton = useRef(false);

  useEffect(() => {
    if (abierto) {
      primerCampo.current?.focus();
    } else if (volverAlBoton.current) {
      volverAlBoton.current = false;
      document.getElementById(idBotonAbrir)?.focus();
    }
  }, [abierto, idBotonAbrir]);

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
        <Boton id={idBotonAbrir} variante="enlace" tamano="en-fila" aria-label={`Corregir proveedor y factura ${resumen}`} onClick={abrir} className="self-start">
          Corregir proveedor y factura
        </Boton>
        {exito && (
          <Aviso ref={avisoDeExito} tabIndex={-1} variante="exito">
            {exito}
          </Aviso>
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
      <p className="text-xs text-tinta-tenue">
        Se corrige solo la cabecera de la compra. Para cambiar precios o cantidades, anulá la compra y cargala de nuevo.
      </p>
      <Selector id={`${idBase}-proveedor`} ref={primerCampo} etiqueta="Proveedor" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
        <option value="">Sin proveedor</option>
        {opciones.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
            {p.activo ? "" : " (inactivo)"}
          </option>
        ))}
      </Selector>
      <Campo id={`${idBase}-factura`} etiqueta="N.º de factura" value={nroFactura} onChange={(e) => setNroFactura(e.target.value)} maxLength={LARGO_MAXIMO_NRO_FACTURA} />
      <Campo id={`${idBase}-detalle`} etiqueta="Detalle" value={detalleLibre} onChange={(e) => setDetalleLibre(e.target.value)} maxLength={200} />
      {error && (
        <Aviso variante="error">
          {error}
        </Aviso>
      )}
      <div className="flex items-center gap-3">
        <Boton type="submit" tamano="compacto" disabled={pending || !hayCambios}>
          {pending ? "Guardando…" : "Guardar corrección"}
        </Boton>
        <Boton variante="enlace" tamano="en-fila" disabled={pending} onClick={cancelar}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}
