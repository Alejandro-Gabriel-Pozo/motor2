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
  minimo: string;
}

export function StockMinimoForm({
  secciones,
  filaEnEdicion,
}: {
  secciones: { id: string; nombre: string }[];
  /** Antes había que rebuscar producto y sección desde cero cada vez que se quería ajustar un mínimo existente — hallazgo de la auditoría. */
  filaEnEdicion?: FilaStockMinimoEnEdicion;
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
          const resultado = await setStockMinimoProducto(productoId, Number(minimo), seccionId || null);
          setMensaje(resultado.mensaje);
          setOk(resultado.ok);
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
      <h2 className="font-medium">{editando ? "Editar Stock Mínimo" : "Fijar Stock Mínimo"}</h2>

      <label className="flex flex-col gap-1 text-sm">
        Producto
        <SelectorProducto
          value={productoId}
          onChange={setProductoId}
          filtro={{ soloDisponibles: true }}
          etiquetaInicial={filaEnEdicion?.productoEtiqueta}
          limpiarSenal={resetCount}
          required
        />
      </label>

      <Selector etiqueta="Sección (opcional — vacío = mínimo global de toda la sucursal)" value={seccionId} onChange={(e) => setSeccionId(e.target.value)}>
        <option value="">Global</option>
        {secciones.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
          </option>
        ))}
      </Selector>

      <label className="flex flex-col gap-1 text-sm">
        Mínimo
        <CampoNumero tipo="cantidad" value={minimo} onChange={setMinimo} required />
      </label>

      {mensaje && (
        <Aviso variante={ok ? "exito" : "error"} forma="en-linea">
          {mensaje}
        </Aviso>
      )}

      <Boton type="submit" disabled={pending} className="self-start">
        {pending ? "Guardando..." : "Guardar"}
      </Boton>
    </form>
  );
}
