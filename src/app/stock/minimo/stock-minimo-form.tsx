"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setStockMinimoProducto } from "@/server/actions/stock-minimo";

interface Opcion {
  id: string;
  nombre: string;
  codigo: string;
}

export function StockMinimoForm({ productos, secciones }: { productos: Opcion[]; secciones: { id: string; nombre: string }[] }) {
  const router = useRouter();
  const [productoId, setProductoId] = useState("");
  const [seccionId, setSeccionId] = useState("");
  const [minimo, setMinimo] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const resultado = await setStockMinimoProducto(productoId, Number(minimo), seccionId || null);
          setMensaje(resultado.mensaje);
          setOk(resultado.ok);
          if (resultado.ok) {
            setProductoId("");
            setMinimo("");
            router.refresh();
          }
        });
      }}
      className="flex flex-col gap-3"
    >
      <h2 className="font-medium">Fijar Stock Mínimo</h2>

      <label className="flex flex-col gap-1 text-sm">
        Producto
        <select value={productoId} onChange={(e) => setProductoId(e.target.value)} required className="rounded border px-3 py-2">
          <option value="">Elegí un producto</option>
          {productos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.codigo} — {p.nombre}
            </option>
          ))}
        </select>
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
        <input type="number" step="any" min={0} value={minimo} onChange={(e) => setMinimo(e.target.value)} required className="rounded border px-3 py-2" />
      </label>

      {mensaje && <p className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}

      <button type="submit" disabled={pending} className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Guardando..." : "Guardar"}
      </button>
    </form>
  );
}
