"use client";

import { useState } from "react";
import { Boton } from "@/ui/primitivas/boton";

/**
 * Antes los formularios "Agregar X" quedaban siempre abiertos, cortando
 * la lectura de listas ya existentes — hallazgo probando la demo real
 * (docs/comparativa-ux-erpnext-dolibarr.md §7.2: en Recetas, "Agregar
 * ingrediente"/"Agregar paso" nunca se ocultaban, pese a que ficha
 * técnica e ingredientes/pasos existentes ya tenían modo vista). Mismo
 * espíritu que "+ Agregar destino"/"+ Agregar producto" ya usados en
 * Reclasificar/Conteo físico, pero para un form estático (no una fila
 * repetible dentro de un array).
 */
export function AgregarColapsable({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <Boton variante="enlace" tamano="en-fila" onClick={() => setAbierto(true)} className="self-start">
        + {etiqueta}
      </Boton>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {children}
      <Boton variante="enlace" tamano="en-fila" onClick={() => setAbierto(false)} className="self-start">
        Cerrar
      </Boton>
    </div>
  );
}
