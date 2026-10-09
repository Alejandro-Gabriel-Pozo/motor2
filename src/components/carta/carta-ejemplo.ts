import type { CartaPublicaV1 } from "@/core/carta/public";

/**
 * Carta fija con la que se dibuja la vista previa del editor del tema (ADR-006, Fase 4): dos secciones, un ítem común, uno
 * especial con tag y una promo. Es fija a propósito — determinística para los e2e y siempre completa, aunque la sucursal
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
      ],
      promos: [],
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
