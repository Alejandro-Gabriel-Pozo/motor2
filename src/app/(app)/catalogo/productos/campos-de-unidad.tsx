"use client";

import { CampoNumero } from "@/components/campo-numero";
import { ValorSoloLectura } from "@/components/catalogo/campos-sensibles-solo-lectura";
import { AyudaDeFicha } from "@/components/catalogo/ayuda-de-ficha";
import { formatearCantidad } from "@/core/formato-de-numero";
import type { TipoProducto } from "@/core/datos/enumerados-del-esquema";
import { Selector } from "@/ui/primitivas/selector";

export interface OpcionUnidad {
  id: string;
  nombre: string;
  /** 0-6: cuántos decimales admite — para validar `factorConversion` con el mismo criterio del servidor (validarCantidad). */
  decimales: number;
  /** M.2-A4 (D): una unidad que el producto usa pero se desactivó (la edición la incluye para no mostrarla como «sin unidad» ni borrarla al guardar). Se ve con «(inactiva)» y no se ofrece para presentaciones nuevas. */
  inactiva?: boolean;
}

/** El nombre de la unidad como se ve en el formulario: las inactivas llevan «(inactiva)». */
const etiquetaDeUnidad = (u: OpcionUnidad) => (u.inactiva ? `${u.nombre} (inactiva)` : u.nombre);

/**
 * Las unidades del producto. EDICIÓN (y alta con el interruptor apagado): «Unidad de stock», «Unidad de compra» (solo una MP) y «Factor de conversión», como siempre. ALTA como Pedernal (`soloUnidad`, decisión del
 * dueño, 2026-11-17): UNA sola «Unidad» (la de stock); la unidad de compra y el factor se completan después en la ficha y el alta manda factor 1 y sin unidad de compra. Movido de `producto-form.tsx` sin cambiar la
 * edición, con los mismos textos.
 */
export function CamposDeUnidad({
  tipo,
  unidades,
  unidadStockId,
  alElegirUnidadStock,
  unidadDeStockEditable,
  puedeEditarCamposSensibles,
  soloUnidad,
  unidadCompraId,
  factorConversion,
}: {
  tipo: TipoProducto;
  unidades: OpcionUnidad[];
  unidadStockId: string;
  alElegirUnidadStock: (id: string) => void;
  unidadDeStockEditable: boolean;
  puedeEditarCamposSensibles: boolean;
  soloUnidad: boolean;
  unidadCompraId: string | null | undefined;
  factorConversion: number | undefined;
}) {
  const nombreDeUnidad = (id: string | null | undefined) => {
    const u = unidades.find((x) => x.id === id);
    return u ? etiquetaDeUnidad(u) : undefined;
  };
  const opciones = unidades.map((u) => (
    <option key={u.id} value={u.id}>
      {etiquetaDeUnidad(u)}
    </option>
  ));
  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          {unidadDeStockEditable ? (
            <div className="flex-1">
              <Selector etiqueta={soloUnidad ? "Unidad" : "Unidad de stock"} etiquetaOculta={!soloUnidad} value={unidadStockId} onChange={(e) => alElegirUnidadStock(e.target.value)} required>
                <option value="">{soloUnidad ? "Sin elegir" : "Unidad de stock"}</option>
                {opciones}
              </Selector>
            </div>
          ) : (
            <ValorSoloLectura campo="unidadStockId" etiqueta="Unidad de stock">
              {nombreDeUnidad(unidadStockId) ?? "—"}
            </ValorSoloLectura>
          )}
          {tipo === "MP" &&
            !soloUnidad &&
            (puedeEditarCamposSensibles ? (
              <div className="flex-1">
                <Selector etiqueta="Unidad de compra" etiquetaOculta name="unidadCompraId" defaultValue={unidadCompraId ?? ""}>
                  <option value="">Unidad de compra (default)</option>
                  {opciones}
                </Selector>
              </div>
            ) : (
              <ValorSoloLectura campo="unidadCompraId" etiqueta="Unidad de compra">
                {nombreDeUnidad(unidadCompraId) ?? "Sin unidad de compra"}
              </ValorSoloLectura>
            ))}
        </div>
        {!soloUnidad && (
          <AyudaDeFicha>
            {tipo === "MP" && !soloUnidad
              ? "Stock: en qué unidad se mide el inventario (ej. kg). Compra: en qué unidad la facturás (ej. \"bolsa\") — el Factor de conversión de abajo pasa de una a la otra."
              : "En qué unidad se mide el inventario de este producto (ej. unidad, kg)."}
          </AyudaDeFicha>
        )}
      </div>

      {!soloUnidad && (
        <div className="flex flex-col gap-1">
          {puedeEditarCamposSensibles ? (
            <CampoNumero
              name="factorConversion"
              placeholder="Factor de conversión (unidades de stock por unidad de compra)"
              ariaLabel="Factor de conversión (unidades de stock por unidad de compra)"
              defaultValue={String(factorConversion ?? 1)}
              tipo="cantidad"
              etiqueta="El factor de conversión"
              decimales={unidades.find((u) => u.id === unidadStockId)?.decimales}
              required
            />
          ) : (
            <ValorSoloLectura campo="factorConversion" etiqueta="Factor de conversión (unidades de stock por unidad de compra)">
              {formatearCantidad(factorConversion ?? 1)}
            </ValorSoloLectura>
          )}
          <AyudaDeFicha>
            Cuántas unidades de stock entran en 1 unidad de compra — ej. 25 si comprás bolsas de 25kg y controlás el stock en kg. Si comprás y
            controlás en la misma unidad, dejalo en 1.
          </AyudaDeFicha>
        </div>
      )}
    </>
  );
}
