"use client";

import { useId } from "react";
import { consumoDeLaBaseConFactor, type IngredienteDeBase } from "@/core/movimientos/public";
import { leerFactorDeEscala } from "@/core/opciones/public";
import { formatearCantidad } from "@/core/pos/public";

/**
 * La receta del producto de referencia (el primero que usa el grupo, el mismo del precio de referencia), tal cual la usa la venta en la sucursal activa. Solo llega si quien mira
 * tiene el «Ver» de las recetas y la empresa tiene el módulo Recetas (lo decide la página).
 */
export interface RecetaDeReferencia {
  productoNombre: string;
  sucursalNombre: string;
  /** Se produce por lote: al venderlo no descuenta su receta. */
  seProduce: boolean;
  sucursalId: string;
  /** Vacía si el producto no tiene receta vigente en la sucursal. */
  ingredientes: { insumoNombre: string; unidadNombre: string; base: IngredienteDeBase }[];
}

/**
 * OPCIONES-FACTOR: lo que significa el factor que se está tipeando, en vivo y debajo del campo «El factor» de un tamaño: «Factor 1,3 = lleva 30% más que el tamaño base» y, con la
 * receta de referencia, cuánto descuenta del stock cada ingrediente por unidad vendida en el tamaño base y con ese factor («0,25 kg → 0,325 kg»). Solo lectura: no cambia lo que se
 * guarda (el servidor vuelve a validar el factor). Las cantidades salen de la MISMA función que usa la venta (`consumoDeLaBaseConFactor` → `consumoDeLineaConfigurada`), no de una
 * cuenta propia. Filas apiladas (pensado para el celular) y la frase en una región `aria-live`.
 */
export function LecturaDelFactor({ valor, receta }: { valor: number | null; receta: RecetaDeReferencia | null }) {
  const id = useId();
  const lectura = leerFactorDeEscala(valor);
  const lineas = lectura.valido && receta && !receta.seProduce ? consumoDeLaBaseConFactor(receta.ingredientes.map((i) => i.base), lectura.factor, receta.sucursalId) : null;

  return (
    <div className="flex flex-col gap-2" data-lectura-del-factor="">
      <p aria-live="polite" data-frase-del-factor="" className={lectura.valido ? "text-sm font-medium text-neutral-900 dark:text-neutral-100" : "text-sm text-neutral-700 dark:text-neutral-300"}>
        {lectura.valido ? lectura.frase : lectura.mensaje}
      </p>
      {receta && lectura.valido && (
        <section aria-labelledby={`${id}-titulo`} data-receta-del-factor="" className="flex max-w-xl flex-col gap-2 border border-[#cdd5dd] bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
          <h3 id={`${id}-titulo`} className="text-sm font-medium [overflow-wrap:anywhere]">
            Cómo cambia la receta de «{receta.productoNombre}»
          </h3>
          {receta.seProduce ? (
            <p className="text-sm text-neutral-700 dark:text-neutral-300">Se produce por lote: al venderlo no descuenta su receta (la descontó al producirse), así que el factor no le cambia el consumo.</p>
          ) : lineas === null || lineas.length === 0 ? (
            <p className="text-sm text-neutral-700 dark:text-neutral-300">No tiene receta en «{receta.sucursalNombre}»: no hay consumo para mostrar.</p>
          ) : (
            <>
              <p className="text-xs text-neutral-700 dark:text-neutral-300">
                Lo que descuenta del stock cada unidad vendida en «{receta.sucursalNombre}» (con la merma de la receta, si tiene): tamaño base → con este factor.
              </p>
              <ul className="flex flex-col divide-y divide-[#cdd5dd] dark:divide-neutral-700">
                {lineas.map((l, i) => {
                  const ing = receta.ingredientes[i]!;
                  return (
                    <li key={`${l.insumoProductoId}-${i}`} data-ingrediente-del-factor={ing.insumoNombre} className="flex flex-col gap-0.5 py-1.5 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                      <span className="[overflow-wrap:anywhere]">{ing.insumoNombre}</span>
                      <span className="tabular-nums text-neutral-800 dark:text-neutral-200">
                        {formatearCantidad(l.antes)} {ing.unidadNombre}
                        <span className="sr-only"> pasa a </span>
                        <span aria-hidden="true"> → </span>
                        <strong className="font-semibold">
                          {formatearCantidad(l.despues)} {ing.unidadNombre}
                        </strong>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <p className="text-xs text-neutral-700 dark:text-neutral-300">
            Lo que esta opción suma o reemplaza («Qué consume», abajo) va aparte: se multiplica por el factor solo si marcás «Escala con el tamaño».
          </p>
        </section>
      )}
    </div>
  );
}
