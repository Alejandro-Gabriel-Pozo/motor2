"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AccionConteo } from "@prisma/client";
import { registrarConteoFisico } from "@/server/actions/conteo-fisico";
import { obtenerProductoOpcion } from "@/server/actions/productos";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoNumero } from "@/components/campo-numero";

const ACCIONES: { value: AccionConteo; label: string }[] = [
  { value: "AJUSTAR", label: "Ajustar" },
  { value: "FALTA_MOVIMIENTO", label: "Falta movimiento" },
  { value: "DESCARTAR", label: "Descartar" },
];

export interface FilaBaseConteo {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  unidadStockNombre: string;
  /** ISO yyyy-mm-dd, o null si el saldo es "sin lote puntual". */
  loteVencimiento: string | null;
  saldoSistema: number;
}

interface FilaManual {
  key: string;
  productoId: string;
  productoEtiqueta: string;
  loteVencimiento: string;
}

interface EstadoFila {
  conteoReal: string;
  accion: AccionConteo;
  detalle: string;
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function claveBase(f: { productoId: string; loteVencimiento: string | null }) {
  return `${f.productoId}|${f.loteVencimiento ?? ""}`;
}

export function ConteoFisicoGrid({ seccionId, filasBase }: { seccionId: string; filasBase: FilaBaseConteo[] }) {
  const router = useRouter();
  const [fechaConteo, setFechaConteo] = useState(hoyISO());
  const [estados, setEstados] = useState<Record<string, EstadoFila>>({});
  const [filasManuales, setFilasManuales] = useState<FilaManual[]>([]);
  const [nuevoProductoId, setNuevoProductoId] = useState("");
  const [resumen, setResumen] = useState<{ ok: boolean; texto: string; errores: string[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const [limpiarSelector, setLimpiarSelector] = useState(0);

  function estadoDe(key: string): EstadoFila {
    return estados[key] ?? { conteoReal: "", accion: "AJUSTAR", detalle: "" };
  }
  function actualizarEstado(key: string, cambios: Partial<EstadoFila>) {
    setEstados((prev) => ({ ...prev, [key]: { ...estadoDe(key), ...cambios } }));
  }

  function agregarProducto(productoId: string, etiqueta: string) {
    if (!productoId) return;
    setFilasManuales((prev) => [...prev, { key: `manual-${Date.now()}-${prev.length}`, productoId, productoEtiqueta: etiqueta, loteVencimiento: "" }]);
    setNuevoProductoId("");
    setLimpiarSelector((n) => n + 1);
  }
  function quitarManual(key: string) {
    setFilasManuales((prev) => prev.filter((f) => f.key !== key));
    setEstados((prev) => {
      const { [key]: _omitida, ...resto } = prev;
      return resto;
    });
  }

  const filas: { key: string; productoId: string; etiqueta: string; loteVencimiento: string | null; saldoSistema: number }[] = [
    ...filasBase.map((f) => ({
      key: claveBase(f),
      productoId: f.productoId,
      etiqueta: `${f.productoCodigo} — ${f.productoNombre}`,
      loteVencimiento: f.loteVencimiento,
      saldoSistema: f.saldoSistema,
    })),
    ...filasManuales.map((f) => ({
      key: f.key,
      productoId: f.productoId,
      etiqueta: f.productoEtiqueta,
      loteVencimiento: f.loteVencimiento || null,
      saldoSistema: 0,
    })),
  ];

  async function confirmar() {
    const aEnviar = filas
      .map((f) => ({ f, estado: estadoDe(f.key) }))
      .filter(({ estado }) => estado.conteoReal.trim() !== "");

    if (!aEnviar.length) {
      setResumen({ ok: false, texto: "No tipeaste ningún conteo — dejá vacío lo que no cambió.", errores: [] });
      return;
    }

    startTransition(async () => {
      const errores: string[] = [];
      let procesados = 0;
      const clavesOk: string[] = [];

      for (const { f, estado } of aEnviar) {
        const resultado = await registrarConteoFisico({
          productoId: f.productoId,
          seccionId,
          loteVencimiento: f.loteVencimiento ? new Date(f.loteVencimiento) : null,
          conteoReal: Number(estado.conteoReal),
          fechaConteo: new Date(fechaConteo),
          accion: estado.accion,
          detalle: estado.detalle || undefined,
        });
        if (resultado.ok) {
          procesados++;
          clavesOk.push(f.key);
        } else {
          errores.push(`${f.etiqueta}: ${resultado.mensaje}`);
        }
      }

      setEstados((prev) => {
        const copia = { ...prev };
        for (const k of clavesOk) delete copia[k];
        return copia;
      });
      setFilasManuales((prev) => prev.filter((f) => !clavesOk.includes(f.key)));
      setResumen({
        ok: errores.length === 0,
        texto: `${procesados} conteo(s) registrado(s).${errores.length ? ` ${errores.length} con error.` : ""}`,
        errores,
      });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex w-48 flex-col gap-1 text-sm">
        Fecha del conteo
        <input type="date" value={fechaConteo} onChange={(e) => setFechaConteo(e.target.value)} className="rounded border px-3 py-2" />
      </label>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-1 pr-2">Producto</th>
            <th className="px-2">Lote</th>
            <th className="px-2 text-right">Sistema</th>
            <th className="px-2 text-right">Contado</th>
            <th className="px-2 text-right">Diferencia</th>
            <th className="px-2">Acción</th>
            <th className="px-2">Detalle</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const estado = estadoDe(f.key);
            const esManual = f.key.startsWith("manual-");
            const diferencia = estado.conteoReal.trim() !== "" ? Number(estado.conteoReal) - f.saldoSistema : null;
            return (
              <tr key={f.key} className="border-b">
                <td className="py-1 pr-2">{f.etiqueta}</td>
                <td className="px-2">
                  {esManual ? (
                    <input
                      type="date"
                      value={f.loteVencimiento ?? ""}
                      onChange={(e) => setFilasManuales((prev) => prev.map((m) => (m.key === f.key ? { ...m, loteVencimiento: e.target.value } : m)))}
                      className="rounded border px-2 py-1 text-sm"
                    />
                  ) : (
                    (f.loteVencimiento ?? "—")
                  )}
                </td>
                <td className="px-2 text-right">{f.saldoSistema}</td>
                <td className="w-28 px-2">
                  <CampoNumero value={estado.conteoReal} onChange={(v) => actualizarEstado(f.key, { conteoReal: v })} tamano="compacto" />
                </td>
                <td className={`px-2 text-right ${diferencia ? "font-medium" : ""}`}>{diferencia === null ? "—" : diferencia > 0 ? `+${diferencia}` : diferencia}</td>
                <td className="px-2">
                  <select
                    value={estado.accion}
                    onChange={(e) => actualizarEstado(f.key, { accion: e.target.value as AccionConteo })}
                    className="rounded border px-2 py-1.5 text-sm"
                  >
                    {ACCIONES.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2">
                  <input
                    value={estado.detalle}
                    onChange={(e) => actualizarEstado(f.key, { detalle: e.target.value })}
                    placeholder="opcional"
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </td>
                <td className="px-2">
                  {esManual && (
                    <button type="button" onClick={() => quitarManual(f.key)} className="text-xs text-neutral-500 underline">
                      quitar
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {!filas.length && (
            <tr>
              <td className="py-2 text-neutral-500" colSpan={8}>
                Sin productos con stock registrado en esta sección todavía — agregá uno abajo si hay algo que nunca se contó.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          + Agregar producto (nunca contado en esta sección, sin factura, etc.)
          <SelectorProducto
            value={nuevoProductoId}
            onChange={setNuevoProductoId}
            filtro={{ soloActivos: true, soloConStockReal: true }}
            limpiarSenal={limpiarSelector}
          />
        </label>
        <button
          type="button"
          onClick={async () => {
            if (!nuevoProductoId) return;
            const producto = await obtenerProductoOpcion(nuevoProductoId);
            if (producto) agregarProducto(producto.id, `${producto.codigo} — ${producto.nombre}`);
          }}
          className="rounded border px-3 py-2 text-sm"
        >
          Agregar fila
        </button>
      </div>

      {resumen && (
        <div className={`text-sm ${resumen.ok ? "text-green-700" : "text-red-600"}`}>
          <p>{resumen.texto}</p>
          {resumen.errores.length > 0 && (
            <ul className="list-disc pl-5">
              {resumen.errores.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={confirmar}
        disabled={pending}
        className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {pending ? "Guardando..." : "Registrar conteo"}
      </button>
    </div>
  );
}
