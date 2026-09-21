"use client";

import { useState, useTransition } from "react";
import { CampoNumero } from "@/components/campo-numero";
import { AyudaCampo } from "@/components/ayuda-campo";
import { useLeerServidor } from "@/lib/use-leer-servidor";
import {
  agregarPresentacionAlternativa,
  actualizarActivaPresentacion,
  listarPresentaciones,
  type PresentacionOpcion,
} from "@/server/actions/catalogo/productos";

interface Opcion {
  id: string;
  nombre: string;
}

/**
 * agregarPresentacionAlternativa/actualizarActivaPresentacion existían en
 * el modelo y las lee registrarMovimiento (item.unidadCompraId) al
 * registrar una Compra, pero no tenían ningún caller en src/app — no había
 * ninguna pantalla para crearlas, así que el circuito nunca se podía
 * cerrar. Esta es esa pantalla, dentro del form de edición de un producto
 * (solo tiene sentido con el producto ya creado — Presentacion es FK a él).
 */
export function GestionPresentaciones({
  productoId,
  unidades,
  presentacionesIniciales,
}: {
  productoId: string;
  unidades: Opcion[];
  presentacionesIniciales: PresentacionOpcion[];
}) {
  const [presentaciones, setPresentaciones] = useState(presentacionesIniciales);
  const [unidadCompraId, setUnidadCompraId] = useState("");
  const [factorConversion, setFactorConversion] = useState("");
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const leer = useLeerServidor();

  /** Vuelve a leer la lista después de una escritura; si la lectura falla la escritura igual quedó hecha, y se avisa. */
  async function recargarLista() {
    const lista = await leer(
      () => listarPresentaciones(productoId),
      () => setResultado({ ok: false, texto: "Se guardó, pero no se pudo actualizar la lista. Revisá tu conexión; si venís trabajando hace rato, tu sesión pudo haber vencido: recargá la página." })
    );
    if (lista) setPresentaciones(lista);
  }

  function agregar() {
    if (!unidadCompraId || !factorConversion) return;
    startTransition(async () => {
      const r = await agregarPresentacionAlternativa(productoId, unidadCompraId, Number(factorConversion));
      setResultado({ ok: r.ok, texto: r.mensaje });
      if (r.ok) {
        setUnidadCompraId("");
        setFactorConversion("");
        await recargarLista();
      }
    });
  }

  function toggle(p: PresentacionOpcion) {
    startTransition(async () => {
      const r = await actualizarActivaPresentacion(p.id, !p.activa);
      setResultado({ ok: r.ok, texto: r.mensaje });
      if (r.ok) await recargarLista();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded border p-3">
      <span className="text-sm font-medium">Presentaciones de compra alternativas</span>
      <AyudaCampo>
        Además de la unidad de compra por defecto de arriba, podés registrar otras formas en que comprás esto mismo (ej. también &quot;por
        caja&quot;, no solo &quot;por bolsa&quot;) — al registrar una Compra vas a poder elegir cuál usaste.
      </AyudaCampo>

      {presentaciones.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1">Unidad de compra</th>
              <th>Factor de conversión</th>
              <th>Activa</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {presentaciones.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="py-1">{p.unidadCompraNombre}</td>
                <td>{p.factorConversion}</td>
                <td>{p.activa ? "Sí" : "No"}</td>
                <td>
                  <button type="button" disabled={pending} className="underline" onClick={() => toggle(p)}>
                    {p.activa ? "Desactivar" : "Activar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs text-neutral-500">
          Unidad de compra
          <select value={unidadCompraId} onChange={(e) => setUnidadCompraId(e.target.value)} className="rounded border px-2 py-1.5 text-sm">
            <option value="">Elegí una unidad</option>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-40 flex-col gap-1 text-xs text-neutral-500">
          Factor de conversión
          <CampoNumero value={factorConversion} onChange={setFactorConversion} tamano="compacto" />
        </label>
        <button
          type="button"
          disabled={pending || !unidadCompraId || !factorConversion}
          className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={agregar}
        >
          Agregar
        </button>
      </div>

      {resultado && <p className={`text-xs ${resultado.ok ? "text-green-700" : "text-red-600"}`}>{resultado.texto}</p>}
    </div>
  );
}
