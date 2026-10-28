"use client";

import { CampoNumero } from "@/components/campo-numero";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { Casilla } from "@/ui/primitivas/casilla";
import { OpcionesExcluyentes } from "@/ui/primitivas/opciones-excluyentes";

/**
 * E3a (ADR-041): el bloque «Repartir entre sucursales» de la pantalla de Compra (la opción barata del diseño, §11.1: la misma pantalla, con un interruptor). Se marca qué sucursales llevan parte y cuánto
 * (importe que suma el total de la factura, o porcentaje que suma 100). La parte de esta sucursal entra al stock al confirmar; la de cada otra queda PROPUESTA y esa sucursal la acepta desde su Compra.
 * Acá solo se muestra cuánto falta o sobra: el reparto exacto renglón por renglón lo calcula el servidor (los importes tipeados son los pesos).
 */
export interface EstadoDeReparto {
  repartir: boolean;
  modo: "IMPORTE" | "PORCENTAJE";
  /** Sucursal → valor tecleado; una sucursal sin entrada no lleva parte. */
  valores: Record<string, string>;
  incluidas: string[];
}

export const REPARTO_APAGADO: EstadoDeReparto = { repartir: false, modo: "IMPORTE", valores: {}, incluidas: [] };

const plata = (n: number) => `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function BloqueDeReparto({
  estado,
  onCambio,
  sucursalActiva,
  otras,
  totalDeLaFactura,
}: {
  estado: EstadoDeReparto;
  onCambio: (e: EstadoDeReparto) => void;
  sucursalActiva: { id: string; nombre: string };
  otras: { id: string; nombre: string }[];
  /** Σ de los precios totales tecleados en los renglones. */
  totalDeLaFactura: number;
}) {
  const sucursales = [sucursalActiva, ...otras];
  const incluir = (id: string, si: boolean) => onCambio({ ...estado, incluidas: si ? [...estado.incluidas, id] : estado.incluidas.filter((x) => x !== id) });
  const suma = estado.incluidas.reduce((s, id) => s + (numeroDelCampo(estado.valores[id] ?? "") ?? 0), 0);
  const objetivo = estado.modo === "IMPORTE" ? totalDeLaFactura : 100;
  const diferencia = Math.round((objetivo - suma) * 100) / 100;
  const texto = estado.modo === "IMPORTE" ? plata(Math.abs(diferencia)) : `${Math.abs(diferencia).toLocaleString("es-AR")} %`;

  return (
    <fieldset className="flex flex-col gap-2 rounded border p-3" data-testid="bloque-reparto">
      <Casilla
        etiqueta="Repartir entre sucursales"
        checked={estado.repartir}
        onChange={(e) => onCambio(e.target.checked ? { ...estado, repartir: true, incluidas: estado.incluidas.length ? estado.incluidas : [sucursalActiva.id] } : { ...estado, repartir: false })}
      />
      {estado.repartir && (
        <>
          <p className="text-xs text-tinta-tenue">
            La parte de «{sucursalActiva.nombre}» entra al stock al confirmar. La de cada otra sucursal queda para que esa sucursal la acepte desde su Compra: hasta entonces no cuenta en su stock ni en su gasto. Hace falta el N° de factura.
          </p>
          <OpcionesExcluyentes
            leyenda="Cómo se reparte"
            nombre="modo-reparto"
            presentacion="fila"
            opciones={[
              { valor: "IMPORTE", etiqueta: "Por importe" },
              { valor: "PORCENTAJE", etiqueta: "Por porcentaje" },
            ]}
            valorInicial={estado.modo}
            alCambiar={(v) => onCambio({ ...estado, modo: v === "PORCENTAJE" ? "PORCENTAJE" : "IMPORTE" })}
          />
          {sucursales.map((s) => {
            const incluida = estado.incluidas.includes(s.id);
            return (
              <div key={s.id} className="flex flex-wrap items-end gap-2">
                <div className="min-w-44">
                  <Casilla
                    etiqueta={`${s.nombre}${s.id === sucursalActiva.id ? " (esta sucursal)" : ""}`}
                    aria-label={`Parte de ${s.nombre}`}
                    checked={incluida}
                    onChange={(e) => incluir(s.id, e.target.checked)}
                  />
                </div>
                {incluida && (
                  <label className="flex w-40 flex-col gap-1 text-sm">
                    <span className="sr-only">{estado.modo === "IMPORTE" ? `Importe de ${s.nombre}` : `Porcentaje de ${s.nombre}`}</span>
                    <CampoNumero
                      value={estado.valores[s.id] ?? ""}
                      onChange={(v) => onCambio({ ...estado, valores: { ...estado.valores, [s.id]: v } })}
                      prefijo={estado.modo === "IMPORTE" ? "$" : undefined}
                      tamano="compacto"
                      tipo={estado.modo === "IMPORTE" ? "importe" : "porcentaje"}
                      decimales={estado.modo === "IMPORTE" ? undefined : 2}
                      etiqueta={estado.modo === "IMPORTE" ? `El importe de ${s.nombre}` : `El porcentaje de ${s.nombre}`}
                    />
                  </label>
                )}
              </div>
            );
          })}
          <p className="text-sm" aria-live="polite">
            {estado.modo === "IMPORTE" ? `Total de la factura: ${plata(totalDeLaFactura)}. ` : ""}
            {diferencia === 0 ? "El reparto cierra." : diferencia > 0 ? `Falta repartir ${texto}.` : `Sobra ${texto}.`}
          </p>
        </>
      )}
    </fieldset>
  );
}
