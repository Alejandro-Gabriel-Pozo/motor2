/**
 * ORÁCULO ESCRITO A MANO, aparte del código (diseño `docs/diseno-producto-nuevo-como-pedernal-2026-11-17.md`, §5): las clases que se ofrecen hoy en el alta, con los nombres y las descripciones
 * LITERALES de Pedernal (`ZuluHub-docs` `10-ux-ui/prototipos-gastronomia/productos.html`, `CLASES`) y cómo se guarda cada una sin tocar el modelo. En el orden en que Pedernal las ofrece.
 * Reventa de Pedernal no está: el CHECK de la base no la admite hasta E4 (se compra y se vende: toca el uso de `tipo`). Insumo sí (E2, con la columna `claseDeUso` de E1).
 */
export interface ClaseDeAltaEsperada {
  clave: "MATERIA_PRIMA" | "INSUMO" | "ELABORADO" | "VENDIBLE";
  nombre: string;
  descripcion: string;
  tipo: "MP" | "PV";
  seProduce: boolean;
}

export const CLASES_DE_ALTA_ESPERADAS: readonly ClaseDeAltaEsperada[] = [
  { clave: "MATERIA_PRIMA", nombre: "Materia prima", descripcion: "Se compra y es componente de lo que se elabora y se vende.", tipo: "MP", seProduce: false },
  { clave: "INSUMO", nombre: "Insumo", descripcion: "Se compra y se consume para operar, sin ser parte del producto.", tipo: "MP", seProduce: false },
  { clave: "ELABORADO", nombre: "Elaborado", descripcion: "Se produce en el negocio y se usa como componente.", tipo: "MP", seProduce: true },
  { clave: "VENDIBLE", nombre: "Producto vendible", descripcion: "Se arma o se produce y se vende; tiene composición.", tipo: "PV", seProduce: false },
];
