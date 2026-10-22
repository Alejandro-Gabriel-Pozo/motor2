"use client";

import { useState } from "react";
import { anularPromoEnviada } from "@/server/actions/pos/cuenta-anulacion";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { AreaDeTexto } from "@/ui/primitivas/area-de-texto";
import { Boton } from "@/ui/primitivas/boton";
import { useAccionMesa } from "./usar-accion";

/**
 * «Anular» una promo que YA SALIÓ a cocina (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 11, D4): siempre TODOS sus
 * componentes juntos, nunca uno solo — por eso no pide cantidad (a diferencia de `AnularItem`), solo el motivo, obligatorio.
 * Mismo patrón de diálogo que `AnularItem` (el `Dialogo` del sistema: modal nativo, Escape cierra, y no se cierra mientras se anula). Sin `pos_anular_item`, deshabilitado.
 *
 * No imprime un aviso de cocina propio: cada componente anulado sigue viéndose (tachado) en su línea de envío de siempre, con
 * el mismo motivo — no hace falta un ticket aparte por promo.
 */
export function AnularPromo({ promoCuentaId, titulo, puede }: { promoCuentaId: string; titulo: string; puede: boolean }) {
  const { ejecutar, pending, error, setError } = useAccionMesa();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");

  const abrir = () => {
    setMotivo("");
    setError(null);
    setAbierto(true);
  };
  const cerrar = () => {
    if (!pending) setAbierto(false);
  };
  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    ejecutar(
      () => anularPromoEnviada(promoCuentaId, motivo),
      () => setAbierto(false)
    );
  };

  return (
    <>
      <Boton
        variante="secundario"
        tamano="compacto"
        className="min-w-11"
        disabled={!puede}
        title={puede ? undefined : "Anular algo que ya salió a cocina requiere un permiso que tu rol no tiene."}
        aria-label={`Anular promo ${titulo}`}
        onClick={abrir}
      >
        Anular promo
      </Boton>

      <Dialogo abierto={abierto} titulo={`Anular promo «${titulo}»`} onCerrar={cerrar} cerrable={!pending}>
        <p className="mb-4 text-sm text-tinta-suave">Ya salió a cocina: se anulan TODOS sus componentes juntos, nunca uno solo. Queda registrado quién lo anuló y por qué.</p>
        <form onSubmit={enviar} className="flex flex-col gap-3">
          <AreaDeTexto etiqueta="Motivo (obligatorio)" data-foco-inicial="" maxLength={200} aria-required="true" value={motivo} onChange={(e) => setMotivo(e.target.value)} error={error} />
          <div className="mt-1 flex justify-end gap-2">
            <Boton variante="secundario" onClick={cerrar}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" disabled={pending}>
              {pending ? "Anulando…" : "Anular promo"}
            </Boton>
          </div>
        </form>
      </Dialogo>
    </>
  );
}
