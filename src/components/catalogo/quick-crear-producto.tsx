"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { darDeAltaProductoRapido } from "@/server/actions/catalogo/productos";

interface Opcion {
  id: string;
  nombre: string;
}

/**
 * Alta rápida de una MP nueva, sin salir del wizard de Compra por
 * proveedor (docs/plan-migracion.md §4) — mismo patrón `<Modal>` que
 * `QuickCrear` (Insumo/Categoría/Proveedor desde Alta/Editar Producto),
 * pero con 2 campos en vez de 1: acá hace falta la unidad de stock
 * (obligatoria en `Producto`), que ningún otro alta rápida del proyecto
 * necesita pedir.
 */
export function QuickCrearProducto({ unidades, onCreado }: { unidades: Opcion[]; onCreado: (item: { id: string; etiqueta: string }) => void }) {
  const [nombre, setNombre] = useState("");
  const [unidadStockId, setUnidadStockId] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Modal triggerLabel="+ Nuevo producto" title="Alta rápida de producto">
      {(cerrar) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const resultado = await darDeAltaProductoRapido(nombre, unidadStockId);
              setMensaje(resultado.mensaje);
              if (resultado.ok) {
                onCreado({ id: resultado.id, etiqueta: resultado.nombre });
                setNombre("");
                setUnidadStockId("");
                cerrar();
              }
            });
          }}
          className="flex flex-col gap-2"
        >
          <label className="text-sm">
            Nombre
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" autoFocus required />
          </label>
          <label className="text-sm">
            Unidad de stock
            <select value={unidadStockId} onChange={(e) => setUnidadStockId(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" required>
              <option value="">Elegí una unidad</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-neutral-500">
            Categoría, insumo/familia y otros datos del catálogo se pueden completar después en Catálogo → Productos — esto no bloquea la compra de hoy.
          </p>
          {mensaje && <p className="text-sm text-red-600">{mensaje}</p>}
          <button type="submit" disabled={pending} className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
            {pending ? "Guardando..." : "Crear"}
          </button>
        </form>
      )}
    </Modal>
  );
}
