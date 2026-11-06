"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { registrarNotaSueltaDeProveedor } from "@/server/actions/movimientos/notas-de-credito-proveedor";
import { CampoNumeroDeComprobante } from "@/components/campo-numero-de-comprobante";
import { PARTES_DE_NUMERO_VACIAS, type PartesDeNumeroDeComprobante } from "@/core/datos/numero-comprobante";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";

interface RenglonParaNota {
  idMovimiento: string;
  producto: string;
  cantidad: number;
  unidad: string;
  precioTotal: number;
}

const plata = (n: number) => `$${n.toLocaleString("es-AR")}`;

/**
 * MAQUETA (rama temporal, no se mergea): «Cargar nota de crédito del proveedor» en el detalle de una compra (NC0 «solo dinero», docs/diseno-notas-de-credito-de-proveedor-2026-11-04.md). Por cada renglón de la
 * factura se escribe cuánto acredita el proveedor (con IVA) y, si se quiere, cuántas unidades. Dice lo que NO hace: no mueve el stock (la devolución física se registra aparte) y la aplicación al pago está
 * «pendiente de completar».
 */
export function FormularioNotaCredito({ idOperacion, nroFactura, renglones, hoy }: { idOperacion: string; nroFactura: string | null; renglones: RenglonParaNota[]; hoy: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [numero, setNumero] = useState<PartesDeNumeroDeComprobante>({ ...PARTES_DE_NUMERO_VACIAS, letra: "A" });
  const [dia, setDia] = useState(hoy);
  const [motivo, setMotivo] = useState(nroFactura ? `Devolución de mercadería — factura ${nroFactura}` : "Devolución de mercadería");
  const [lineas, setLineas] = useState(renglones.map((r) => ({ movimientoId: r.idMovimiento, cantidad: "", importe: "" })));
  const [clave] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = lineas.reduce((suma, l) => suma + (Number(l.importe.replace(",", ".")) || 0), 0);

  function guardar() {
    startTransition(async () => {
      const r = await registrarNotaSueltaDeProveedor({ operacionId: idOperacion, nota: numero, dia, motivo, renglones: lineas, claveIdempotencia: clave });
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
        <Boton variante="enlace" tamano="en-fila" onClick={() => setAbierto(true)} className="self-start">
          Cargar nota de crédito del proveedor
        </Boton>
        {exito && <Aviso variante="exito">{exito}</Aviso>}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        guardar();
      }}
      className="flex max-w-xl flex-col gap-3 rounded border p-3"
    >
      <p className="text-xs text-tinta-tenue">
        Registra el documento con que el proveedor te acredita plata. <strong>No cambia el stock ni el costo</strong>: si devolviste mercadería, esa devolución se registra aparte (Movimientos → Devolución a proveedor).
      </p>
      <CampoNumeroDeComprobante etiqueta="N.º de la nota de crédito" partes={numero} onCambio={setNumero} mostrarErrores={false} />
      <Campo etiqueta="Fecha de la nota" type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">¿Qué renglones acredita? (dejá en blanco lo que no)</legend>
        {renglones.map((r, i) => (
          <div key={r.idMovimiento} className="flex flex-col gap-1 rounded bg-papel px-2 py-2">
            <span className="text-sm font-medium">
              {r.producto} <span className="font-normal text-tinta-tenue">· comprado {r.cantidad.toLocaleString("es-AR")} {r.unidad} por {plata(r.precioTotal)}</span>
            </span>
            <div className="flex gap-2">
              <Campo
                etiqueta={`Unidades devueltas de ${r.producto}`}
                tamano="compacto"
                inputMode="decimal"
                value={lineas[i].cantidad}
                onChange={(e) => setLineas(lineas.map((l, j) => (j === i ? { ...l, cantidad: e.target.value } : l)))}
              />
              <Campo
                etiqueta={`Importe que acredita de ${r.producto} (con IVA)`}
                tamano="compacto"
                inputMode="decimal"
                prefijo="$"
                alinear="fin"
                value={lineas[i].importe}
                onChange={(e) => setLineas(lineas.map((l, j) => (j === i ? { ...l, importe: e.target.value } : l)))}
              />
            </div>
          </div>
        ))}
      </fieldset>
      <Campo etiqueta="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
      <div className="flex items-baseline justify-between rounded bg-papel px-3 py-2">
        <span className="text-sm font-semibold">Total que acredita la nota</span>
        <span className="text-lg font-extrabold tabular-nums" data-total-nota>
          {plata(Math.round(total * 100) / 100)}
        </span>
      </div>
      <p className="text-xs text-tinta-tenue">Aplicación al pago de la factura: pendiente de completar (todavía no hay cuenta corriente con el proveedor).</p>
      {error && <Aviso variante="error">{error}</Aviso>}
      <div className="flex items-center gap-3">
        <Boton type="submit" tamano="compacto" disabled={pending || total <= 0}>
          {pending ? "Guardando…" : "Registrar la nota de crédito"}
        </Boton>
        <Boton variante="enlace" tamano="en-fila" disabled={pending} onClick={() => setAbierto(false)}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}
