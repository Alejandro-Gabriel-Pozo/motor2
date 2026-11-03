/**
 * ORÁCULO del nombre de la línea vendida con opciones (decisión del dueño 2026-10-29, `docs/diseno-nombre-de-linea-configurada-2026-10-29.md`, sección F): la tabla de lo que
 * DEBE salir, escrita a mano y aparte del código. Una fila por combinación válida de las dimensiones que cambian el texto: tipo del grupo, modo de venta del producto (DIRECTO o BASE),
 * prefijo del grupo («de» o ninguno), opción «ninguna» y cantidad. La opción de prueba se llama «Pollo» (o «Sin pollo» si es la «ninguna») y el producto, «Milanesa».
 *
 * Clave: `tipo|modo|prefijo|ninguna|cantidad`. `nombre` es lo que va en el renglón del producto; `detalle`, lo que va debajo (solo lo INCLUIDO). Un ADICIONAL no entra al nombre.
 * Un tipo y una combinación que no están acá no son válidos (la «ninguna» es de VARIANTE o INCLUIDA; el prefijo, de VARIANTE o MEDIDA; una MEDIDA siempre es de cantidad 1).
 */
export interface FilaDelOraculo {
  nombre: string;
  detalle?: string;
}

export const ORACULO_DE_UNA_OPCION: Readonly<Record<string, FilaDelOraculo>> = {
  // MEDIDA: en un producto DIRECTO es una parte más; en una BASE es el nombre del plato (tal cual, sin prefijo ni minúscula, y no se imprime el producto).
  "MEDIDA|DIRECTO|sin|no|1": { nombre: "Milanesa pollo" },
  "MEDIDA|DIRECTO|de|no|1": { nombre: "Milanesa de pollo" },
  "MEDIDA|BASE|sin|no|1": { nombre: "Pollo" },
  "MEDIDA|BASE|de|no|1": { nombre: "Pollo" },
  // VARIANTE: una parte más, con su prefijo; la «ninguna» tal cual y sin prefijo; la cantidad como «×N».
  "VARIANTE|DIRECTO|sin|no|1": { nombre: "Milanesa pollo" },
  "VARIANTE|DIRECTO|sin|no|3": { nombre: "Milanesa pollo ×3" },
  "VARIANTE|DIRECTO|de|no|1": { nombre: "Milanesa de pollo" },
  "VARIANTE|DIRECTO|de|no|3": { nombre: "Milanesa de pollo ×3" },
  "VARIANTE|DIRECTO|sin|si|1": { nombre: "Milanesa sin pollo" },
  "VARIANTE|DIRECTO|de|si|1": { nombre: "Milanesa sin pollo" },
  "VARIANTE|BASE|sin|no|1": { nombre: "Milanesa pollo" },
  "VARIANTE|BASE|sin|no|3": { nombre: "Milanesa pollo ×3" },
  "VARIANTE|BASE|de|no|1": { nombre: "Milanesa de pollo" },
  "VARIANTE|BASE|de|no|3": { nombre: "Milanesa de pollo ×3" },
  "VARIANTE|BASE|sin|si|1": { nombre: "Milanesa sin pollo" },
  "VARIANTE|BASE|de|si|1": { nombre: "Milanesa sin pollo" },
  // INCLUIDA: nunca en el nombre; va al renglón de detalle (sin prefijo: no lo admite).
  "INCLUIDA|DIRECTO|sin|no|1": { nombre: "Milanesa", detalle: "pollo" },
  "INCLUIDA|DIRECTO|sin|no|3": { nombre: "Milanesa", detalle: "pollo ×3" },
  "INCLUIDA|DIRECTO|sin|si|1": { nombre: "Milanesa", detalle: "sin pollo" },
  "INCLUIDA|BASE|sin|no|1": { nombre: "Milanesa", detalle: "pollo" },
  "INCLUIDA|BASE|sin|no|3": { nombre: "Milanesa", detalle: "pollo ×3" },
  "INCLUIDA|BASE|sin|si|1": { nombre: "Milanesa", detalle: "sin pollo" },
  // ADICIONAL: renglón propio con su precio; no aporta nada al nombre ni al detalle.
  "ADICIONAL|DIRECTO|sin|no|1": { nombre: "Milanesa" },
  "ADICIONAL|DIRECTO|sin|no|3": { nombre: "Milanesa" },
  "ADICIONAL|BASE|sin|no|1": { nombre: "Milanesa" },
  "ADICIONAL|BASE|sin|no|3": { nombre: "Milanesa" },
};

/**
 * Los casos de varios grupos, con el texto completo (producto, grupos en el orden de la foto) tal como lo imprimen el ticket y la comanda. Las opciones salen de las cartas del dueño.
 */
export interface CasoCompleto {
  caso: string;
  producto: string;
  base: boolean;
  /** [tipo, opción, prefijo del grupo, ¿«ninguna»?, cantidad], EN EL ORDEN de la foto. */
  fotos: [tipo: string, opcion: string, prefijo: string | null, ninguna: boolean, cantidad: number][];
  nombre: string;
  detalle?: string;
}

export const CASOS_COMPLETOS: readonly CasoCompleto[] = [
  { caso: "café directo: variante y tamaño", producto: "Café", base: false, fotos: [["VARIANTE", "Solo", null, false, 1], ["MEDIDA", "Chico", null, false, 1]], nombre: "Café solo chico" },
  { caso: "café directo: tamaño y variante (otro orden del producto)", producto: "Café", base: false, fotos: [["MEDIDA", "Chico", null, false, 1], ["VARIANTE", "Solo", null, false, 1]], nombre: "Café chico solo" },
  { caso: "milanesa base con proteína con prefijo", producto: "Milanesas", base: true, fotos: [["VARIANTE", "Pollo", "de", false, 1], ["MEDIDA", "Milanesa napolitana", null, false, 1]], nombre: "Milanesa napolitana de pollo" },
  { caso: "pizza base: solo el tamaño", producto: "Pizzas", base: true, fotos: [["MEDIDA", "Pizza muzzarella", null, false, 1]], nombre: "Pizza muzzarella" },
  { caso: "bife base con guarniciones en el detalle", producto: "Bife", base: true, fotos: [["MEDIDA", "Bife a la criolla", null, false, 1], ["INCLUIDA", "Nalga", null, false, 1], ["INCLUIDA", "Puré de papa", null, false, 1]], nombre: "Bife a la criolla", detalle: "nalga · puré de papa" },
  { caso: "directo con «ninguna» y papas por 2", producto: "Hamburguesa", base: false, fotos: [["VARIANTE", "Sin queso", "con", true, 1], ["INCLUIDA", "Papas fritas", null, false, 2]], nombre: "Hamburguesa sin queso", detalle: "papas fritas ×2" },
  { caso: "el adicional no entra", producto: "Café", base: false, fotos: [["MEDIDA", "Grande", null, false, 1], ["ADICIONAL", "Shot extra", null, false, 2]], nombre: "Café grande" },
];
