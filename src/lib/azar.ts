import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { FuenteDeAzar } from "@/core/seguridad/azar";

/**
 * La fuente de azar REAL del proceso (Pureza 1.5): el generador criptográfico de Node. Es el único lugar de `src/` que llama a `randomBytes`, `randomInt` o
 * `randomUUID` para el dominio (lo vigila `test/arquitectura/pureza-del-nucleo.test.ts`: el núcleo no puede tocar el azar). Quien necesite azar para el dominio
 * importa `azarDelProceso` y se lo pasa a la función; un test le pasa una fuente fija.
 */
export const azarDelProceso: FuenteDeAzar = {
  bytes: (cantidad) => new Uint8Array(randomBytes(cantidad)),
  entero: (minimo, maximoExclusivo) => randomInt(minimo, maximoExclusivo),
  uuid: () => randomUUID(),
};
