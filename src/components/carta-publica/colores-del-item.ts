import { colorDeTextoLegible, type EstiloCarta } from "@/core/carta/public";

/**
 * El color de la marca cuando se usa como color de TEXTO: `--carta-primary-texto` (la marca acercada a la tinta si sola no llega a 4,5:1 contra el fondo, ver `resolverEstiloCarta`) y,
 * si esa variable no está definida (la marca ya se lee, o no hay tema), la marca de siempre. Los bordes, fondos y contornos siguen con `--carta-primary` sin tocar.
 */
export const MARCA_PARA_TEXTO = "var(--carta-primary-texto, var(--carta-primary))";

/**
 * Los colores del tema para un ítem (los de siempre; el especial, con los suyos). Todo color de TEXTO cargado en el tema pasa por `colorDeTextoLegible`: nunca queda por debajo de 4,5:1 contra el
 * fondo de la carta (lo cargado ya legible no cambia; lo que no se puede medir —nombres CSS, `var(...)`— se deja como está).
 */
export function coloresDelItem(especial: boolean, estilo: EstiloCarta) {
  const v = estilo.valores;
  const l = (color: string) => (color ? colorDeTextoLegible(color, v.color_fondo_dia, estilo.tintaBase) : color);
  return {
    nombre: especial ? l(v.color_especial_item_nombre) || MARCA_PARA_TEXTO : l(v.color_item_nombre) || undefined,
    precio: especial ? l(v.color_especial_item_precio) || MARCA_PARA_TEXTO : l(v.color_item_precio) || MARCA_PARA_TEXTO,
    descripcion: especial ? l(v.color_especial_item_descripcion) || undefined : l(v.color_item_descripcion) || undefined,
    tags: especial ? l(v.color_especial_item_tags) || MARCA_PARA_TEXTO : l(v.color_item_tags) || MARCA_PARA_TEXTO,
    estrella: l(v.color_especial_item_nombre) || MARCA_PARA_TEXTO,
  };
}
export type ColoresDelItem = ReturnType<typeof coloresDelItem>;
