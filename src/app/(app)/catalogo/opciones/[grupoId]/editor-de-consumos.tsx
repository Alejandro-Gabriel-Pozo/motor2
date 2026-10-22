"use client";

import { useId, useState } from "react";
import { CampoNumero } from "@/components/campo-numero";
import { leerNumeroCanonico } from "@/core/datos/numero-tecleado";
import type { TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import { Boton } from "@/ui/primitivas/boton";
import { Casilla } from "@/ui/primitivas/casilla";
import { Selector } from "@/ui/primitivas/selector";

/** Una materia prima de la empresa para elegir en un consumo, con su unidad de stock (el consumo va siempre en ella: se muestra, no se elige). */
export interface InsumoParaConsumo {
  id: string;
  nombre: string;
  unidadNombre: string;
  decimales: number;
}

/** Una línea de consumo tal cual la cargó la pantalla (los números como texto, para no perder lo que se está tipeando). */
export interface ConsumoEnEdicion {
  efecto: "SUMA" | "REEMPLAZA";
  insumoProductoId: string;
  reemplazaAProductoId: string;
  cantidad: string;
  mermaPorcentaje: string;
  escalaConLaMedida: boolean;
}

/**
 * Lo que consume una opción (GO-2d), con el módulo Recetas activo: cada línea SUMA un insumo a la receta del producto o REEMPLAZA uno de sus ingredientes por otro (un REEMPLAZA
 * pide cuál). La cantidad va en la unidad de stock del insumo, con sus decimales; la merma en porcentaje; «escala con el tamaño» (no en un adicional, que siempre suma lo mismo)
 * multiplica la cantidad por el factor del tamaño elegido. Las líneas viajan como JSON en el campo oculto `consumos`; el servidor las vuelve a validar (`validarConsumos`).
 */
export function EditorDeConsumos({ tipo, insumos, inicial }: { tipo: TipoDeGrupoDeOpciones; insumos: InsumoParaConsumo[]; inicial: ConsumoEnEdicion[] }) {
  const id = useId();
  const [lineas, setLineas] = useState<ConsumoEnEdicion[]>(inicial);
  const esAdicional = tipo === "ADICIONAL";
  const porId = new Map(insumos.map((i) => [i.id, i]));

  const cambiar = (i: number, parcial: Partial<ConsumoEnEdicion>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...parcial } : l)));
  const numero = (t: string) => {
    const r = leerNumeroCanonico(t);
    return r.ok ? r.valor : Number.NaN;
  };
  // Lo que viaja: los números ya interpretados (un texto mal escrito va como NaN y el servidor lo rechaza con su mensaje).
  const paraEnviar = lineas.map((l) => ({
    efecto: l.efecto,
    insumoProductoId: l.insumoProductoId,
    reemplazaAProductoId: l.efecto === "REEMPLAZA" ? l.reemplazaAProductoId || null : null,
    cantidad: numero(l.cantidad),
    mermaPorcentaje: l.mermaPorcentaje.trim() === "" ? 0 : numero(l.mermaPorcentaje),
    escalaConLaMedida: !esAdicional && l.escalaConLaMedida,
  }));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Qué consume (stock)</legend>
      <input type="hidden" name="consumos" value={JSON.stringify(paraEnviar)} />
      {lineas.length === 0 && <p className="text-xs text-tinta-suave">Sin consumos: la opción no cambia lo que descuenta la receta.</p>}
      <ol className="flex flex-col gap-3">
        {lineas.map((l, i) => {
          const insumo = porId.get(l.insumoProductoId);
          const base = `${id}-${i}`;
          return (
            <li key={i} className="flex flex-col gap-2 rounded border p-2" data-consumo={i + 1}>
              <div className="flex flex-wrap items-end gap-3">
                {!esAdicional && (
                  <Selector id={`${base}-efecto`} etiqueta={`Línea ${i + 1}`} tamano="compacto" value={l.efecto} onChange={(e) => cambiar(i, { efecto: e.target.value as ConsumoEnEdicion["efecto"] })}>
                    <option value="SUMA">Suma</option>
                    <option value="REEMPLAZA">Reemplaza</option>
                  </Selector>
                )}
                {l.efecto === "REEMPLAZA" && (
                  <Selector id={`${base}-reemplaza`} etiqueta="Ingrediente que reemplaza" tamano="compacto" value={l.reemplazaAProductoId} onChange={(e) => cambiar(i, { reemplazaAProductoId: e.target.value })} className="max-w-[14rem]">
                    <option value="">Elegí cuál</option>
                    {insumos.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nombre}
                      </option>
                    ))}
                  </Selector>
                )}
                <Selector id={`${base}-insumo`} etiqueta={l.efecto === "REEMPLAZA" ? "Por" : "Insumo"} tamano="compacto" value={l.insumoProductoId} onChange={(e) => cambiar(i, { insumoProductoId: e.target.value })} className="max-w-[14rem]">
                  <option value="">Elegí el insumo</option>
                  {insumos.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </Selector>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${base}-cantidad`} className="text-xs font-medium">
                    Cantidad{insumo ? ` (${insumo.unidadNombre})` : ""}
                  </label>
                  <CampoNumero id={`${base}-cantidad`} value={l.cantidad} onChange={(v) => cambiar(i, { cantidad: v })} tipo="cantidad" decimales={insumo?.decimales ?? 4} etiqueta="La cantidad" tamano="compacto" className="w-28" />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${base}-merma`} className="text-xs font-medium">
                    Merma %
                  </label>
                  <CampoNumero tipo="porcentaje" id={`${base}-merma`} value={l.mermaPorcentaje} onChange={(v) => cambiar(i, { mermaPorcentaje: v })} etiqueta="La merma" tamano="compacto" className="w-24" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                {!esAdicional && <Casilla etiqueta="Escala con el tamaño" checked={l.escalaConLaMedida} onChange={(e) => cambiar(i, { escalaConLaMedida: e.target.checked })} />}
                <Boton variante="enlace" tamano="tactil" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} aria-label={`Quitar la línea ${i + 1} del consumo`}>
                  Quitar
                </Boton>
              </div>
            </li>
          );
        })}
      </ol>
      <Boton
        variante="enlace"
        tamano="tactil"
        onClick={() => setLineas((ls) => [...ls, { efecto: "SUMA", insumoProductoId: "", reemplazaAProductoId: "", cantidad: "", mermaPorcentaje: "", escalaConLaMedida: false }])}
        className="self-start"
      >
        + Agregar línea de consumo
      </Boton>
    </fieldset>
  );
}
