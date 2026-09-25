"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { setPrecioLocalProducto, sincronizarPrecioLocalGrupoCarta } from "@/server/actions/movimientos/precio-local";
import { obtenerPrecioVentaProducto } from "@/server/actions/catalogo/productos";
import { useLeerServidor } from "@/lib/use-leer-servidor";
import { SelectorProducto } from "@/components/selector-producto";
import { CampoNumero } from "@/components/campo-numero";
import { SincronizarPrecioGrupo } from "@/components/carta/sincronizar-precio-grupo";
import type { SincronizablePrecioGrupo } from "@/server/actions/tipos";

/** `sucursalId`: la sucursal activa que ve la pantalla (la acción de sincronizar la vuelve a comparar con la del servidor). */
export function PrecioLocalForm({ sucursalId }: { sucursalId: string }) {
  const router = useRouter();
  const [productoId, setProductoId] = useState("");
  const [precio, setPrecio] = useState("");
  const [habilitado, setHabilitado] = useState(true);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  const [resetCount, setResetCount] = useState(0);
  const [precioGlobal, setPrecioGlobal] = useState<number | null>(null);
  // D11/M8 (docs/plan-agrupacion-items-carta-2026-09-24.md): hermanos del ítem agrupado de la carta que quedaron a otro precio acá.
  const [sincronizable, setSincronizable] = useState<SincronizablePrecioGrupo | null>(null);
  const leer = useLeerServidor();

  useEffect(() => {
    if (!productoId) return;
    let cancelado = false;
    leer(
      () => obtenerPrecioVentaProducto(productoId),
      () => {
        if (cancelado) return;
        setMensaje("No se pudo leer el precio de venta actual. Revisá tu conexión; si venís trabajando hace rato, tu sesión pudo haber vencido: recargá la página.");
        setOk(false);
      }
    ).then((p) => {
      if (!cancelado && p !== undefined) setPrecioGlobal(p);
    });
    return () => {
      cancelado = true;
    };
  }, [productoId, leer]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const resultado = await setPrecioLocalProducto(productoId, Number(precio), habilitado);
          setMensaje(resultado.mensaje);
          setOk(resultado.ok);
          setSincronizable(resultado.ok ? (resultado.sincronizable ?? null) : null);
          if (resultado.ok) {
            setProductoId("");
            setPrecio("");
            setResetCount((n) => n + 1);
            router.refresh();
          }
        });
      }}
      className="flex flex-col gap-3"
    >
      <h2 className="font-medium">Fijar precio local</h2>

      <label className="flex flex-col gap-1 text-sm">
        Producto (PV)
        <SelectorProducto value={productoId} onChange={setProductoId} filtro={{ tipo: "PV", soloDisponibles: true }} limpiarSenal={resetCount} required />
      </label>

      {productoId && precioGlobal !== null && <p className="text-xs text-neutral-500">Precio global actual: ${precioGlobal.toLocaleString("es-AR")}</p>}

      <label className="flex flex-col gap-1 text-sm">
        Precio local
        <CampoNumero value={precio} onChange={setPrecio} prefijo="$" required />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={habilitado} onChange={(e) => setHabilitado(e.target.checked)} /> Habilitado (si no, se usa el precio global igual)
      </label>

      {mensaje && <p className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}>{mensaje}</p>}

      {sincronizable && (
        <SincronizarPrecioGrupo
          sincronizable={sincronizable}
          aplicar={async (productoIds, precioNuevo) => {
            const r = await sincronizarPrecioLocalGrupoCarta(sucursalId, productoIds, precioNuevo, true);
            // Bien: el bloque se cierra y su resultado pasa al mensaje del formulario (si no, se perdería al cerrarlo).
            if (r.ok) {
              setMensaje(r.mensaje);
              setOk(true);
            }
            return r;
          }}
          alTerminar={(aplicado) => {
            setSincronizable(null);
            if (aplicado) router.refresh();
          }}
        />
      )}

      <button type="submit" disabled={pending} className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Guardando..." : "Guardar"}
      </button>
    </form>
  );
}
