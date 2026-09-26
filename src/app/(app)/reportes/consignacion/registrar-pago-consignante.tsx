"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { CampoNumero } from "@/components/campo-numero";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { registrarPagoConsignante } from "@/server/actions/reportes/consignacion";

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export function RegistrarPagoConsignante({ proveedorId, proveedorNombre, saldoActual }: { proveedorId: string; proveedorNombre: string; saldoActual: number }) {
  const router = useRouter();
  const [importe, setImporte] = useState(saldoActual > 0 ? String(saldoActual) : "");
  const [fecha, setFecha] = useState(hoyISO());
  const [notas, setNotas] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Modal triggerLabel="Registrar pago" title={`Pago a "${proveedorNombre}"`}>
      {(cerrar) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              // numeroDelCampo: un texto inválido llega como NaN y el servidor lo rechaza; nunca el 0 que daba convertir un texto vacío.
              const resultado = await registrarPagoConsignante(proveedorId, numeroDelCampo(importe) ?? Number.NaN, new Date(fecha), notas || undefined);
              setMensaje(resultado.mensaje);
              if (resultado.ok) {
                router.refresh();
                cerrar();
              }
            });
          }}
          className="flex flex-col gap-2"
        >
          <label className="text-sm">
            Importe
            <CampoNumero value={importe} onChange={setImporte} prefijo="$" required tipo="importe" etiqueta="El importe" />
          </label>
          <label className="text-sm">
            Fecha
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required className="mt-1 w-full rounded border px-3 py-2" />
          </label>
          <label className="text-sm">
            Notas (opcional)
            <input value={notas} onChange={(e) => setNotas(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </label>
          {mensaje && <p className="text-sm text-red-600">{mensaje}</p>}
          <button type="submit" disabled={pending} className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
            {pending ? "Guardando..." : "Registrar pago"}
          </button>
        </form>
      )}
    </Modal>
  );
}
