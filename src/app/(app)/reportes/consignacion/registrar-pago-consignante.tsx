"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { CampoNumero } from "@/components/campo-numero";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { ZONA_ARGENTINA, diaDeCalendario, mediodiaDelDia } from "@/core/tiempo/zona-horaria";
import { registrarPagoConsignante } from "@/server/actions/reportes/consignacion";
import { CampoFecha } from "@/ui/componentes/selectores/campo-fecha";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";

// El día de hoy en Argentina (no en UTC: desde las 21:00 locales UTC ya es mañana). Esta pantalla no recibe la zona de la empresa, así que usa la constante.
function hoyISO() {
  return diaDeCalendario(new Date(), ZONA_ARGENTINA);
}

export function RegistrarPagoConsignante({ proveedorId, proveedorNombre, saldoActual }: { proveedorId: string; proveedorNombre: string; saldoActual: number }) {
  const router = useRouter();
  const [importe, setImporte] = useState(saldoActual > 0 ? String(saldoActual) : "");
  const [fecha, setFecha] = useState(hoyISO());
  const [notas, setNotas] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // I3 — un UUID por intento de envío (docs/auditoria-motor2-plan-i3-
  // idempotencia-2026-09-17.md §9.3), reenviado tal cual en reintentos;
  // se renueva recién después de un éxito, cuando arranca un intento nuevo.
  const [claveIdempotencia, setClaveIdempotencia] = useState(() => crypto.randomUUID());

  return (
    <Modal triggerLabel="Registrar pago" title={`Pago a "${proveedorNombre}"`}>
      {(cerrar) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              // numeroDelCampo: un texto inválido llega como NaN y el servidor lo rechaza; nunca el 0 que daba convertir un texto vacío.
              const resultado = await registrarPagoConsignante(
                proveedorId,
                numeroDelCampo(importe) ?? Number.NaN,
                mediodiaDelDia(fecha, ZONA_ARGENTINA),
                notas || undefined,
                claveIdempotencia
              );
              setMensaje(resultado.mensaje);
              if (resultado.ok) {
                setClaveIdempotencia(crypto.randomUUID());
                router.refresh();
                cerrar();
              }
            });
          }}
          className="flex flex-col gap-2"
        >
          {/* CampoNumero no lleva su propia etiqueta: lo nombra este <label> de afuera. */}
          <label className="text-sm font-medium">
            Importe
            <CampoNumero value={importe} onChange={setImporte} prefijo="$" required tipo="importe" etiqueta="El importe" />
          </label>
          <CampoFecha etiqueta="Fecha" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
          <Campo etiqueta="Notas (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} />
          {mensaje && (
            <Aviso variante="error" forma="en-linea">
              {mensaje}
            </Aviso>
          )}
          <Boton type="submit" cargando={pending}>
            {pending ? "Guardando..." : "Registrar pago"}
          </Boton>
        </form>
      )}
    </Modal>
  );
}
