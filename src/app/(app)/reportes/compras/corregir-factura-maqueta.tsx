"use client";

import { useState } from "react";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";

export interface RenglonParaCorregir {
  idMovimiento: string;
  producto: string;
  cantidad: number;
  unidad: string;
  /** Importe del renglón con IVA, en centavos (0 = sin dato). */
  importeCentavos: number;
  /** Lo que hay hoy en el depósito de ese producto. */
  saldo: number;
  /** `true` si este renglón es la entrada más reciente del producto (fija el costo de reposición). */
  esUltimaEntrada: boolean;
}

const MOTIVOS = ["Error de tipeo", "Faltó cargar el precio", "Cantidad mal cargada", "Producto equivocado", "Otro"];

const dinero = (centavos: number) => `$${(centavos / 100).toLocaleString("es-AR", { minimumFractionDigits: centavos % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const numero = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 4 });
/** «150.000» o «150.000,50» → centavos enteros; `null` si no es un importe válido. */
function aCentavos(texto: string): number | null {
  const limpio = texto.trim().replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  return Math.round(Number(limpio) * 100);
}
function aCantidad(texto: string): number | null {
  const limpio = texto.trim().replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(limpio)) return null;
  return Number(limpio);
}

/**
 * MAQUETA (rama temporal, no se mergea): «Corregir esta factura» según docs/diseno-correccion-de-compras-2026-11-06.md §4. Parte del documento: primero pregunta QUÉ corregir, después muestra el original
 * congelado y la copia editable, con el resumen «qué cambia» y los límites exactos. Es la pantalla real con los datos reales de la compra, pero NO guarda: falta el caso de uso y la migración del CHECK
 * (el botón lo dice). Los cálculos (total, precio por unidad, saldo final) son los de la propuesta.
 */
export function CorregirFacturaMaqueta({ nroFactura, proveedor, renglones }: { nroFactura: string; proveedor: string; renglones: RenglonParaCorregir[] }) {
  const [paso, setPaso] = useState<"cerrado" | "que" | "editar">("cerrado");
  const [marcas, setMarcas] = useState({ importe: false, cantidad: false });
  const [edicion, setEdicion] = useState(renglones.map((r) => ({ importe: "", cantidad: "" })));
  const [motivo, setMotivo] = useState(MOTIVOS[0]);

  if (paso === "cerrado") {
    return (
      <Boton variante="enlace" tamano="en-fila" className="self-start" onClick={() => setPaso("que")}>
        Corregir esta factura
      </Boton>
    );
  }

  if (paso === "que") {
    return (
      <div className="flex max-w-xl flex-col gap-3 rounded border p-3" data-corregir-que>
        <h3 className="text-sm font-semibold">Corregir factura {nroFactura}</h3>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">¿Qué querés corregir?</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={marcas.importe} onChange={(e) => setMarcas({ ...marcas, importe: e.target.checked })} />
            Un importe (precio) de un renglón
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={marcas.cantidad} onChange={(e) => setMarcas({ ...marcas, cantidad: e.target.checked })} />
            Una cantidad
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-tinta-tenue">
            <input type="checkbox" disabled />
            El producto de un renglón, o agregar/quitar un renglón (próxima etapa)
          </label>
        </fieldset>
        <p className="text-xs text-tinta-tenue">Si la factura no existió o es de otro día, no se corrige: se anula la compra y se carga de nuevo.</p>
        <div className="flex items-center gap-3">
          <Boton tamano="compacto" disabled={!marcas.importe && !marcas.cantidad} onClick={() => setPaso("editar")}>
            Seguir
          </Boton>
          <Boton variante="enlace" tamano="en-fila" onClick={() => setPaso("cerrado")}>
            Cancelar
          </Boton>
        </div>
      </div>
    );
  }

  // Lo que cambia, calculado con enteros (centavos) y el saldo del depósito.
  const filas = renglones.map((r, i) => {
    const importeNuevo = marcas.importe && edicion[i].importe.trim() !== "" ? aCentavos(edicion[i].importe) : r.importeCentavos;
    const cantidadNueva = marcas.cantidad && edicion[i].cantidad.trim() !== "" ? aCantidad(edicion[i].cantidad) : r.cantidad;
    const delta = cantidadNueva === null ? 0 : cantidadNueva - r.cantidad;
    const limite = delta < 0 && -delta > r.saldo ? r.cantidad - r.saldo : null;
    let error: string | null = null;
    if (importeNuevo === null) error = "El importe se escribe en pesos, por ejemplo 150.000 o 150.000,50.";
    else if (cantidadNueva === null || cantidadNueva <= 0) error = "La cantidad tiene que ser mayor que cero (para sacar un renglón se usa la próxima etapa).";
    else if (limite !== null) error = `Comprados ${numero(r.cantidad)} · hoy quedan ${numero(r.saldo)} · se puede bajar hasta ${numero(limite)}. Si devolviste mercadería al proveedor, registrala como Devolución a proveedor.`;
    return { r, importeNuevo, cantidadNueva, delta, error, cambiaImporte: importeNuevo !== null && importeNuevo !== r.importeCentavos, cambiaCantidad: delta !== 0 };
  });
  const hayError = filas.some((f) => f.error);
  const hayCambios = filas.some((f) => f.cambiaImporte || f.cambiaCantidad);
  const totalAntes = renglones.reduce((s, r) => s + r.importeCentavos, 0);
  const totalDespues = filas.reduce((s, f) => s + (f.importeNuevo ?? f.r.importeCentavos), 0);
  const porUnidad = (centavos: number, cantidad: number) => (cantidad > 0 ? Math.round(centavos / cantidad) : 0);

  return (
    <div className="flex max-w-xl flex-col gap-3 rounded border p-3" data-corregir-editar>
      <h3 className="text-sm font-semibold">Corregir factura {nroFactura}</h3>

      <section aria-label="Original" className="rounded bg-papel p-2 text-sm">
        <p className="mb-1 text-xs font-semibold text-tinta-tenue">ORIGINAL · versión 1 · {proveedor} · no se modifica</p>
        {renglones.map((r) => (
          <div key={r.idMovimiento} className="flex justify-between gap-2 text-tinta-tenue">
            <span>
              {r.producto} · {numero(r.cantidad)} {r.unidad}
            </span>
            <span className="tabular-nums">{r.importeCentavos > 0 ? dinero(r.importeCentavos) : "pendiente de completar"}</span>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t pt-1 font-medium text-tinta-tenue">
          <span>Total</span>
          <span className="tabular-nums">{dinero(totalAntes)}</span>
        </div>
      </section>

      <section aria-label="Como debería quedar" className="flex flex-col gap-2">
        <p className="text-xs font-semibold">COMO DEBERÍA QUEDAR · versión 2</p>
        {filas.map((f, i) => (
          <div key={f.r.idMovimiento} className={`flex flex-col gap-1 rounded border p-2 ${f.cambiaImporte || f.cambiaCantidad ? "border-marca bg-superficie" : ""}`}>
            <span className="text-sm font-medium">{f.r.producto}</span>
            {marcas.importe && (
              <Campo
                etiqueta={`Importe de ${f.r.producto} (con IVA)`}
                tamano="compacto"
                inputMode="decimal"
                prefijo="$"
                alinear="fin"
                placeholder={f.r.importeCentavos > 0 ? dinero(f.r.importeCentavos).slice(1) : "falta el importe"}
                value={edicion[i].importe}
                onChange={(e) => setEdicion(edicion.map((x, j) => (j === i ? { ...x, importe: e.target.value } : x)))}
              />
            )}
            {marcas.cantidad && (
              <Campo
                etiqueta={`Cantidad de ${f.r.producto} (${f.r.unidad})`}
                tamano="compacto"
                inputMode="decimal"
                alinear="fin"
                placeholder={numero(f.r.cantidad)}
                value={edicion[i].cantidad}
                onChange={(e) => setEdicion(edicion.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))}
              />
            )}
            {!marcas.cantidad && <span className="text-xs text-tinta-tenue">{numero(f.r.cantidad)} {f.r.unidad} · sin cambios</span>}
            {f.importeNuevo !== null && f.importeNuevo > 0 && !f.error && (
              <span className="text-xs text-tinta-tenue">
                Precio por unidad: {dinero(porUnidad(f.importeNuevo, f.cantidadNueva ?? f.r.cantidad))} (calculado)
                {f.cambiaCantidad && !f.cambiaImporte ? ` · el importe de este renglón sigue en ${dinero(f.importeNuevo)}: si el de la factura es otro, corregí también el importe` : ""}
              </span>
            )}
            {f.error && <Aviso variante="error">{f.error}</Aviso>}
          </div>
        ))}
      </section>

      <section aria-label="Qué cambia" className="rounded bg-papel p-2 text-sm" data-que-cambia>
        <p className="mb-1 text-xs font-semibold">QUÉ CAMBIA</p>
        <ul className="flex flex-col gap-0.5 text-xs">
          <li>
            Total de la factura: {dinero(totalAntes)} → <strong>{dinero(totalDespues)}</strong>
          </li>
          {filas.filter((f) => (f.cambiaImporte || f.cambiaCantidad) && !f.error && f.importeNuevo !== null && porUnidad(f.importeNuevo, f.cantidadNueva ?? f.r.cantidad) !== porUnidad(f.r.importeCentavos, f.r.cantidad)).map((f) => (
            <li key={`c-${f.r.idMovimiento}`}>
              {f.r.esUltimaEntrada
                ? `Costo de reposición de ${f.r.producto}: ${dinero(porUnidad(f.r.importeCentavos, f.r.cantidad))} → ${dinero(porUnidad(f.importeNuevo ?? 0, f.cantidadNueva ?? f.r.cantidad))} por unidad`
                : `El costo de reposición de ${f.r.producto} no cambia: hay una compra más reciente`}
            </li>
          ))}
          {filas.filter((f) => f.cambiaCantidad && !f.error).map((f) => (
            <li key={`s-${f.r.idMovimiento}`}>
              Stock de {f.r.producto}: {numero(f.r.saldo)} → <strong>{numero(f.r.saldo + f.delta)}</strong> ({f.delta > 0 ? "+" : ""}
              {numero(f.delta)})
            </li>
          ))}
          {!filas.some((f) => f.cambiaCantidad) && <li>Stock: no cambia</li>}
          {hayCambios && <li>Las ventas ya hechas recalculan su margen reconstruido con el precio corregido.</li>}
          {!hayCambios && <li className="text-tinta-tenue">Todavía no cambiaste nada.</li>}
        </ul>
      </section>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Motivo (obligatorio)</span>
        <select className="min-h-11 rounded border bg-superficie px-2 text-base md:min-h-9 md:text-sm" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
          {MOTIVOS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>

      <p className="text-xs text-aviso-tinta" data-maqueta>
        MAQUETA: esta pantalla muestra y calcula, pero todavía no guarda (falta el caso de uso y ampliar el CHECK de la base).
      </p>
      <div className="flex items-center gap-3">
        <Boton tamano="compacto" disabled>
          Guardar corrección
        </Boton>
        <Boton variante="enlace" tamano="en-fila" onClick={() => setPaso("cerrado")}>
          Cancelar
        </Boton>
      </div>
      {hayError && <span className="sr-only">Hay datos para corregir antes de guardar.</span>}
    </div>
  );
}
