import type { HTMLAttributes, Ref } from "react";

/**
 * Insignia: la etiqueta corta de un estado o una categoría («Activo», «Sin stock», «Nuevo») (capa `ui/primitivas`: sin negocio; ver test/arquitectura/ui-sin-negocio.test.ts).
 *
 * - Lleva SIEMPRE un texto: `children` es un `string` y, vacío o de solo espacios, es un error en ejecución (el tipo no alcanza: `""` es un string). Una insignia sin texto es un punto de color,
 *   y el color solo no se lee (daltonismo, lector de pantalla): el estado lo dice la palabra y el tono la refuerza.
 * - `tono` elige el color: `neutro` (por defecto), `ok`, `aviso`, `error` o `marca`. Cada par texto/fondo está medido en `test/arquitectura/tokens-del-sistema-visual.test.ts` (>= 4,5:1).
 *
 * Solo tokens del sistema visual (src/app/globals.css) y sin modo oscuro (DEC-04). Acepta `ref` (React 19: una prop más).
 */
export type TonoDeInsignia = "neutro" | "ok" | "aviso" | "error" | "marca";

export interface PropsDeInsignia extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  tono?: TonoDeInsignia;
  /** El texto de la insignia: obligatorio y con algo escrito (si está vacío o son solo espacios, tira un error). */
  children: string;
  /** React 19: `ref` es una prop más (sin `forwardRef`); llega al `<span>`. */
  ref?: Ref<HTMLSpanElement>;
}

const TONO_DE_LA_INSIGNIA: Record<TonoDeInsignia, string> = {
  neutro: "bg-superficie-suave text-tinta-suave",
  ok: "bg-ok-tinte text-ok-tinta",
  aviso: "bg-aviso-tinte text-aviso-tinta",
  error: "bg-error-tinte text-error",
  marca: "bg-marca-tinte text-marca",
};

// @contrato primitiva-insignia
export function Insignia({ tono = "neutro", className, children, ref, ...resto }: PropsDeInsignia) {
  if (typeof children !== "string" || children.trim() === "") {
    throw new Error("Insignia: el texto es obligatorio (children no puede estar vacío ni ser solo espacios); el color solo no dice el estado");
  }
  return (
    <span {...resto} ref={ref} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONO_DE_LA_INSIGNIA[tono]}${className ? ` ${className}` : ""}`}>
      {children}
    </span>
  );
}
