/**
 * ORÁCULO de la búsqueda de producto por texto (Compras etapa 1, paso 5): una tabla legible, escrita aparte del código, de «término → qué nombres se esperan». Lo recorre `oraculo-busqueda-de-producto-base.test.ts` contra la base real, por la lista de Productos y por `buscarProductosSelector`.
 * La búsqueda es por PALABRAS: cada una tiene que estar (en cualquier orden y posición), sin distinguir mayúsculas ni tildes (la ñ vale como n), con `%` y `_` como letras.
 */
export const CATALOGO_DEL_ORACULO = [
  "Tomate Perita Marca A",
  "Jamón cocido",
  "Jamon crudo",
  "Harina 000 x 25 kg",
  "Harina 000 x 1 kg",
  "Sal 50% fina",
  "Aceite_girasol",
  "Piña natural",
] as const;

const TODOS = [...CATALOGO_DEL_ORACULO];
const TOMATE = ["Tomate Perita Marca A"];
const HARINAS = ["Harina 000 x 25 kg", "Harina 000 x 1 kg"];

export const CASOS_DEL_ORACULO: { caso: string; termino: string; esperados: string[] }[] = [
  { caso: "mayúsculas", termino: "TOMATE", esperados: TOMATE },
  { caso: "palabra suelta en el medio", termino: "perita", esperados: TOMATE },
  { caso: "frase contigua", termino: "tomate perita", esperados: TOMATE },
  { caso: "palabras NO contiguas: alcanza con que estén todas", termino: "tomate marca", esperados: TOMATE },
  { caso: "orden invertido", termino: "perita tomate", esperados: TOMATE },
  { caso: "una palabra que no está anula el resto", termino: "tomate pera", esperados: [] },
  { caso: "palabras en nombres distintos no se mezclan entre productos", termino: "tomate jamon", esperados: [] },
  { caso: "cada palabra decide: «harina 25»", termino: "harina 25", esperados: ["Harina 000 x 25 kg"] },
  { caso: "«harina 000» las dos harinas", termino: "harina 000", esperados: HARINAS },
  { caso: "palabras repetidas", termino: "harina harina", esperados: HARINAS },
  { caso: "«%» es una letra: «50%» encuentra la sal", termino: "50%", esperados: ["Sal 50% fina"] },
  { caso: "«%» no es comodín: «5%» no encuentra «50%»", termino: "5%", esperados: [] },
  { caso: "«%» suelto solo encuentra lo que lo tiene", termino: "%", esperados: ["Sal 50% fina"] },
  { caso: "«_» es una letra: «aceite_g»", termino: "aceite_g", esperados: ["Aceite_girasol"] },
  { caso: "«_» no es comodín: «aceite-g» / «aceit_girasol» no matchean", termino: "aceit_girasol", esperados: [] },
  { caso: "«_» suelto solo encuentra lo que lo tiene", termino: "_", esperados: ["Aceite_girasol"] },
  { caso: "sin tilde encuentra con tilde (y sin ella)", termino: "jamon", esperados: ["Jamón cocido", "Jamon crudo"] },
  { caso: "con tilde encuentra con tilde y sin ella", termino: "jamón", esperados: ["Jamón cocido", "Jamon crudo"] },
  { caso: "mayúsculas con tilde", termino: "JAMÓN CRUDO", esperados: ["Jamon crudo"] },
  { caso: "la ñ vale como n", termino: "pina", esperados: ["Piña natural"] },
  { caso: "la ñ escrita encuentra la ñ", termino: "piña", esperados: ["Piña natural"] },
  { caso: "término vacío: sin filtro", termino: "", esperados: TODOS },
  { caso: "solo espacios: sin filtro", termino: "   ", esperados: TODOS },
];
