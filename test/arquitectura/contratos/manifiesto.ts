import { BORDE_PROPIO_DE_CARTA } from "./contratos/borde-propio-de-carta";
import { PRIMITIVA_AREA_DE_TEXTO } from "./contratos/primitiva-area-de-texto";
import { PRIMITIVA_BOTON } from "./contratos/primitiva-boton";
import { PRIMITIVA_CAMPO } from "./contratos/primitiva-campo";
import { PRIMITIVA_CASILLA } from "./contratos/primitiva-casilla";
import { PRIMITIVA_SELECTOR } from "./contratos/primitiva-selector";
import { SEPARADOR_DE_LISTA_DE_CARTA } from "./contratos/separador-de-lista-de-carta";
import { TOKENS_VISUALES } from "./contratos/tokens-visuales";
import type { Contrato } from "./tipos";

/**
 * El manifiesto de contratos compartidos declarados: el índice de todos los contratos del repo. Cada contrato es un objeto TS plano y completo (`Contrato` no tiene
 * campos opcionales) y vive en su propio archivo de `contratos/`. Se declara uno nuevo con la receta de `LEEME.md`.
 */
export const MANIFIESTO: readonly Contrato[] = [SEPARADOR_DE_LISTA_DE_CARTA, BORDE_PROPIO_DE_CARTA, TOKENS_VISUALES, PRIMITIVA_BOTON, PRIMITIVA_CAMPO, PRIMITIVA_SELECTOR, PRIMITIVA_AREA_DE_TEXTO, PRIMITIVA_CASILLA];
