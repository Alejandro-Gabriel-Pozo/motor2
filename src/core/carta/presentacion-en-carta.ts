import type { EjesDeLaCarta, RolDelGrupoEnCarta, TipoDeGrupoDeOpciones } from "@/core/opciones/public";

/**
 * Fase 5 de la ola «precio y carta» («carta pareja»; ADR-035): cómo se LEE en la carta un producto con opciones. Lógica PURA, en el servidor: recibe la tabla de precios que ya calculó la regla de la
 * venta (`tablaDePreciosParaLaCarta` de `core/pos`, la misma cuenta que se cobra) y la traduce a la forma que dibuja la carta. No calcula ningún precio: la forma se declara acá, sin importar
 * `core/pos` (este último ya usa la carta para el descuento de producto: sería un ciclo), igual que `ResumenDePreciosParaCarta` en `opciones-en-carta.ts`.
 */

/** Lo que este módulo lee de la tabla de precios de un producto (estructural: `TablaDePreciosParaLaCarta` de `core/pos` cumple esta forma). */
export interface TablaDePreciosParaCarta {
  grupos: readonly {
    grupoId: string;
    nombre: string;
    tipo: TipoDeGrupoDeOpciones;
    cantidadMinima: number;
    cantidadMaxima: number;
    prefijoEnCarta: string | null;
    rol: RolDelGrupoEnCarta;
    opciones: readonly { opcionId: string; nombre: string; esNinguna: boolean; orden: number; precioFinal: number | null; diferencia: number }[];
  }[];
  ejes: EjesDeLaCarta;
  /** `celdas[fila][columna]`, con el descuento de producto; `null` = esa combinación no se compone. */
  celdas: readonly (readonly (number | null)[])[];
}
