"use client";

import { EnlaceInterno } from "@/components/enlace-interno";
import { useState, useTransition } from "react";
import { corregirImportesDeCompra } from "@/server/actions/movimientos/compras";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { CampoNumero } from "@/components/campo-numero";
import { Campo } from "@/ui/primitivas/campo";
import { Casilla } from "@/ui/primitivas/casilla";
import { Selector } from "@/ui/primitivas/selector";

export interface RenglonParaCorregir {
  idMovimiento: string;
  producto: string;
  cantidad: number;
  unidad: string;
  /** Importe del renglón con IVA, en centavos (0 = sin dato). */
  importeCentavos: number;
  /** `true` si este renglón es la entrada más reciente del producto (fija el costo de reposición). */
  esUltimaEntrada: boolean;
}

export interface MotivoParaElegir {
  id: string;
  nombre: string;
}

const dinero = (centavos: number) => `$${(centavos / 100).toLocaleString("es-AR", { minimumFractionDigits: centavos % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const numero = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 4 });
/** El texto canónico que emite `CampoNumero` («150000» o «150000.5»: dígitos y un solo punto decimal) → centavos enteros, sin pasar por decimales flotantes; `null` si no es un importe válido. El servidor revalida. */
function aCentavos(canonico: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(canonico.trim());
  if (!m) return null;
  const centavos = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(centavos) && centavos >= 1 ? centavos : null;
}
const porUnidad = (centavos: number, cantidad: number) => (cantidad > 0 ? Math.round(centavos / cantidad) : 0);

/**
 * Paso 2 de «Corregir una factura de compra» (etapa C0, docs/diseno-correccion-de-compras-2026-11-06.md §4): a la izquierda el ORIGINAL congelado y a la derecha «cómo debería quedar» (dos columnas en escritorio, apiladas en
 * celular). Se marca qué corregir (hoy: un importe), se escribe el importe NUEVO de cada renglón (el del papel, con IVA; el precio por unidad se calcula solo), se ve «qué cambia» y se elige el motivo de la lista configurable. Corregir un
 * importe NO mueve stock, así que no hay límites de cantidad. El servidor revalida todo; la clave de reintento (UUID) se genera al abrir y se reenvía tal cual si se repite el envío (no duplica).
 */
export function CorregirFacturaDosColumnas({ operacionId, renglones, motivos, sinProveedor }: { operacionId: string; renglones: RenglonParaCorregir[]; motivos: MotivoParaElegir[]; sinProveedor: boolean }) {
  const [marcaImporte, setMarcaImporte] = useState(false);
  const [edicion, setEdicion] = useState(renglones.map(() => ""));
  const [motivoId, setMotivoId] = useState("");
  const [detalle, setDetalle] = useState("");
  const [clave] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filas = renglones.map((r, i) => {
    const escrito = marcaImporte && edicion[i].trim() !== "";
    const nuevo = escrito ? aCentavos(edicion[i]) : r.importeCentavos;
    const invalido = escrito && nuevo === null;
    return { r, nuevo, invalido, cambia: escrito && nuevo !== null && nuevo !== r.importeCentavos, escrito };
  });
  const hayInvalido = filas.some((f) => f.invalido);
  const hayCambios = filas.some((f) => f.cambia);
  const totalAntes = renglones.reduce((s, r) => s + r.importeCentavos, 0);
  const totalDespues = filas.reduce((s, f) => s + (f.nuevo ?? f.r.importeCentavos), 0);

  if (hecho) {
    return (
      <div className="flex max-w-xl flex-col gap-3" data-corregida>
        <Aviso variante="exito">{hecho}</Aviso>
        <div className="flex gap-4 text-sm">
          <EnlaceInterno href="/reportes/compras" className="underline">
            Ver Compras registradas
          </EnlaceInterno>
          <EnlaceInterno href="/movimientos/corregir-compra" className="underline">
            Corregir otra factura
          </EnlaceInterno>
        </div>
      </div>
    );
  }

  function guardar() {
    const importes = filas.filter((f) => f.cambia && f.nuevo !== null).map((f) => ({ movimientoId: f.r.idMovimiento, importeEnCentavos: f.nuevo as number }));
    startTransition(async () => {
      const r = await corregirImportesDeCompra({ operacionId, importes, motivoId, detalleMotivo: detalle.trim() || undefined, claveIdempotencia: clave });
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      setError(null);
      setHecho(r.mensaje);
    });
  }

  return (
    <form
      className="grid gap-4 lg:grid-cols-2"
      data-corregir-factura
      onSubmit={(e) => {
        e.preventDefault();
        guardar();
      }}
    >
      <section aria-label="Original" className="self-start rounded border bg-papel p-3 text-sm">
        <h2 className="mb-2 text-sm font-semibold text-tinta-tenue">ORIGINAL · versión 1 · no se modifica</h2>
        {renglones.map((r) => (
          <div key={r.idMovimiento} className="flex justify-between gap-2 py-0.5 text-tinta-tenue">
            <span>
              {r.producto} · {numero(r.cantidad)} {r.unidad}
            </span>
            <span className="tabular-nums">{r.importeCentavos > 0 ? dinero(r.importeCentavos) : "pendiente de completar"}</span>
          </div>
        ))}
        <div className="mt-2 flex justify-between border-t pt-2 font-semibold text-tinta-tenue">
          <span>Total</span>
          <span className="tabular-nums">{dinero(totalAntes)}</span>
        </div>
      </section>

      <section aria-label="Como debería quedar" className="flex flex-col gap-3 rounded border p-3">
        <h2 className="text-sm font-semibold">COMO DEBERÍA QUEDAR · versión 2</h2>
        <fieldset className="flex flex-wrap gap-x-5 gap-y-1">
          <legend className="mb-1 text-sm font-medium">¿Qué querés corregir?</legend>
          <Casilla etiqueta="Un importe (precio)" checked={marcaImporte} onChange={(e) => setMarcaImporte(e.target.checked)} />
          <Casilla etiqueta="Cantidad, producto, renglones, proveedor y N.º (próximas etapas)" checked={false} disabled readOnly />
        </fieldset>
        {sinProveedor && <p className="text-xs text-aviso-tinta">Esta compra no tiene proveedor: completarlo es parte de una próxima etapa.</p>}

        {!marcaImporte ? (
          <p className="text-sm text-tinta-tenue">Marcá qué querés corregir y se abren los campos.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {filas.map((f, i) => (
              <div key={f.r.idMovimiento} className={`flex flex-col gap-1 rounded border p-2 ${f.cambia ? "border-marca bg-superficie" : ""}`}>
                <span className="text-sm font-medium">{f.r.producto}</span>
                <span className="text-xs font-medium">Importe de {f.r.producto} (con IVA)</span>
                <CampoNumero
                  tipo="importe"
                  etiqueta="El importe"
                  ariaLabel={`Importe de ${f.r.producto} (con IVA)`}
                  tamano="compacto"
                  prefijo="$"
                  placeholder={f.r.importeCentavos > 0 ? dinero(f.r.importeCentavos).slice(1) : "falta el importe"}
                  value={edicion[i]}
                  onChange={(valor) => setEdicion(edicion.map((x, j) => (j === i ? valor : x)))}
                />
                {f.nuevo !== null && f.nuevo > 0 && !f.invalido && <span className="text-xs text-tinta-tenue">Precio por unidad: {dinero(porUnidad(f.nuevo, f.r.cantidad))} (calculado)</span>}
              </div>
            ))}
          </div>
        )}

        <div className="rounded bg-papel p-2 text-sm" data-que-cambia>
          <p className="mb-1 text-xs font-semibold">QUÉ CAMBIA</p>
          <ul className="flex flex-col gap-0.5 text-xs">
            <li>
              Total de la factura: {dinero(totalAntes)} → <strong>{dinero(totalDespues)}</strong>
            </li>
            {filas.filter((f) => f.cambia && f.nuevo !== null).map((f) => (
              <li key={`c-${f.r.idMovimiento}`}>
                {f.r.importeCentavos === 0
                  ? `Al completar el importe, ${f.r.producto} empieza a fijar el costo de reposición: ${dinero(porUnidad(f.nuevo ?? 0, f.r.cantidad))} por unidad`
                  : f.r.esUltimaEntrada
                    ? `Costo de reposición de ${f.r.producto}: ${dinero(porUnidad(f.r.importeCentavos, f.r.cantidad))} → ${dinero(porUnidad(f.nuevo ?? 0, f.r.cantidad))} por unidad`
                    : `El costo de reposición de ${f.r.producto} no cambia: hay una compra más reciente`}
              </li>
            ))}
            <li>Stock: no cambia</li>
            {hayCambios && <li>Las ventas ya hechas recalculan su margen reconstruido con el precio corregido.</li>}
            {!hayCambios && <li className="text-tinta-tenue">Todavía no cambiaste nada.</li>}
          </ul>
        </div>

        {motivos.length === 0 ? (
          <p className="text-sm text-error">
            No hay motivos de corrección configurados. Agregalos en{" "}
            <EnlaceInterno href="/movimientos/motivos-merma" className="underline">
              Configuración → Motivos
            </EnlaceInterno>
            .
          </p>
        ) : (
          <>
            <Selector etiqueta="Motivo (obligatorio)" value={motivoId} onChange={(e) => setMotivoId(e.target.value)} required>
              <option value="">Elegí el motivo</option>
              {motivos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </Selector>
            <Campo etiqueta="Detalle (opcional)" tamano="compacto" value={detalle} onChange={(e) => setDetalle(e.target.value)} maxLength={150} />
          </>
        )}

        {error && <Aviso variante="error">{error}</Aviso>}
        <div className="flex items-center gap-3">
          <Boton type="submit" disabled={pending || !hayCambios || hayInvalido || !motivoId}>
            {pending ? "Guardando…" : "Guardar corrección"}
          </Boton>
          <EnlaceInterno href="/movimientos/corregir-compra" className="text-sm underline">
            Cancelar
          </EnlaceInterno>
        </div>
      </section>
    </form>
  );
}
