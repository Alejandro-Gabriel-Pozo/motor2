"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import type { ResultadoConId } from "@/server/actions/tipos";

/**
 * Alta rápida inline de un catálogo secundario (Insumo, Categoría,
 * Proveedor) sin salir del form de Producto — el patrón "+ Nueva Familia"/
 * "+ Nuevo proveedor" que Apps Script ya resolvía bien
 * (crearFamiliaDesdePanel/crearCategoriaDesdePanel invocadas inline), acá
 * formalizado al estilo de la vista de lista de ERPNext.
 */
export function QuickCrear({
  triggerLabel,
  title,
  campoLabel,
  accion,
  onCreado,
}: {
  triggerLabel: string;
  title: string;
  campoLabel: string;
  accion: (nombre: string) => Promise<ResultadoConId>;
  onCreado: (item: { id: string; nombre: string }) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Modal triggerLabel={triggerLabel} title={title}>
      {(cerrar) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const resultado = await accion(nombre);
              setMensaje(resultado.mensaje);
              if (resultado.ok) {
                onCreado({ id: resultado.id, nombre: resultado.nombre });
                setNombre("");
                cerrar();
              }
            });
          }}
          className="flex flex-col gap-2"
        >
          <label className="text-sm">{campoLabel}</label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="rounded border px-3 py-2"
            autoFocus
            required
          />
          {mensaje && <p className="text-sm text-red-600">{mensaje}</p>}
          <button type="submit" disabled={pending} className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
            {pending ? "Guardando..." : "Crear"}
          </button>
        </form>
      )}
    </Modal>
  );
}
