import type { HTMLAttributes, ReactNode } from "react";

/**
 * Lectura en vivo: la línea que le dice a quien teclea cómo entendió el sistema lo que escribió («= 300 g», «Napolitana = $ 25.000», «Revisá el importe») (capa `ui/componentes`: sin negocio; ver
 * test/arquitectura/ui-sin-negocio.test.ts).
 *
 * - Es una región `aria-live="polite"`: el lector de pantalla anuncia el cambio sin interrumpir lo que está leyendo. La región SIEMPRE está en el árbol, aunque no tenga nada que decir (una región
 *   que aparece junto con su contenido no se anuncia en todos los lectores).
 * - `tono` dice qué clase de lectura es: `lectura` (por defecto: el texto suave de lo que se entendió), `advertencia` (recuadro ámbar con «⚠», algo para mirar antes de guardar) o `error` (lo tecleado no
 *   sirve). El tono NO es lo único que lo dice: el texto lo escribe quien la usa y la advertencia lleva su «⚠». El error NO es `role="alert"`: se lee mientras se teclea y no puede interrumpir a cada letra.
 * - No pone clases por afuera: el aspecto sale del tono. Acepta atributos de un `<div>` (un `id`, un `data-…`) salvo `className`, `role` y `aria-live`.
 *
 * Solo tokens del sistema visual (src/app/globals.css) y sin modo oscuro (DEC-04).
 */
export type TonoDeLectura = "lectura" | "advertencia" | "error";

export interface PropsDeLecturaEnVivo extends Omit<HTMLAttributes<HTMLDivElement>, "className" | "role" | "aria-live" | "children"> {
  tono?: TonoDeLectura;
  children?: ReactNode;
}

const TONO_DE_LA_LECTURA: Record<TonoDeLectura, string> = {
  lectura: "text-tinta-suave",
  advertencia: "rounded border border-aviso bg-aviso-tinte px-2 py-1 text-aviso-tinta",
  error: "text-error",
};

export function LecturaEnVivo({ tono = "lectura", children, ...resto }: PropsDeLecturaEnVivo) {
  return (
    <div {...resto} aria-live="polite" data-tono={tono} className={`w-full text-sm ${TONO_DE_LA_LECTURA[tono]}`}>
      {tono === "advertencia" ? (
        <div className="flex items-start gap-1">
          <span aria-hidden="true">⚠</span>
          <span>{children}</span>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
