"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setPrecioLocalProducto } from "@/server/actions/precio-local";

interface ProductoPV {
  id: string;
  nombre: string;
  codigo: string;
  precioVenta: number;
}

export function PrecioLocalForm({ productos }: { productos: ProductoPV[] }) {
  const router = useRouter();
  const [productoId, setProductoId] = useState("");
  const [precio, setPrecio] = useState("");
  const [habilitado, setHabilitado] = useState(true);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const productoElegido = productos.find((p) => p.id === productoId);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const resultado = await setPrecioLocalProducto(productoId, Number(precio), habilitado);
          setMensaje(resultado.mensaje);
          setOk(resultado.ok);
          if (resultado.ok) {
            setProductoId("");
            setPrecio("");
            router.refresh();
          }
        });
      }}
      className="flex flex-col gap-3"
    >
      <h2 className="font-medium">Fijar precio local</h2>

      <label className="flex flex-col gap-1 text-sm">
        Producto (PV)
        <select value={productoId} onChange={(e) => setProductoId(e.target.value)} required className="rounded border px-3 py-2">
          <option value="">Elegí un producto</option>
          {productos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.codigo} — {p.nombre}
            </option>
          ))}
        </select>
      </label>

      {productoElegido && <p className="text-xs text-neutral-500">Precio global actual: {productoElegido.precioVenta}</p>}

      <label className="flex flex-col gap-1 text-sm">
        Precio local
        <input type="number" step="any" min={0} value={precio} onChange={(e) => setPrecio(e.target.value)} required className="rounded border px-3 py-2" />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={habilitado} onChange={(e) => setHabilitado(e.target.checked)} /> Habilitado (si no, se usa el precio global igual)
      </label>

      {mensaje && <p className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}

      <button type="submit" disabled={pending} className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Guardando..." : "Guardar"}
      </button>
    </form>
  );
}
