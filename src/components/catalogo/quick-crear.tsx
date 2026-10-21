"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import type { ResultadoConId } from "@/server/actions/tipos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";

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

  function crear(cerrar: () => void) {
    if (!nombre || pending) return;
    startTransition(async () => {
      const resultado = await accion(nombre);
      // El mensaje se muestra solo si falló: al salir bien el modal se cierra y un aviso de error viejo (alert) se anunciaría al volver a abrirlo.
      setMensaje(resultado.ok ? null : resultado.mensaje);
      if (resultado.ok) {
        onCreado({ id: resultado.id, nombre: resultado.nombre });
        setNombre("");
        cerrar();
      }
    });
  }

  return (
    <Modal triggerLabel={triggerLabel} title={title}>
      {(cerrar) => (
        // A propósito NO es un <form>: siempre se usa DENTRO de otro <form>
        // (Alta/Editar Producto) — un <form> anidado es HTML inválido y
        // React vuelve a disparar el onSubmit del <form> exterior cuando el
        // evento `submit` interno burbujea (mismo bug real encontrado y
        // arreglado en QuickCrearProducto, docs/comparativa-ux-erpnext-
        // dolibarr.md — probado en navegador real, no solo tsc/tests: el
        // form exterior perdía su estado al crear un insumo/categoría/
        // proveedor inline).
        <div className="flex flex-col gap-2">
          <Campo
            etiqueta={campoLabel}
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
          {mensaje && <Aviso variante="error" forma="en-linea">{mensaje}</Aviso>}
          <Boton onClick={() => crear(cerrar)} disabled={pending}>
            {pending ? "Guardando..." : "Crear"}
          </Boton>
        </div>
      )}
    </Modal>
  );
}
