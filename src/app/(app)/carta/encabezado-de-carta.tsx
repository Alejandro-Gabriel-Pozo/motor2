import type { ReactNode } from "react";
import s from "./carta-mant.module.css";

/**
 * Arriba de las pantallas de la carta con la cara del prototipo CARTA-MANT: la barra azul noche con «<entrada> · <pestaña>» y la sucursal activa y, debajo, la fila de pestañas de la entrada (DEC-24,
 * `FilaDeCarta`, que llega como `children`). Antes había acá dos «puertas» (Mantenimiento / Parametrización); desde la Fase 7 las reemplazan las tres entradas del menú y sus pestañas. Sin estado.
 */
export function EncabezadoDeCarta({ entrada, pestana, sucursal, children }: { entrada: string; pestana: string; sucursal: string; children?: ReactNode }) {
  return (
    <>
      <div className={s.appbar}>
        <h1>{entrada}</h1>
        <span>{pestana}</span>
        <span className={s.suc}>{sucursal}</span>
      </div>
      {children && <div className={s.pestanas}>{children}</div>}
    </>
  );
}
