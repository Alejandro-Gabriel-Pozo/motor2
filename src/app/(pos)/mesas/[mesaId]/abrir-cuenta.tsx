"use client";

import { useState } from "react";
import { abrirCuenta } from "@/server/actions/pos/cuenta-apertura";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { useAccionMesa } from "./usar-accion";

/** Botones rápidos del diálogo de comensales: 1 a 6, el rango más común (docs/plan-comensales-y-limite-mesas-2026-09-26.md). */
const RAPIDOS = [1, 2, 3, 4, 5, 6] as const;

/**
 * «Abrir cuenta» de una mesa libre: pide primero la cantidad de comensales (obligatoria, SIN sugerir ningún valor — un default
 * sesgaría la métrica de rotación de mesas que existe para medir, ver el docstring de `Cuenta.comensales`). Botones rápidos 1-6 más
 * un campo "Otro" (1..99); la validación real es del servidor (`validarComensales`), este diálogo solo ordena el 1-99 en el campo
 * numérico. Si se llegó al límite de mesas abiertas de la sucursal, el servidor lo rechaza con el mensaje de negocio y el diálogo
 * queda abierto mostrándolo. Sin `pos_tomar_pedido` el botón queda deshabilitado (el servidor lo vuelve a verificar igual).
 */
export function AbrirCuenta({ mesaId, puede }: { mesaId: string; puede: boolean }) {
  const { ejecutar, pending, error, setError } = useAccionMesa();
  const [abierto, setAbierto] = useState(false);
  const [comensales, setComensales] = useState<number | null>(null);
  const [otro, setOtro] = useState("");

  const abrirDialogo = () => {
    setComensales(null);
    setOtro("");
    setError(null);
    setAbierto(true);
  };
  const cerrarDialogo = () => {
    if (!pending) setAbierto(false);
  };

  const elegirRapido = (n: number) => {
    setComensales(n);
    setOtro("");
  };
  const elegirOtro = (texto: string) => {
    setOtro(texto);
    const n = Number(texto.trim());
    setComensales(texto.trim() !== "" && Number.isInteger(n) ? n : null);
  };

  const confirmar = (e: React.FormEvent) => {
    e.preventDefault();
    if (comensales === null) {
      setError("Elegí cuántos comensales son.");
      return;
    }
    ejecutar(
      () => abrirCuenta(mesaId, comensales),
      () => setAbierto(false)
    );
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Boton variante="acento" disabled={!puede} title={puede ? undefined : "Tu rol puede ver la mesa pero no abrir cuentas."} onClick={abrirDialogo}>
        Abrir cuenta
      </Boton>
      {error && !abierto && (
        <Aviso variante="error" forma="en-linea">
          {error}
        </Aviso>
      )}

      <Dialogo abierto={abierto} titulo="¿Cuántos comensales?" onCerrar={cerrarDialogo} cerrable={!pending}>
        <p className="mb-4 text-sm text-tinta-suave">Es solo para medir la rotación de la mesa: no divide la cuenta por persona.</p>
        <form onSubmit={confirmar} className="flex flex-col gap-3">
          <div role="group" aria-label="Comensales" className="flex flex-wrap gap-1.5">
            {RAPIDOS.map((n) => (
              <Boton key={n} variante={comensales === n ? "acento" : "secundario"} tamano="tactil" className="min-w-11" aria-pressed={comensales === n} onClick={() => elegirRapido(n)}>
                {n}
              </Boton>
            ))}
          </div>
          <Campo
            etiqueta="Otro"
            inputMode="numeric"
            autoComplete="off"
            min={1}
            max={99}
            value={otro}
            onChange={(e) => elegirOtro(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder="Cantidad"
            error={error}
          />
          <div className="mt-1 flex justify-end gap-2">
            <Boton variante="secundario" onClick={cerrarDialogo}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="acento" disabled={pending}>
              {pending ? "Abriendo…" : "Confirmar apertura"}
            </Boton>
          </div>
        </form>
      </Dialogo>
    </div>
  );
}
