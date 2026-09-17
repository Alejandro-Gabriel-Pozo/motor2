"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setStockMinimoProducto } from "@/server/actions/stock/stock-minimo";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoNumero } from "@/components/campo-numero";

export interface FilaStockMinimoEnEdicion {
  productoId: string;
  productoEtiqueta: string;
  seccionId: string;
  minimo: string;
}

export function StockMinimoForm({
  secciones,
  filaEnEdicion,
}: {
  secciones: { id: string; nombre: string }[];
  /** Antes había que rebuscar producto y sección desde cero cada vez que se quería ajustar un mínimo existente — hallazgo de la auditoría. */
  filaEnEdicion?: FilaStockMinimoEnEdicion;
}) {
  const router = useRouter();
  const editando = Boolean(filaEnEdicion);
  const [productoId, setProductoId] = useState(filaEnEdicion?.productoId ?? "");
  const [seccionId, setSeccionId] = useState(filaEnEdicion?.seccionId ?? "");
  const [minimo, setMinimo] = useState(filaEnEdicion?.minimo ?? "");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  const [resetCount, setResetCount] = useState(0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const resultado = await setStockMinimoProducto(productoId, Number(minimo), seccionId || null);
          setMensaje(resultado.mensaje);
          setOk(resultado.ok);
          if (resultado.ok) {
            if (editando) {
              router.push("/stock/minimo");
            } else {
              setProductoId("");
              setMinimo("");
              setResetCount((n) => n + 1);
            }
            router.refresh();
          }
        });
      }}
      className="flex flex-col gap-3"
    >
      <h2 className="font-medium">{editando ? "Editar Stock Mínimo" : "Fijar Stock Mínimo"}</h2>

      <label className="flex flex-col gap-1 text-sm">
        Producto
        <SelectorProducto
          value={productoId}
          onChange={setProductoId}
          filtro={{ soloActivos: true }}
          etiquetaInicial={filaEnEdicion?.productoEtiqueta}
          limpiarSenal={resetCount}
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Sección (opcional — vacío = mínimo global de toda la sucursal)
        <select value={seccionId} onChange={(e) => setSeccionId(e.target.value)} className="rounded border px-3 py-2">
          <option value="">Global</option>
          {secciones.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Mínimo
        <CampoNumero value={minimo} onChange={setMinimo} required />
      </label>

      {mensaje && <p className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}

      <button type="submit" disabled={pending} className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Guardando..." : "Guardar"}
      </button>
    </form>
  );
}
