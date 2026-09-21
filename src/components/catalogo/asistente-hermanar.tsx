"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { SelectorProducto } from "@/components/selector-producto";
import { obtenerInsumoDeProducto, asignarInsumoAProducto, type InsumoDeProducto } from "@/server/actions/catalogo/productos";
import { crearInsumo } from "@/server/actions/catalogo/insumos";
import { useLeerServidor } from "@/lib/use-leer-servidor";

/**
 * Asistente guiado para "hermanar" una MP nueva con una que ya existe
 * comprada a otro proveedor bajo otro nombre/código — reemplaza el
 * `<select>` crudo de Insumo por preguntas, a pedido explícito del usuario
 * ("no me parece que sea intuitivo"). Resuelve el Insumo de dos formas:
 * - Si la MP elegida ya tenía uno, lo reusa (confirmación de un click).
 * - Si no tenía, crea uno nuevo con el nombre que el usuario elija y lo
 *   asigna retroactivamente a AMBAS — la existente y la que se está por
 *   guardar — para que el grupo quede armado de los dos lados.
 */
export function AsistenteHermanar({
  unidadStockId,
  onResuelto,
}: {
  /** Unidad de stock elegida en el form que llama — para avisar (no bloquear, eso ya lo hace el guardado normal) si la MP elegida no es compatible. */
  unidadStockId: string;
  onResuelto: (insumoId: string, insumoNombre: string) => void;
}) {
  const [paso, setPaso] = useState<"buscar" | "confirmar" | "nombrar">("buscar");
  const [siblingId, setSiblingId] = useState("");
  const [info, setInfo] = useState<InsumoDeProducto | null>(null);
  const [nombreGrupo, setNombreGrupo] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const leer = useLeerServidor();
  const [pending, startTransition] = useTransition();

  function reset() {
    setPaso("buscar");
    setSiblingId("");
    setInfo(null);
    setNombreGrupo("");
    setMensaje(null);
  }

  function elegirSibling(id: string) {
    setSiblingId(id);
    if (!id) return;
    startTransition(async () => {
      const datos = await leer(
        () => obtenerInsumoDeProducto(id),
        () => setMensaje("No se pudo consultar ese producto. Revisá tu conexión; si venís trabajando hace rato, tu sesión pudo haber vencido: recargá la página.")
      );
      if (datos === undefined) return;
      setInfo(datos);
      if (datos?.insumoId) {
        setPaso("confirmar");
      } else {
        setNombreGrupo(datos?.productoNombre ?? "");
        setPaso("nombrar");
      }
    });
  }

  const chocaUnidad = Boolean(info && unidadStockId && info.unidadStockId !== unidadStockId);

  return (
    <Modal triggerLabel="¿Ya comprás esto a otro proveedor con otro nombre? — ayudame a agruparlo" title="Agrupar con un producto existente">
      {(cerrar) => (
        <div className="flex flex-col gap-3">
          {paso === "buscar" && (
            <>
              <p className="text-sm text-neutral-500">
                Buscá la materia prima que ya tenés cargada para esto mismo — aunque se la compres con otro nombre o código a otro proveedor.
              </p>
              <SelectorProducto
                value={siblingId}
                onChange={elegirSibling}
                filtro={{ tipo: "MP", soloActivos: true }}
                placeholder="Buscar materia prima existente…"
              />
            </>
          )}

          {paso === "confirmar" && info && (
            <>
              <p className="text-sm">
                <strong>
                  {info.productoCodigo} — {info.productoNombre}
                </strong>{" "}
                ya está agrupada bajo el insumo <strong>&quot;{info.insumoNombre}&quot;</strong>.
              </p>
              <p className="text-sm text-neutral-500">¿Sumamos este producto nuevo al mismo grupo? Van a compartir stock para lo que se venda por receta.</p>
              {chocaUnidad && (
                <p className="text-sm text-amber-700 dark:text-amber-600">
                  Ojo: esa MP usa unidad de stock &quot;{info.unidadStockNombre}&quot;, distinta a la que elegiste acá — el sistema no va a dejar guardar
                  así, revisá la unidad antes de confirmar.
                </p>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded bg-neutral-900 px-4 py-2 text-sm text-white"
                  onClick={() => {
                    onResuelto(info.insumoId!, info.insumoNombre!);
                    reset();
                    cerrar();
                  }}
                >
                  Confirmar, mismo grupo
                </button>
                <button type="button" className="text-sm underline" onClick={() => setPaso("buscar")}>
                  Elegir otro
                </button>
              </div>
            </>
          )}

          {paso === "nombrar" && info && (
            <>
              <p className="text-sm">
                <strong>
                  {info.productoCodigo} — {info.productoNombre}
                </strong>{" "}
                todavía no tiene un grupo (Insumo). Le creamos uno y agrupamos ahí a las dos.
              </p>
              {chocaUnidad && (
                <p className="text-sm text-amber-700 dark:text-amber-600">
                  Ojo: esa MP usa unidad de stock &quot;{info.unidadStockNombre}&quot;, distinta a la que elegiste acá — el sistema no va a dejar guardar
                  así, revisá la unidad antes de confirmar.
                </p>
              )}
              <label className="text-sm">Nombre del grupo</label>
              <input value={nombreGrupo} onChange={(e) => setNombreGrupo(e.target.value)} className="rounded border px-3 py-2" autoFocus />
              {mensaje && <p className="text-sm text-red-600">{mensaje}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={pending || !nombreGrupo.trim()}
                  className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                  onClick={() => {
                    startTransition(async () => {
                      const creado = await crearInsumo(nombreGrupo);
                      if (!creado.ok) {
                        setMensaje(creado.mensaje);
                        return;
                      }
                      const asignado = await asignarInsumoAProducto(siblingId, creado.id);
                      if (!asignado.ok) {
                        setMensaje(asignado.mensaje);
                        return;
                      }
                      onResuelto(creado.id, creado.nombre);
                      reset();
                      cerrar();
                    });
                  }}
                >
                  {pending ? "Agrupando…" : "Crear grupo y agrupar"}
                </button>
                <button type="button" className="text-sm underline" onClick={() => setPaso("buscar")}>
                  Elegir otro
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
