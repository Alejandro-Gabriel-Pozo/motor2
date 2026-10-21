"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { darDeAltaProductoRapido } from "@/server/actions/catalogo/productos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";

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
export function QuickCrearProducto({
  unidades,
  onCreado,
  deshabilitado = false,
}: {
  unidades: Opcion[];
  onCreado: (item: { id: string; etiqueta: string }) => void;
  /** Deshabilita el botón «+ Nuevo producto» (ver el uso en el wizard de Compra). */
  deshabilitado?: boolean;
}) {
  const [nombre, setNombre] = useState("");
  const [unidadStockId, setUnidadStockId] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function crear(cerrar: () => void) {
    if (!nombre || !unidadStockId || pending) return;
    startTransition(async () => {
      const resultado = await darDeAltaProductoRapido(nombre, unidadStockId);
      // El mensaje se muestra solo si falló: al salir bien el modal se cierra y un aviso de error viejo (alert) se anunciaría al volver a abrirlo.
      setMensaje(resultado.ok ? null : resultado.mensaje);
      if (resultado.ok) {
        onCreado({ id: resultado.id, etiqueta: resultado.nombre });
        setNombre("");
        setUnidadStockId("");
        cerrar();
      }
    });
  }

  return (
    <Modal triggerLabel="+ Nuevo producto" title="Alta rápida de producto" deshabilitado={deshabilitado}>
      {(cerrar) => (
        // A propósito NO es un <form>: este modal siempre se usa DENTRO de
        // otro <form> (acá, la fila de Producto del wizard de Compra) — un
        // <form> anidado es HTML inválido y React re-dispara el evento
        // `submit` (que burbujea) hacia el <form> exterior también, que
        // termina resolviendo su propio submit con el estado de ESE
        // instante (nada cargado todavía) y pisa el formulario entero.
        // Confirmado en navegador real: clickear "Crear" reseteaba
        // proveedor + fila antes de este fix.
        <div className="flex flex-col gap-2">
          <Campo
            etiqueta="Nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                crear(cerrar);
              }
            }}
            autoFocus
            required
          />
          <Selector etiqueta="Unidad de stock" value={unidadStockId} onChange={(e) => setUnidadStockId(e.target.value)} required>
            <option value="">Elegí una unidad</option>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </Selector>
          <p className="text-xs text-tinta-suave">
            Categoría, insumo/familia y otros datos del catálogo se pueden completar después en Catálogo → Productos — esto no bloquea la compra de hoy.
          </p>
          {mensaje && <Aviso variante="error" forma="en-linea">{mensaje}</Aviso>}
          <Boton onClick={() => crear(cerrar)} disabled={pending}>
            {pending ? "Guardando..." : "Crear"}
          </Boton>
        </div>
      )}
    </Modal>
  );
}
