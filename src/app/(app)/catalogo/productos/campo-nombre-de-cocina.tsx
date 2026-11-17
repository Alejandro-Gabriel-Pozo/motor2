"use client";

import type { TipoProducto } from "@/core/datos/enumerados-del-esquema";
import { texto } from "@/core/texto";
import { Campo } from "@/ui/primitivas/campo";
import { nombreDelCampo } from "./nombre-del-campo-del-alta";

/**
 * Nombre de cocina del producto (2026-11-15; docs/diseno-nombre-de-cocina-como-pedernal-2026-11-15.md), campo de la ficha: OPCIONAL y solo en un producto de venta (PV). Vacío = «sin nombre de cocina»
 * (la comanda usa el nombre de arriba). Vive acá y no dentro de `producto-form.tsx` (que ya está sobre el tope de líneas y no puede crecer), igual que `campo-alicuota-iva.tsx`. El rótulo es el de Pedernal.
 */
export function CampoNombreDeCocina({ tipo, valorInicial, rotuloVisible = false }: { tipo: TipoProducto; valorInicial: string | null | undefined; rotuloVisible?: boolean }) {
  if (tipo !== "PV") return null;
  return <Campo name="nombreDeCocina" {...nombreDelCampo(rotuloVisible, "Nombre de cocina")} defaultValue={valorInicial ?? undefined} />;
}

/**
 * Lo que el campo agrega al pedido de guardado. Solo un PV lo manda; en la edición, vaciado a la vista = `null` explícito (borra; «ausente» sería «queda como estaba»); en el alta, vacío = no manda nada.
 * El servidor valida la ficha y el tipo, nunca confía en lo que mande la pantalla.
 */
export function nombreDeCocinaDelFormulario(form: FormData, tipo: TipoProducto, editando: boolean): { nombreDeCocina?: string | null } {
  if (tipo !== "PV") return {};
  const valor = texto(form.get("nombreDeCocina"));
  return valor ? { nombreDeCocina: valor } : editando ? { nombreDeCocina: null } : {};
}
