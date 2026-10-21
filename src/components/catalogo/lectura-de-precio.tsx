import { fraseDeLecturaDePrecio, type LecturaDePrecio as LecturaDelPrecio } from "@/core/opciones/public";
import { formatearMonto } from "@/core/pos/public";
import { LecturaEnVivo } from "@/ui/componentes/datos/lectura-en-vivo";

/**
 * La lectura del precio de UNA opción, debajo de su importe («Napolitana con Trucha = $ 25.000 + $ 3.000 = $ 28.000», «Este grupo no cambia el precio») (Fase 6, paso 6.10c). La arma el núcleo
 * (`leerPrecioDeOpcion`, `core/opciones/lectura-de-precio.ts`: el total sale del mismo compositor que cobra la venta); este componente solo la pone en una `LecturaEnVivo` con el formato de dinero de la
 * administración (`formatearMonto`, es-AR: el mismo de «Así se cobra»).
 *
 * El tono sale de la lectura: un importe que no se entendió es `error`, el que falta es una `advertencia` (hay que completarlo antes de guardar) y lo demás es una lectura. Sin estado y sin
 * JavaScript propio: sirve igual desde un componente de servidor o de cliente.
 */
export function LecturaDePrecio({ lectura }: { lectura: LecturaDelPrecio }) {
  const tono = lectura.tipo === "invalido" ? "error" : lectura.tipo === "falta" ? "advertencia" : "lectura";
  return <LecturaEnVivo tono={tono}>{fraseDeLecturaDePrecio(lectura, formatearMonto)}</LecturaEnVivo>;
}
