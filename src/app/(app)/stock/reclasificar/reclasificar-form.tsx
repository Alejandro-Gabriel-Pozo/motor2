"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reclasificarStock, type DestinoReclasificacion } from "@/server/actions/stock/reclasificacion";
import { obtenerSaldoDisponibleParaReclasificar } from "@/server/actions/stock/lecturas-reclasificacion";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoNumero } from "@/components/campo-numero";
import { useLeerServidor } from "@/lib/use-leer-servidor";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";
import { CampoFecha } from "@/ui/componentes/selectores/campo-fecha";
import { ZONA_ARGENTINA, diaDeCalendario, mediodiaDelDia } from "@/core/tiempo/zona-horaria";

interface FilaDestino {
  seccionId: string;
  loteVencimiento: string;
  cantidad: string;
}

const DESTINO_VACIO: FilaDestino = { seccionId: "", loteVencimiento: "", cantidad: "" };

// El día de hoy en Argentina (no en UTC: desde las 21:00 locales UTC ya es mañana). Esta pantalla no recibe la zona de la empresa, así que usa la constante.
function hoyISO() {
  return diaDeCalendario(new Date(), ZONA_ARGENTINA);
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
    // Nunca rechaza: fire-and-forget explícito, no una promesa sin manejar.
    void leerServidor(
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
        fecha: mediodiaDelDia(fecha, ZONA_ARGENTINA),
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
        <div className="min-w-0 flex-1">
          <CampoFecha etiqueta="Fecha" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
        </div>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          Producto
          <SelectorProducto value={productoId} onChange={setProductoId} filtro={{ soloDisponibles: true }} required />
        </label>
      </div>

      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <Selector etiqueta="Sección origen" value={seccionOrigenId} onChange={(e) => setSeccionOrigenId(e.target.value)} required>
            <option value="">Elegí una sección</option>
            {secciones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </Selector>
        </div>
        <div className="min-w-0 flex-1">
          <CampoFecha etiqueta="Lote origen (opcional — vacío = total sin lote puntual)" value={loteOrigen} onChange={(e) => cambiarLoteOrigen(e.target.value)} />
        </div>
      </div>

      {productoId && seccionOrigenId && (
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm text-tinta-tenue">
          <p>
            Disponible en origen: <span className="font-medium text-tinta">{disponible ?? "—"}</span>
          </p>
          {saldoNoDisponible && (
            <Aviso variante="error" forma="en-linea">
              No se pudo consultar el disponible. Volvé a elegir el origen para reintentar.
            </Aviso>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Destinos (la suma tiene que ser exacta al disponible{disponible != null ? `: ${disponible}` : ""})
        </span>
        {destinos.map((d, idx) => (
          <div key={idx} className="flex flex-wrap items-end gap-2 rounded border p-2">
            <div className="min-w-40 flex-1">
              <Selector etiqueta="Sección" tamano="compacto" value={d.seccionId} onChange={(e) => actualizarDestino(idx, { seccionId: e.target.value })} required>
                <option value="">Elegí una sección</option>
                {secciones.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </Selector>
            </div>
            <div className="w-44">
              <CampoFecha etiqueta="Lote destino (opcional)" tamano="compacto" value={d.loteVencimiento} onChange={(e) => actualizarDestino(idx, { loteVencimiento: e.target.value })} />
            </div>
            <label className="flex w-28 flex-col gap-1 text-sm">
              Cantidad
              <CampoNumero tipo="cantidad" value={d.cantidad} onChange={(v) => actualizarDestino(idx, { cantidad: v })} required tamano="compacto" />
            </label>
            <Boton variante="secundario" tamano="compacto" onClick={() => quitarDestino(idx)} disabled={destinos.length === 1}>
              Quitar
            </Boton>
          </div>
        ))}
        <Boton variante="enlace" tamano="en-fila" onClick={agregarDestino} className="self-start">
          + Agregar destino
        </Boton>
      </div>

      <Campo etiqueta="Detalle (opcional)" value={detalle} onChange={(e) => setDetalle(e.target.value)} />

      {mensaje && (
        <Aviso variante={ok ? "exito" : "error"} forma="en-linea">
          {mensaje}
        </Aviso>
      )}

      <Boton type="submit" disabled={pending} className="self-start">
        {pending ? "Guardando..." : "Reclasificar"}
      </Boton>
    </form>
  );
}
