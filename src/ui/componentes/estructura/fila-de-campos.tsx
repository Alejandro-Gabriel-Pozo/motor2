import type { ReactNode } from "react";

/**
 * Fila de campos cortos (Frente «Visual», V4; Pedernal `FilaDeCampos`): reparte DOS campos hermanos (cada hijo directo es un campo con su rótulo) en dos columnas iguales, alineados por
 * abajo (`items-end`: si un rótulo ocupa dos líneas, los controles siguen a la misma altura) y con 8 px entre ellos. Por debajo de 375 px (un celular angosto) pasa a UNA columna: dos
 * controles de 44 px no entran sin recortar el texto. `min-w-0` en los hijos: un campo con texto largo no ensancha su columna. Solo para campos cortos (una cantidad y su unidad, un
 * desde y un hasta); un campo largo o un grupo de opciones va solo, en su propia fila.
 */
export function FilaDeCampos({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 items-end gap-2 min-[375px]:grid-cols-2 [&>*]:min-w-0">{children}</div>;
}
