import type { Contrato } from "./tipos";

/**
 * El manifiesto de contratos compartidos declarados: el índice de todos los contratos del repo. Cada contrato es un objeto TS plano y completo (`Contrato` no tiene
 * campos opcionales). Se declara uno nuevo con la receta de `LEEME.md`.
 *
 * Por ahora está VACÍO a propósito: el motor (paso M1) no trae contratos; los portan los pasos siguientes, cada uno en su commit.
 */
export const MANIFIESTO: readonly Contrato[] = [];
