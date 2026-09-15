"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  aprobarYEnviarTransferencia,
  rechazarSolicitudTransferencia,
  aceptarTransferencia,
  rechazarTransferencia,
  confirmarReingresoTransferencia,
} from "@/server/actions/traspasos";

export interface FilaBandeja {
  id: string;
  productoNombre: string;
  productoCodigo: string;
  cantidad: number;
  unidadNombre: string;
  otraSucursalNombre: string;
  fecha: string;
  detalle: string | null;
  estado: string;
  motivoRechazoOrigen: string | null;
  motivoRechazoDestino: string | null;
  seccionOrigenNombre: string | null;
  seccionDestinoNombre: string | null;
  creadoPorEmail: string;
}

interface Opcion {
  id: string;
  nombre: string;
}

function Mensaje({ mensaje, ok }: { mensaje: string | null; ok: boolean }) {
  if (!mensaje) return null;
  return <p className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>;
}

function FilaParaAprobar({ fila, secciones }: { fila: FilaBandeja; secciones: Opcion[] }) {
  const router = useRouter();
  const [seccionOrigenId, setSeccionOrigenId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const aprobar = () => {
    if (!seccionOrigenId) {
      setMensaje("Elegí de qué sección propia sale.");
      setOk(false);
      return;
    }
    startTransition(async () => {
      const r = await aprobarYEnviarTransferencia(fila.id, seccionOrigenId);
      setMensaje(r.mensaje);
      setOk(r.ok);
      if (r.ok) router.refresh();
    });
  };
  const rechazar = () => {
    startTransition(async () => {
      const r = await rechazarSolicitudTransferencia(fila.id, motivo || undefined);
      setMensaje(r.mensaje);
      setOk(r.ok);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="rounded border p-3">
      <p className="text-sm">
        <strong>{fila.otraSucursalNombre}</strong> pide {fila.cantidad} {fila.unidadNombre} de{" "}
        <strong>
          {fila.productoCodigo} — {fila.productoNombre}
        </strong>{" "}
        ({fila.fecha}){fila.detalle && ` — ${fila.detalle}`}
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Sección propia de la que sale
          <select value={seccionOrigenId} onChange={(e) => setSeccionOrigenId(e.target.value)} className="rounded border px-2 py-1.5 text-sm">
            <option value="">Elegí una sección</option>
            {secciones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={pending} onClick={aprobar} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          Aprobar y enviar
        </button>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Motivo de rechazo (opcional)
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="rounded border px-2 py-1.5 text-sm" />
        </label>
        <button type="button" disabled={pending} onClick={rechazar} className="rounded border px-3 py-1.5 text-sm text-red-600 disabled:opacity-50">
          Rechazar
        </button>
      </div>
      <Mensaje mensaje={mensaje} ok={ok} />
    </div>
  );
}

function FilaParaAceptar({ fila, secciones }: { fila: FilaBandeja; secciones: Opcion[] }) {
  const router = useRouter();
  const [seccionDestinoId, setSeccionDestinoId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const aceptar = () => {
    if (!seccionDestinoId) {
      setMensaje("Elegí a qué sección propia entra.");
      setOk(false);
      return;
    }
    startTransition(async () => {
      const r = await aceptarTransferencia(fila.id, seccionDestinoId);
      setMensaje(r.mensaje);
      setOk(r.ok);
      if (r.ok) router.refresh();
    });
  };
  const rechazar = () => {
    startTransition(async () => {
      const r = await rechazarTransferencia(fila.id, motivo || undefined);
      setMensaje(r.mensaje);
      setOk(r.ok);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="rounded border p-3">
      <p className="text-sm">
        <strong>{fila.otraSucursalNombre}</strong> te envía {fila.cantidad} {fila.unidadNombre} de{" "}
        <strong>
          {fila.productoCodigo} — {fila.productoNombre}
        </strong>{" "}
        ({fila.fecha}){fila.detalle && ` — ${fila.detalle}`}
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Sección propia a la que entra
          <select value={seccionDestinoId} onChange={(e) => setSeccionDestinoId(e.target.value)} className="rounded border px-2 py-1.5 text-sm">
            <option value="">Elegí una sección</option>
            {secciones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={pending} onClick={aceptar} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          Aceptar
        </button>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Motivo de rechazo (opcional)
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="rounded border px-2 py-1.5 text-sm" />
        </label>
        <button type="button" disabled={pending} onClick={rechazar} className="rounded border px-3 py-1.5 text-sm text-red-600 disabled:opacity-50">
          Rechazar
        </button>
      </div>
      <Mensaje mensaje={mensaje} ok={ok} />
    </div>
  );
}

function FilaParaReingreso({ fila }: { fila: FilaBandeja }) {
  const router = useRouter();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const confirmar = () => {
    startTransition(async () => {
      const r = await confirmarReingresoTransferencia(fila.id);
      setMensaje(r.mensaje);
      setOk(r.ok);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="rounded border p-3">
      <p className="text-sm">
        <strong>{fila.otraSucursalNombre}</strong> rechazó {fila.cantidad} {fila.unidadNombre} de{" "}
        <strong>
          {fila.productoCodigo} — {fila.productoNombre}
        </strong>{" "}
        ({fila.fecha}) — {fila.motivoRechazoDestino || "sin motivo"}. Confirmá el reingreso para que vuelva a tu stock.
      </p>
      <div className="mt-2">
        <button type="button" disabled={pending} onClick={confirmar} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          Confirmar reingreso
        </button>
      </div>
      <Mensaje mensaje={mensaje} ok={ok} />
    </div>
  );
}

export function Bandeja({
  paraAprobar,
  paraAceptar,
  paraReingreso,
  historial,
  secciones,
}: {
  paraAprobar: FilaBandeja[];
  paraAceptar: FilaBandeja[];
  paraReingreso: FilaBandeja[];
  historial: FilaBandeja[];
  secciones: Opcion[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="mb-2 text-sm font-medium">Para aprobar (te lo pidieron, sos Origen)</h2>
        <div className="flex flex-col gap-2">
          {paraAprobar.map((f) => (
            <FilaParaAprobar key={f.id} fila={f} secciones={secciones} />
          ))}
          {!paraAprobar.length && <p className="text-sm text-neutral-500">Nada pendiente de aprobar.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Para aceptar (te lo enviaron, sos Destino)</h2>
        <div className="flex flex-col gap-2">
          {paraAceptar.map((f) => (
            <FilaParaAceptar key={f.id} fila={f} secciones={secciones} />
          ))}
          {!paraAceptar.length && <p className="text-sm text-neutral-500">Nada pendiente de aceptar.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Para confirmar reingreso (rechazaron lo que enviaste)</h2>
        <div className="flex flex-col gap-2">
          {paraReingreso.map((f) => (
            <FilaParaReingreso key={f.id} fila={f} />
          ))}
          {!paraReingreso.length && <p className="text-sm text-neutral-500">Nada pendiente de reingreso.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Historial</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1">Fecha</th>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Otra sucursal</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {historial.map((f) => (
              <tr key={f.id} className="border-b">
                <td className="py-1">{f.fecha}</td>
                <td>
                  {f.productoCodigo} — {f.productoNombre}
                </td>
                <td>
                  {f.cantidad} {f.unidadNombre}
                </td>
                <td>{f.otraSucursalNombre}</td>
                <td>{f.estado}</td>
              </tr>
            ))}
            {!historial.length && (
              <tr>
                <td className="py-1 text-neutral-500" colSpan={5}>
                  Sin traspasos cerrados todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
