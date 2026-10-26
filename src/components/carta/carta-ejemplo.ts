import type { CartaPublicaV1 } from "@/core/carta/public";

/**
 * Carta fija con la que se dibuja la vista previa del editor del tema (ADR-006, Fase 4): dos secciones, un ítem común, uno
 * especial con tag y una promo. Fase 5 («carta pareja», ADR-035): «Entradas» trae además las cuatro FORMAS con que la carta lee un producto con opciones
 * (simple con lo que se lee debajo, la base oculta, la tabla de dos ejes y una tanda de columnas compartidas), para ver el tema sobre todas. Es fija a propósito — determinística para los e2e y siempre completa, aunque la sucursal
 * todavía no tenga nada cargado. Se pasa por `CartaVista`, el MISMO componente de la carta pública: lo que se ve acá es lo que
 * se ve en vivo. Es una `CartaPublicaV1` (S-25): sin ids, como la que recibe un anónimo.
 */
export const CARTA_EJEMPLO: CartaPublicaV1 = {
  version: 1,
  generadoEn: "2026-01-01T00:00:00.000Z",
  sucursal: { nombre: "Nombre del restaurante" },
  secciones: [
    {
      nombre: "Entradas",
      titulo: null,
      descripcion: "Para empezar",
      imagenUrl: null,
      orden: 1,
      items: [
        { nombre: "Provoleta", categoria: "Entradas", descripcion: "Con orégano y tomate", precio: 6800, tags: [], especial: false, imagenUrl: null },
        {
          nombre: "Papas fritas",
          categoria: "Entradas",
          descripcion: null,
          precio: 5200,
          tags: [],
          especial: false,
          imagenUrl: null,
          presentacion: {
            forma: "simple",
            aclaraciones: [
              { tipo: "eleccion", rotulo: "Salsa", opciones: ["ketchup", "mayonesa", "alioli"] },
              { tipo: "extras", rotulo: "Extras", opciones: [{ nombre: "cheddar", recargo: 1200 }] },
            ],
          },
        },
        {
          nombre: "Empanadas",
          categoria: "Entradas",
          descripcion: null,
          precio: 2500,
          tags: [],
          especial: false,
          imagenUrl: null,
          presentacion: {
            forma: "lista",
            encabezado: false,
            filas: [
              { rotulo: "Empanada de carne", precio: 2500 },
              { rotulo: "Empanada de jamón y queso", precio: 2500 },
            ],
            aclaraciones: [],
          },
        },
        {
          nombre: "Milanesas",
          categoria: "Entradas",
          descripcion: null,
          precio: 20000,
          tags: [],
          especial: false,
          imagenUrl: null,
          presentacion: {
            forma: "tabla",
            columnas: ["Simple", "Napolitana"],
            filas: [
              { rotulo: "De carne", celdas: [20000, 25000] },
              { rotulo: "De pollo", celdas: [20000, 25000] },
            ],
            aclaraciones: [],
          },
        },
        { nombre: "Tabla de fiambres", categoria: "Entradas", descripcion: null, precio: 14000, tags: [], especial: false, imagenUrl: null, presentacion: { forma: "columnas", celdas: [14000, 26000], aclaraciones: [] } },
        { nombre: "Tabla de quesos", categoria: "Entradas", descripcion: null, precio: 13000, tags: [], especial: false, imagenUrl: null, presentacion: { forma: "columnas", celdas: [13000, null], aclaraciones: [] } },
      ],
      promos: [],
      tandas: [{ primero: 4, ultimo: 5, rotulos: ["Para 2", "Para 4"] }],
    },
    {
      nombre: "Platos principales",
      titulo: "Del fuego",
      descripcion: null,
      imagenUrl: null,
      orden: 2,
      items: [
        { nombre: "Bife de chorizo", categoria: "Platos principales", descripcion: "Con papas rústicas", precio: 12500, tags: ["Sin TACC"], especial: false, imagenUrl: null },
        { nombre: "Cordero patagónico", categoria: "Platos principales", descripcion: "Cocción lenta, con verduras asadas", precio: 38900.5, tags: ["Regional"], especial: true, imagenUrl: null },
      ],
      promos: [{ titulo: "Promo de la casa", descripcion: "Plato principal + bebida", precio: 15900, orden: 1 }],
    },
  ],
};
