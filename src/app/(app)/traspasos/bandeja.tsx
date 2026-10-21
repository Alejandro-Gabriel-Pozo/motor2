"use client";

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
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Enlace } from "@/ui/primitivas/enlace";
import { Selector } from "@/ui/primitivas/selector";

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
  return (
    <Aviso variante={ok ? "exito" : "error"} forma="en-linea">
      {mensaje}
    </Aviso>
  );
}

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
        <Selector etiqueta="Sección propia de la que sale" tamano="compacto" value={seccionOrigenId} onChange={(e) => setSeccionOrigenId(e.target.value)}>
          <option value="">Elegí una sección</option>
          {secciones.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </Selector>
        <Boton tamano="compacto" disabled={pending || !permisos.aprobar} title={permisos.aprobar ? undefined : "Tu rol puede ver la bandeja pero no aprobar solicitudes."} onClick={aprobar}>
          Aprobar y enviar
        </Boton>
        <Campo etiqueta="Motivo de rechazo (opcional)" tamano="compacto" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
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
        <Selector etiqueta="Sección propia a la que entra" tamano="compacto" value={seccionDestinoId} onChange={(e) => setSeccionDestinoId(e.target.value)}>
          <option value="">Elegí una sección</option>
          {secciones.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </Selector>
        <Boton tamano="compacto" disabled={pending || !permisos.aceptar} title={permisos.aceptar ? undefined : "Tu rol puede ver la bandeja pero no aceptar envíos."} onClick={aceptar}>
          Aceptar
        </Boton>
        <Campo etiqueta="Motivo de rechazo (opcional)" tamano="compacto" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
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
        <Boton tamano="compacto" disabled={pending || !permisos.confirmarReingreso} title={permisos.confirmarReingreso ? undefined : "Tu rol puede ver la bandeja pero no confirmar reingresos."} onClick={confirmar}>
          Confirmar reingreso
        </Boton>
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
      <p className="text-sm text-tinta-tenue">
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
          {!paraAprobar.length && <p className="text-sm text-tinta-tenue">Nada pendiente de aprobar.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Para aceptar (te lo enviaron, sos Destino)</h2>
        <div className="flex flex-col gap-2">
          {paraAceptar.map((f) => (
            <FilaParaAceptar key={f.id} fila={f} secciones={secciones} permisos={permisos} />
          ))}
          {!paraAceptar.length && <p className="text-sm text-tinta-tenue">Nada pendiente de aceptar.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Para confirmar reingreso (rechazaron lo que enviaste)</h2>
        <div className="flex flex-col gap-2">
          {paraReingreso.map((f) => (
            <FilaParaReingreso key={f.id} fila={f} permisos={permisos} />
          ))}
          {!paraReingreso.length && <p className="text-sm text-tinta-tenue">Nada pendiente de reingreso.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Esperando respuesta (pediste o enviaste vos)</h2>
        <div className="flex flex-col gap-2">
          {esperando.map((f) => (
            <FilaEsperando key={f.id} fila={f} permisos={permisos} />
          ))}
          {!esperando.length && <p className="text-sm text-tinta-tenue">Nada propio en curso esperando a la otra sucursal.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Historial</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-tinta-tenue">
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
                <td className="max-w-xs align-top text-xs text-tinta-tenue">
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
                <td className="py-1 text-tinta-tenue" colSpan={6}>
                  Sin traspasos cerrados todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {nextCursorHistorial && (
          <p className="mt-2 text-sm">
            <Enlace href={`/traspasos?cursor=${nextCursorHistorial}`}>Página siguiente →</Enlace>
          </p>
        )}
      </div>
    </div>
  );
}
