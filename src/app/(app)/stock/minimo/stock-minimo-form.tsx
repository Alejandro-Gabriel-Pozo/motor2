"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setStockMinimoProducto } from "@/server/actions/stock/stock-minimo";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoNumero } from "@/components/campo-numero";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Selector } from "@/ui/primitivas/selector";

export interface FilaStockMinimoEnEdicion {
  productoId: string;
  productoEtiqueta: string;
  seccionId: string;
  /** Dónde rige: el nombre del depósito o «Global (toda la sucursal)». */
  donde: string;
  minimo: string;
  /** El mínimo que la persona está viendo (Fase 7, «Cambiar mínimo»): el servidor solo guarda si la fila sigue teniéndolo (si otra persona lo cambió, avisa y no pisa). */
  minimoVisto: number;
}

export function StockMinimoForm({
  secciones,
  filaEnEdicion,
  soloLectura = false,
}: {
  secciones: { id: string; nombre: string }[];
  /** Antes había que rebuscar producto y sección desde cero cada vez que se quería ajustar un mínimo existente — hallazgo de la auditoría. */
  filaEnEdicion?: FilaStockMinimoEnEdicion;
  /** DEC-33: el rol puede VER el mínimo pero no EDITARLO: el formulario se dibuja deshabilitado (el aviso lo pone la página; el servidor rechaza igual). */
  soloLectura?: boolean;
}) {
  const router = useRouter();
  const editando = Boolean(filaEnEdicion);
  const [productoId, setProductoId] = useState(filaEnEdicion?.productoId ?? "");
  const [seccionId, setSeccionId] = useState(filaEnEdicion?.seccionId ?? "");
  const [minimo, setMinimo] = useState(filaEnEdicion?.minimo ?? "");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  const [resetCount, setResetCount] = useState(0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          // Editando una fila (también desde «Cambiar mínimo» de Alertas): se manda el mínimo que se está viendo, para no pisar el cambio de otra persona.
          const resultado = await setStockMinimoProducto(productoId, Number(minimo), seccionId || null, filaEnEdicion?.minimoVisto);
          setMensaje(resultado.mensaje);
          setOk(resultado.ok);
          // Si no se guardó porque otra persona lo cambió, se refresca para que la tabla y el valor visto sean los de hoy.
          if (!resultado.ok && editando) router.refresh();
          if (resultado.ok) {
            if (editando) {
              router.push("/stock/minimo");
            } else {
              setProductoId("");
              setMinimo("");
              setResetCount((n) => n + 1);
            }
            router.refresh();
          }
        });
      }}
      className="flex flex-col gap-3"
    >
      <fieldset disabled={soloLectura} className="flex min-w-0 flex-col gap-3">
        <h2 className="font-medium">{editando ? "Cambiar el stock mínimo" : "Fijar un stock mínimo"}</h2>

        {filaEnEdicion ? (
          // Editando una fila, el insumo y el depósito quedan fijos: lo que se cambia es SU mínimo (para otro depósito, se fija un mínimo nuevo).
          <dl className="flex flex-col gap-1 text-sm">
            <dt className="text-tinta-tenue">Insumo</dt>
            <dd>{filaEnEdicion.productoEtiqueta}</dd>
            <dt className="text-tinta-tenue">Depósito</dt>
            <dd>{filaEnEdicion.donde}</dd>
          </dl>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Insumo
              <SelectorProducto value={productoId} onChange={setProductoId} filtro={{ soloDisponibles: true }} limpiarSenal={resetCount} required />
            </label>

            <Selector etiqueta="Depósito (opcional — vacío = mínimo global de toda la sucursal)" value={seccionId} onChange={(e) => setSeccionId(e.target.value)}>
              <option value="">Global</option>
              {secciones.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </Selector>
          </>
        )}

        <label className="flex flex-col gap-1 text-sm">
          Mínimo
          <CampoNumero tipo="cantidad" value={minimo} onChange={setMinimo} required />
        </label>

        {mensaje && (
          <Aviso variante={ok ? "exito" : "error"} forma="en-linea">
            {mensaje}
          </Aviso>
        )}

        <Boton type="submit" disabled={pending || soloLectura} className="self-start">
          {pending ? "Guardando..." : "Guardar"}
        </Boton>
      </fieldset>
    </form>
  );
}
