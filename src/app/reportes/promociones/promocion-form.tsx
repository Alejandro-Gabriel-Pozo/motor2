"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { actualizarPromocionesHabilitado, marcarProductoComoPromocion, type CandidatoPromocion } from "@/server/actions/promociones";

export function PromocionForm({ habilitado, candidatos }: { habilitado: boolean; candidatos: CandidatoPromocion[] }) {
  const router = useRouter();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const toggleHabilitado = () => {
    startTransition(async () => {
      const resultado = await actualizarPromocionesHabilitado(!habilitado);
      setMensaje(resultado.mensaje);
      setOk(resultado.ok);
      if (resultado.ok) router.refresh();
    });
  };

  const toggleProducto = (productoId: string, activa: boolean) => {
    startTransition(async () => {
      const resultado = await marcarProductoComoPromocion(productoId, activa);
      setMensaje(resultado.mensaje);
      setOk(resultado.ok);
      if (resultado.ok) router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleHabilitado}
          disabled={pending}
          className={`rounded px-4 py-2 text-sm text-white disabled:opacity-50 ${habilitado ? "bg-red-600" : "bg-neutral-900"}`}
        >
          {habilitado ? "Desactivar Promociones y Combos" : "Activar Promociones y Combos"}
        </button>
        <span className="text-sm text-neutral-500">{habilitado ? "Feature activada para esta sucursal." : "Feature apagada — no se usan combos acá."}</span>
      </div>

      {mensaje && <p className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}

      {habilitado && (
        <div>
          <h2 className="mb-2 text-sm font-medium">PV con receta — marcá cuáles son Promoción/Combo</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="py-1">Producto</th>
                <th>Promoción/Combo</th>
              </tr>
            </thead>
            <tbody>
              {candidatos.map((c) => (
                <tr key={c.productoId} className="border-b">
                  <td className="py-1">
                    {c.codigo} — {c.nombre}
                  </td>
                  <td>
                    <input type="checkbox" checked={c.activa} disabled={pending} onChange={(e) => toggleProducto(c.productoId, e.target.checked)} />
                  </td>
                </tr>
              ))}
              {!candidatos.length && (
                <tr>
                  <td className="py-1 text-neutral-500" colSpan={2}>
                    Ningún PV activo tiene receta cargada todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
