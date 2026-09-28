"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reclasificarStock, type DestinoReclasificacion } from "@/server/actions/stock/reclasificacion";
import { obtenerSaldoDisponibleParaReclasificar } from "@/server/actions/stock/lecturas-reclasificacion";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoNumero } from "@/components/campo-numero";
import { useLeerServidor } from "@/lib/use-leer-servidor";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";

interface FilaDestino {
  seccionId: string;
  loteVencimiento: string;
  cantidad: string;
}

const DESTINO_VACIO: FilaDestino = { seccionId: "", loteVencimiento: "", cantidad: "" };

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export function ReclasificarForm({ secciones }: { secciones: { id: string; nombre: string }[] }) {
  const router = useRouter();
  const leerServidor = useLeerServidor();
  const [fecha, setFecha] = useState(hoyISO());
  const [productoId, setProductoId] = useState("");
  const [seccionOrigenId, setSeccionOrigenId] = useState("");
  const [loteOrigen, setLoteOrigen] = useState("");
  const [detalle, setDetalle] = useState("");
  const [destinos, setDestinos] = useState<FilaDestino[]>([{ ...DESTINO_VACIO }]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  const [disponible, setDisponible] = useState<number | null>(null);
  const [saldoNoDisponible, setSaldoNoDisponible] = useState(false);
  // I3 — un UUID por intento de envío (docs/auditoria-motor2-plan-i3-
  // idempotencia-2026-09-17.md §9.3), reenviado tal cual en reintentos;
  // se renueva recién después de un éxito, cuando arranca un intento nuevo.
  const [claveIdempotencia, setClaveIdempotencia] = useState(() => crypto.randomUUID());

  // Antes había que adivinar la cantidad a repartir y recién se veía el
  // saldo real si la suma no cerraba (el servidor lo informaba en el
  // mensaje de error) — a diferencia de Conteo Físico, que sí muestra el
  // saldo de entrada. Se recalcula cada vez que cambia producto/sección
  // origen/lote origen.
  useEffect(() => {
    let cancelado = false;
    // Sin producto/sección origen todavía, la propia acción devuelve null. Si la lectura FALLA (sesión vencida, sin conexión),
    // `leerServidor` devuelve `undefined` (un saldo nunca lo es): se avisa, y si fue por la sesión el refresco manda al login.
    leerServidor(
      () => obtenerSaldoDisponibleParaReclasificar(productoId, seccionOrigenId, loteOrigen ? new Date(loteOrigen) : null),
      () => {
        if (cancelado) return;
        setDisponible(null);
        setSaldoNoDisponible(true);
      }
    ).then((d) => {
      if (cancelado || d === undefined) return;
      setDisponible(d);
      setSaldoNoDisponible(false);
    });
    return () => {
      cancelado = true;
    };
  }, [leerServidor, productoId, seccionOrigenId, loteOrigen]);

  const actualizarDestino = (idx: number, cambios: Partial<FilaDestino>) => {
    setDestinos((prev) => prev.map((d, i) => (i === idx ? { ...d, ...cambios } : d)));
  };
  // Precarga con la fecha de origen — antes quedaba siempre vacío y había
  // que retipear la misma fecha a mano en cada destino (§8.5 del audit doc:
  // si el operario la dejaba vacía por olvido, esa porción del stock perdía
  // el vencimiento en silencio). Sigue siendo editable por fila.
  const agregarDestino = () => setDestinos((prev) => [...prev, { ...DESTINO_VACIO, loteVencimiento: loteOrigen }]);
  const quitarDestino = (idx: number) => setDestinos((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const cambiarLoteOrigen = (nuevoLoteOrigen: string) => {
    setLoteOrigen(nuevoLoteOrigen);
    // Sincroniza solo las filas que el operario todavía no tocó (vacías) —
    // una fila donde ya eligió otra fecha a propósito (ej. repartir a un
    // lote distinto) no se pisa.
    setDestinos((prev) => prev.map((d) => (d.loteVencimiento === "" ? { ...d, loteVencimiento: nuevoLoteOrigen } : d)));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    const destinosValidos: DestinoReclasificacion[] = destinos
      .filter((d) => d.seccionId && d.cantidad !== "")
      .map((d) => ({ seccionId: d.seccionId, loteVencimiento: d.loteVencimiento ? new Date(d.loteVencimiento) : null, cantidad: numeroDelCampo(d.cantidad) ?? NaN }));

    if (!destinosValidos.length) {
      setMensaje("Agregá al menos un destino.");
      setOk(false);
      return;
    }

    startTransition(async () => {
      const resultado = await reclasificarStock({
        productoId,
        seccionOrigenId,
        loteOrigen: loteOrigen ? new Date(loteOrigen) : null,
        destinos: destinosValidos,
        fecha: new Date(fecha),
        detalle: detalle || undefined,
        claveIdempotencia,
      });
      setMensaje(resultado.mensaje);
      setOk(resultado.ok);
      if (resultado.ok) {
        setDestinos([{ ...DESTINO_VACIO }]);
        setClaveIdempotencia(crypto.randomUUID());
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Fecha
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Producto
          <SelectorProducto value={productoId} onChange={setProductoId} filtro={{ soloDisponibles: true }} required />
        </label>
      </div>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Sección origen
          <select value={seccionOrigenId} onChange={(e) => setSeccionOrigenId(e.target.value)} required className="rounded border px-3 py-2">
            <option value="">Elegí una sección</option>
            {secciones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Lote origen (opcional — vacío = total sin lote puntual)
          <input type="date" value={loteOrigen} onChange={(e) => cambiarLoteOrigen(e.target.value)} className="rounded border px-3 py-2" />
        </label>
      </div>

      {productoId && seccionOrigenId && (
        <p className="text-sm text-neutral-500">
          Disponible en origen: <span className="font-medium text-neutral-900 dark:text-neutral-100">{disponible ?? "—"}</span>
          {saldoNoDisponible && (
            <span role="alert" className="ml-2 text-red-600">
              No se pudo consultar el disponible. Volvé a elegir el origen para reintentar.
            </span>
          )}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Destinos (la suma tiene que ser exacta al disponible{disponible != null ? `: ${disponible}` : ""})
        </span>
        {destinos.map((d, idx) => (
          <div key={idx} className="flex flex-wrap items-end gap-2 rounded border p-2">
            <label className="flex flex-1 min-w-40 flex-col gap-1 text-xs text-neutral-500">
              Sección
              <select value={d.seccionId} onChange={(e) => actualizarDestino(idx, { seccionId: e.target.value })} required className="rounded border px-2 py-1.5 text-sm">
                <option value="">Elegí una sección</option>
                {secciones.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-36 flex-col gap-1 text-xs text-neutral-500">
              Lote destino (opcional)
              <input type="date" value={d.loteVencimiento} onChange={(e) => actualizarDestino(idx, { loteVencimiento: e.target.value })} className="rounded border px-2 py-1.5 text-sm" />
            </label>
            <label className="flex w-28 flex-col gap-1 text-xs text-neutral-500">
              Cantidad
              <CampoNumero value={d.cantidad} onChange={(v) => actualizarDestino(idx, { cantidad: v })} required tamano="compacto" />
            </label>
            <button type="button" onClick={() => quitarDestino(idx)} disabled={destinos.length === 1} className="rounded border px-2 py-1.5 text-sm text-neutral-500 disabled:opacity-30">
              Quitar
            </button>
          </div>
        ))}
        <button type="button" onClick={agregarDestino} className="self-start text-sm underline">
          + Agregar destino
        </button>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Detalle (opcional)
        <input value={detalle} onChange={(e) => setDetalle(e.target.value)} className="rounded border px-3 py-2" />
      </label>

      {mensaje && <p className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}

      <button type="submit" disabled={pending} className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Guardando..." : "Reclasificar"}
      </button>
    </form>
  );
}
