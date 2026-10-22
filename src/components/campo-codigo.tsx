import type { ComponentProps } from "react";
import { Campo, type PropsDeCampo } from "@/ui/primitivas/campo";

/**
 * Un CÓDIGO de dígitos (el CUIT, el código de ingreso o de una invitación): se escribe con el teclado numérico pero NO es un número. No se opera, no se redondea y no se parsea: el texto llega al servidor tal cual,
 * con sus ceros a la izquierda («0012» sigue siendo «0012», cosa que un `CampoNumero` o un `Number()` perdería) y, en un CUIT, con sus guiones. Lo declara quien lo usa, sí o sí (lote 6.33, «tipos de dato declarados y
 * bloqueantes»): su `longitudMaxima` (cuántos caracteres admite, guiones incluidos), su `autoComplete` (`one-time-code` para un código que llega por mail o por una aplicación, `off` para un dato que se escribe a mano)
 * y, si lo hay, su `patron` (el atributo `pattern` del `<input>`, p. ej. `[0-9-]*`).
 *
 * Reusa `Campo` (aspecto, foco, 44 px en celular, etiqueta y error) y no hace nada más que fijar `type="text"` y `inputMode="numeric"`: es el único lugar fuera de `src/ui/` y de `CampoNumero` donde se pide el teclado
 * numérico (lo cuida el cerco `inputmode-numerico-a-mano`). Un número que se opera es `CampoNumero` con su tipo.
 */
type SinClave<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type PropsDeCampoCodigo = SinClave<PropsDeCampo, "type" | "inputMode" | "autoComplete" | "maxLength" | "pattern"> & {
  autoComplete: "off" | "one-time-code";
  longitudMaxima: number;
  patron?: string;
};

export function CampoCodigo({ autoComplete, longitudMaxima, patron, ...resto }: PropsDeCampoCodigo) {
  return <Campo {...(resto as ComponentProps<typeof Campo>)} type="text" inputMode="numeric" autoComplete={autoComplete} maxLength={longitudMaxima} pattern={patron} />;
}
