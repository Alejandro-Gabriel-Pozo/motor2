"use client";

import { useState, useTransition } from "react";
import { previsualizarFusionInsumo, renombrarOFusionarInsumo } from "@/server/actions/catalogo/insumos";
import { useLeerServidor } from "@/lib/use-leer-servidor";

/**
 * Reemplaza el <form action={server action}> crudo que había en
 * insumos-grupos/page.tsx: ese descartaba el ResultadoAccion (fusiones
 * fallidas por unidad mezclada quedaban invisibles) y fusionaba sin avisar
 * que "Renombrar" con un nombre existente borra el insumo viejo. Acá se
 * previsualiza antes de tocar nada y se muestra siempre el resultado.
 */
export function FormRenombrarInsumo({ insumoId, nombreActual }: { insumoId: string; nombreActual: string }) {
  const [nombre, setNombre] = useState(nombreActual);
  const [fusionaCon, setFusionaCon] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const leer = useLeerServidor();

  function intentarGuardar() {
    setResultado(null);
    startTransition(async () => {
      const destino = await leer(
        () => previsualizarFusionInsumo(insumoId, nombre),
        () => setResultado({ ok: false, texto: "No se pudo comprobar si ya existe un insumo con ese nombre. Si venís trabajando hace rato, tu sesión pudo haber vencido: recargá la página." })
      );
      if (destino === undefined) return;
      if (destino) {
        setFusionaCon(destino);
        return;
      }
      const r = await renombrarOFusionarInsumo(insumoId, nombre);
      setResultado({ ok: r.ok, texto: r.mensaje });
    });
  }

  function confirmarFusion() {
    startTransition(async () => {
      const r = await renombrarOFusionarInsumo(insumoId, nombre, true);
      setFusionaCon(null);
      setResultado({ ok: r.ok, texto: r.mensaje });
    });
  }

  if (fusionaCon) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <p className="text-amber-600">
          Ya existe &quot;{fusionaCon}&quot; — esto va a fusionar &quot;{nombreActual}&quot; ahí adentro (sus productos pasan a &quot;{fusionaCon}
          &quot; y &quot;{nombreActual}&quot; se borra). ¿Confirmás?
        </p>
        <div className="flex gap-3">
          <button type="button" disabled={pending} className="text-red-600 underline" onClick={confirmarFusion}>
            {pending ? "Fusionando…" : "Sí, fusionar"}
          </button>
          <button type="button" className="underline" onClick={() => setFusionaCon(null)}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-32 rounded border px-2 py-1" />
        <button type="button" disabled={pending} className="text-sm underline" onClick={intentarGuardar}>
          {pending ? "Guardando…" : "Renombrar/fusionar"}
        </button>
      </div>
      {resultado && <p className={`text-xs ${resultado.ok ? "text-green-700" : "text-red-600"}`}>{resultado.texto}</p>}
    </div>
  );
}
