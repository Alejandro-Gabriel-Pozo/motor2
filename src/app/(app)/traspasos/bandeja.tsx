"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BotonConConfirmacion } from "@/components/boton-con-confirmacion";
import {
  aprobarYEnviarTransferencia,
  rechazarSolicitudTransferencia,
  aceptarTransferencia,
  rechazarTransferencia,
  confirmarReingresoTransferencia,
  cancelarSolicitudTransferencia,
} from "@/server/actions/traspasos/traspasos";

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
  /** true = es mi propia solicitud PULL (SOLICITADA), la puedo cancelar yo mismo sin esperar a Origen. */
  esMiSolicitudCancelable: boolean;
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

/** Estilo de los «Rechazar» de la bandeja (el disparador de BotonConConfirmacion va en una columna flex: `self-start` evita que se estire). */
const CLASE_RECHAZAR = "self-start rounded border px-3 py-1.5 text-sm text-red-600 disabled:opacity-50";

/** Qué puede hacer quien mira la bandeja: una clave por acción (traspaso_*); los controles que su rol no puede ejecutar quedan deshabilitados. */
export interface PermisosBandeja {
  aprobar: boolean;
  rechazarSolicitud: boolean;
  aceptar: boolean;
  rechazarEnvio: boolean;
  confirmarReingreso: boolean;
  cancelarSolicitud: boolean;
}

function FilaParaAprobar({ fila, secciones, permisos }: { fila: FilaBandeja; secciones: Opcion[]; permisos: PermisosBandeja }) {
  const router = useRouter();
  const producto = `${fila.productoCodigo} — ${fila.productoNombre}`;
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

  return (
    <div data-traspaso={fila.id} className="rounded border p-3">
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
        <button
          type="button"
          disabled={pending || !permisos.aprobar}
          title={permisos.aprobar ? undefined : "Tu rol puede ver la bandeja pero no aprobar solicitudes."}
          onClick={aprobar}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Aprobar y enviar
        </button>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Motivo de rechazo (opcional)
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="rounded border px-2 py-1.5 text-sm" />
        </label>
        {/* Rechazar no se deshace: pide confirmación. Lee el motivo vigente al CONFIRMAR; mientras «Aprobar y enviar» está en curso queda
            deshabilitado (la carrera inversa la cierra el servidor: los dos pasan por una transacción serializable). */}
        <BotonConConfirmacion
          etiqueta="Rechazar"
          etiquetaAccesible={`Rechazar la solicitud de ${fila.cantidad} ${fila.unidadNombre} de ${producto} de ${fila.otraSucursalNombre}`}
          aviso={`¿Rechazar la solicitud de ${fila.cantidad} ${fila.unidadNombre} de ${producto} de ${fila.otraSucursalNombre}? No se puede deshacer: ${fila.otraSucursalNombre} tendrá que pedirla de nuevo.`}
          etiquetaConfirmar="Sí, rechazar la solicitud"
          etiquetaEnCurso="Rechazando…"
          etiquetaVolver="Volver"
          accion={() => rechazarSolicitudTransferencia(fila.id, motivo || undefined)}
          deshabilitado={pending || !permisos.rechazarSolicitud}
          claseDisparador={CLASE_RECHAZAR}
        />
      </div>
      <Mensaje mensaje={mensaje} ok={ok} />
    </div>
  );
}

function FilaParaAceptar({ fila, secciones, permisos }: { fila: FilaBandeja; secciones: Opcion[]; permisos: PermisosBandeja }) {
  const router = useRouter();
  const producto = `${fila.productoCodigo} — ${fila.productoNombre}`;
  const [seccionDestinoId, setSeccionDestinoId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  // I3 — un UUID por intento de envío (docs/auditoria-motor2-plan-i3-
  // idempotencia-2026-09-17.md §9.3): esta fila se desmonta apenas
  // aceptar() tiene éxito (deja de venir en `paraAceptar` tras el
  // refresh), así que no hace falta renovar la clave — un solo intento
  // por vida de este componente.
  const [claveIdempotencia] = useState(() => crypto.randomUUID());

  const aceptar = () => {
    if (!seccionDestinoId) {
      setMensaje("Elegí a qué sección propia entra.");
      setOk(false);
      return;
    }
    startTransition(async () => {
      const r = await aceptarTransferencia(fila.id, seccionDestinoId, claveIdempotencia);
      setMensaje(r.mensaje);
      setOk(r.ok);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div data-traspaso={fila.id} className="rounded border p-3">
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
        <button
          type="button"
          disabled={pending || !permisos.aceptar}
          title={permisos.aceptar ? undefined : "Tu rol puede ver la bandeja pero no aceptar envíos."}
          onClick={aceptar}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Aceptar
        </button>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Motivo de rechazo (opcional)
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="rounded border px-2 py-1.5 text-sm" />
        </label>
        {/* Mismo criterio que en FilaParaAprobar: confirmación, motivo leído al confirmar, deshabilitado mientras «Aceptar» está en curso. */}
        <BotonConConfirmacion
          etiqueta="Rechazar"
          etiquetaAccesible={`Rechazar el envío de ${fila.cantidad} ${fila.unidadNombre} de ${producto} de ${fila.otraSucursalNombre}`}
          aviso={`¿Rechazar el envío de ${fila.cantidad} ${fila.unidadNombre} de ${producto} que te mandó ${fila.otraSucursalNombre}? No entra a tu stock y ${fila.otraSucursalNombre} tiene que confirmar el reingreso.`}
          etiquetaConfirmar="Sí, rechazar el envío"
          etiquetaEnCurso="Rechazando…"
          etiquetaVolver="Volver"
          accion={() => rechazarTransferencia(fila.id, motivo || undefined)}
          deshabilitado={pending || !permisos.rechazarEnvio}
          claseDisparador={CLASE_RECHAZAR}
        />
      </div>
      <Mensaje mensaje={mensaje} ok={ok} />
    </div>
  );
}

function FilaParaReingreso({ fila, permisos }: { fila: FilaBandeja; permisos: PermisosBandeja }) {
  const router = useRouter();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  // I3 — un UUID por intento de envío (docs/auditoria-motor2-plan-i3-
  // idempotencia-2026-09-17.md §9.3): mismo criterio que FilaParaAceptar
  // — esta fila se desmonta apenas confirmar() tiene éxito.
  const [claveIdempotencia] = useState(() => crypto.randomUUID());

  const confirmar = () => {
    startTransition(async () => {
      const r = await confirmarReingresoTransferencia(fila.id, claveIdempotencia);
      setMensaje(r.mensaje);
      setOk(r.ok);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div data-traspaso={fila.id} className="rounded border p-3">
      <p className="text-sm">
        <strong>{fila.otraSucursalNombre}</strong> rechazó {fila.cantidad} {fila.unidadNombre} de{" "}
        <strong>
          {fila.productoCodigo} — {fila.productoNombre}
        </strong>{" "}
        ({fila.fecha}) — {fila.motivoRechazoDestino || "sin motivo"}. Confirmá el reingreso para que vuelva a tu stock.
      </p>
      <div className="mt-2">
        <button
          type="button"
          disabled={pending || !permisos.confirmarReingreso}
          title={permisos.confirmarReingreso ? undefined : "Tu rol puede ver la bandeja pero no confirmar reingresos."}
          onClick={confirmar}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Confirmar reingreso
        </button>
      </div>
      <Mensaje mensaje={mensaje} ok={ok} />
    </div>
  );
}

/**
 * Lo que ESTA sucursal inició y sigue esperando a la otra. Cancelar la solicitud propia no se deshace (la otra sucursal deja de verla y
 * hay que pedirla de nuevo), así que pide confirmación en el mismo lugar con `BotonConConfirmacion`
 * (docs/plan-mutaciones-controladas-2026-09-25.md, Paso 6a).
 */
function FilaEsperando({ fila, permisos }: { fila: FilaBandeja; permisos: PermisosBandeja }) {
  const producto = `${fila.productoCodigo} — ${fila.productoNombre}`;
  return (
    <div data-traspaso={fila.id} className="rounded border p-3">
      <p className="text-sm text-neutral-500">
        {fila.esMiSolicitudCancelable ? (
          <>
            Le pediste a <strong>{fila.otraSucursalNombre}</strong>
          </>
        ) : (
          <>
            Le enviaste a <strong>{fila.otraSucursalNombre}</strong>
          </>
        )}{" "}
        {fila.cantidad} {fila.unidadNombre} de{" "}
        <strong>
          {fila.productoCodigo} — {fila.productoNombre}
        </strong>{" "}
        ({fila.fecha}){fila.detalle && ` — ${fila.detalle}`} — esperando que {fila.otraSucursalNombre} decida.
      </p>
      {fila.esMiSolicitudCancelable && (
        <div className="mt-2">
          <BotonConConfirmacion
            etiqueta="Cancelar solicitud"
            etiquetaAccesible={`Cancelar solicitud de ${fila.cantidad} ${fila.unidadNombre} de ${producto} a ${fila.otraSucursalNombre}`}
            aviso={`¿Cancelar tu solicitud de ${fila.cantidad} ${fila.unidadNombre} de ${producto} a ${fila.otraSucursalNombre}? ${fila.otraSucursalNombre} ya no la va a ver para aprobar. No se puede deshacer: si la necesitás, vas a tener que pedirla de nuevo.`}
            etiquetaConfirmar="Sí, cancelar la solicitud"
            etiquetaEnCurso="Cancelando…"
            etiquetaVolver="Volver"
            accion={() => cancelarSolicitudTransferencia(fila.id)}
            deshabilitado={!permisos.cancelarSolicitud}
            claseDisparador="self-start rounded border px-3 py-1.5 text-sm text-red-600 disabled:opacity-50"
          />
        </div>
      )}
    </div>
  );
}

export function Bandeja({
  paraAprobar,
  paraAceptar,
  paraReingreso,
  esperando,
  historial,
  nextCursorHistorial,
  secciones,
  permisos,
}: {
  paraAprobar: FilaBandeja[];
  paraAceptar: FilaBandeja[];
  paraReingreso: FilaBandeja[];
  esperando: FilaBandeja[];
  historial: FilaBandeja[];
  nextCursorHistorial: string | null;
  secciones: Opcion[];
  permisos: PermisosBandeja;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="mb-2 text-sm font-medium">Para aprobar (te lo pidieron, sos Origen)</h2>
        <div className="flex flex-col gap-2">
          {paraAprobar.map((f) => (
            <FilaParaAprobar key={f.id} fila={f} secciones={secciones} permisos={permisos} />
          ))}
          {!paraAprobar.length && <p className="text-sm text-neutral-500">Nada pendiente de aprobar.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Para aceptar (te lo enviaron, sos Destino)</h2>
        <div className="flex flex-col gap-2">
          {paraAceptar.map((f) => (
            <FilaParaAceptar key={f.id} fila={f} secciones={secciones} permisos={permisos} />
          ))}
          {!paraAceptar.length && <p className="text-sm text-neutral-500">Nada pendiente de aceptar.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Para confirmar reingreso (rechazaron lo que enviaste)</h2>
        <div className="flex flex-col gap-2">
          {paraReingreso.map((f) => (
            <FilaParaReingreso key={f.id} fila={f} permisos={permisos} />
          ))}
          {!paraReingreso.length && <p className="text-sm text-neutral-500">Nada pendiente de reingreso.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Esperando respuesta (lo iniciaste vos)</h2>
        <div className="flex flex-col gap-2">
          {esperando.map((f) => (
            <FilaEsperando key={f.id} fila={f} permisos={permisos} />
          ))}
          {!esperando.length && <p className="text-sm text-neutral-500">Nada propio en curso esperando a la otra sucursal.</p>}
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
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {historial.map((f) => (
              <tr key={f.id} data-traspaso={f.id} className="border-b">
                <td className="py-1 align-top">{f.fecha}</td>
                <td className="align-top">
                  {f.productoCodigo} — {f.productoNombre}
                </td>
                <td className="align-top">
                  {f.cantidad} {f.unidadNombre}
                </td>
                <td className="align-top">{f.otraSucursalNombre}</td>
                <td className="align-top">{f.estado}</td>
                <td className="max-w-xs align-top text-xs text-neutral-500">
                  {f.detalle && <p>{f.detalle}</p>}
                  {f.motivoRechazoOrigen && <p>Rechazo (origen): {f.motivoRechazoOrigen}</p>}
                  {f.motivoRechazoDestino && <p>Rechazo (destino): {f.motivoRechazoDestino}</p>}
                  {(f.seccionOrigenNombre || f.seccionDestinoNombre) && (
                    <p>
                      Sección: {f.seccionOrigenNombre ?? "—"} → {f.seccionDestinoNombre ?? "—"}
                    </p>
                  )}
                  <p>Creado por: {f.creadoPorEmail}</p>
                </td>
              </tr>
            ))}
            {!historial.length && (
              <tr>
                <td className="py-1 text-neutral-500" colSpan={6}>
                  Sin traspasos cerrados todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {nextCursorHistorial && (
          <Link href={`/traspasos?cursor=${nextCursorHistorial}`} className="mt-2 inline-block text-sm underline">
            Página siguiente →
          </Link>
        )}
      </div>
    </div>
  );
}
