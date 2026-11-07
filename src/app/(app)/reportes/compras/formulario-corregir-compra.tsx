"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { corregirFacturaProveedor, type CabeceraVista } from "@/server/actions/movimientos/facturas-proveedor";
import { CampoNumeroDeComprobante } from "@/components/campo-numero-de-comprobante";
import { PARTES_DE_NUMERO_VACIAS, estadoDelNumeroTecleado, partesDeNumeroGuardado, type PartesDeNumeroDeComprobante } from "@/core/datos/numero-comprobante";
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
 * «Corregir datos» del detalle de una compra registrada (K1b; desde U1 de «una sola compra» corrige la FACTURA entera, con todas sus partes). Corrige solo la CABECERA (proveedor, N.º de factura y detalle): las líneas
 * (precios y cantidades) no se tocan, y un precio mal cargado se arregla anulando la factura y cargándola de nuevo. El formulario lo dice para que nadie lo
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
  idFactura,
  resumen,
  proveedores,
  actual,
}: {
  /** La factura (la compra completa, con todas sus partes) cuyos datos se corrigen. */
  idFactura: string;
  /** Identifica de cuál se trata cuando hay muchos botones iguales en la página (ej. «del 2026-09-21 a Molino SA, factura A-1»). */
  resumen: string;
  proveedores: OpcionProveedor[];
  actual: CabeceraVista;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [esperado, setEsperado] = useState<CabeceraVista>(actual);
  const [proveedorId, setProveedorId] = useState(actual.proveedorId ?? "");
  // El número va en tres campos (letra, punto de venta y número). Una compra vieja con texto libre muestra «Número cargado antes: …» y los campos vacíos: si no se tocan, se manda el texto tal cual.
  const [numero, setNumero] = useState<PartesDeNumeroDeComprobante>(partesDeNumeroGuardado(actual.nroFactura) ?? PARTES_DE_NUMERO_VACIAS);
  const [intentoGuardar, setIntentoGuardar] = useState(false);
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
  const numeroSinTocar = numero.letra === "" && numero.puntoDeVenta === "" && numero.numero === "";
  const numeroTecleado = estadoDelNumeroTecleado(numero);
  // Sin tocar los tres campos se manda el número guardado tal cual; tocados, el armado («A-00023-00237728»).
  const guardado = estadoDelNumeroTecleado(partesDeNumeroGuardado(esperado.nroFactura) ?? PARTES_DE_NUMERO_VACIAS);
  const mismoQueElGuardado = numeroTecleado.tipo === "valido" && guardado.tipo === "valido" && guardado.numero === numeroTecleado.numero;
  const nroFactura = numeroSinTocar || mismoQueElGuardado ? (esperado.nroFactura ?? "") : numeroTecleado.tipo === "valido" ? numeroTecleado.numero : "";
  const hayCambios = (proveedorId || null) !== (esperado.proveedorId ?? null) || nroFactura.trim() !== (esperado.nroFactura ?? "") || detalleLibre.trim() !== (esperado.detalleLibre ?? "");
  const numeroViejoDeTextoLibre = esperado.nroFactura && partesDeNumeroGuardado(esperado.nroFactura) === null ? esperado.nroFactura : null;

  function abrir() {
    // Lo que se ve hoy es lo que se envía como «esperado»: la guarda contra pisar la corrección de otra persona.
    setEsperado(actual);
    setProveedorId(actual.proveedorId ?? "");
    setNumero(partesDeNumeroGuardado(actual.nroFactura) ?? PARTES_DE_NUMERO_VACIAS);
    setIntentoGuardar(false);
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
    if (!proveedorId) {
      setError("Elegí el proveedor.");
      return;
    }
    // Con el número a medias no se guarda: se dice qué falta (el servidor revalida igual).
    if (!numeroSinTocar && numeroTecleado.tipo !== "valido") {
      setIntentoGuardar(true);
      setError(null);
      return;
    }
    startTransition(async () => {
      const r = await corregirFacturaProveedor(idFactura, { proveedorId: proveedorId || null, nroFactura, detalleLibre }, esperado);
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
      <Selector id={`${idBase}-proveedor`} ref={primerCampo} etiqueta="Proveedor" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} required>
        <option value="">Elegí el proveedor</option>
        {opciones.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
            {p.activo ? "" : " (inactivo)"}
          </option>
        ))}
      </Selector>
      {numeroViejoDeTextoLibre && <p className="text-xs text-tinta-tenue">Número cargado antes: {numeroViejoDeTextoLibre}. Si no lo cambiás, queda tal cual.</p>}
      <CampoNumeroDeComprobante etiqueta="N.º de factura" partes={numero} onCambio={setNumero} mostrarErrores={intentoGuardar && !numeroSinTocar} />
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
