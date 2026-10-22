"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";

/** Lo que «Otro igual» le pide a «Agregar al pedido»: el producto y lo elegido en la línea de la cuenta. */
export interface PedidoOtroIgual {
  productoId: string;
  elegidas: { opcionId: string; cantidad: number }[];
}

/** Abre el diálogo «Elegir opciones» con esa elección; `false` si el producto hoy no se puede pedir con opciones desde el selector. */
type AbrirOtroIgual = (pedido: PedidoOtroIgual) => boolean;

const Contexto = createContext<{ pedir: AbrirOtroIgual; registrar: (abrir: AbrirOtroIgual | null) => void }>({ pedir: () => false, registrar: () => {} });

/**
 * GO-2d: «Otro igual» desde una línea que ya está en la cuenta (sin enviar o en cocina). La línea está en otra parte de la pantalla que «Agregar al pedido», así que el pedido viaja
 * por este contexto: «Agregar al pedido» registra cómo abrir su diálogo y el botón de la línea lo llama. No pide nada al servidor: arranca el diálogo con esa elección (solo lo que hoy
 * se puede elegir) y el mozo confirma; al agregar, el servidor vuelve a armar la línea con lo vigente.
 */
export function OtroIgualProvider({ children }: { children: React.ReactNode }) {
  const abrir = useRef<AbrirOtroIgual | null>(null);
  const registrar = useCallback((fn: AbrirOtroIgual | null) => {
    abrir.current = fn;
  }, []);
  const valor = useMemo(() => ({ pedir: (p: PedidoOtroIgual) => abrir.current?.(p) ?? false, registrar }), [registrar]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useRegistrarOtroIgual() {
  return useContext(Contexto).registrar;
}

/** El botón «Otro igual» de una línea de la cuenta con opciones. */
export function OtroIgual({ pedido, titulo, puede }: { pedido: PedidoOtroIgual; titulo: string; puede: boolean }) {
  const { pedir } = useContext(Contexto);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Boton
        variante="secundario"
        tamano="compacto"
        className="min-w-11"
        disabled={!puede}
        title={puede ? undefined : "Tu rol puede ver la mesa pero no tomar pedidos."}
        aria-label={`Otro igual a ${titulo}`}
        onClick={() => setError(pedir(pedido) ? null : `«${titulo}» hoy no se puede pedir con opciones desde la carta.`)}
      >
        Otro igual
      </Boton>
      {error && (
        <Aviso variante="error" forma="en-linea">
          {error}
        </Aviso>
      )}
    </>
  );
}
