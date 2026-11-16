import { nombreDeFicha } from "@/core/datos/nombre-de-ficha";
import type { ResultadoDato } from "@/core/datos/resultado";

/**
 * El nombre de un dato del catálogo que no es un producto, un insumo, una categoría ni un proveedor (unidad, grupo de insumos, sección de depósito, motivo de merma o de destino de consumo):
 * desde el 2026-11-16 (E-1c; dueño, «Sí, así (Recomendada)» y la regla de paridad del 2026-11-13) lo valida la ficha ELECCION de Pedernal (`core/datos/fichas-de-texto.ts`: lista de permitidos con
 * `¿ ¡ ? ! % $`, hasta 80, sin exigir letra) en vez de la regla vieja de Motor2 (cualquier alfabeto, guion bajo). Vacío → `mensajeVacio`; todo rechazo usa el mensaje genérico de las fichas
 * («Esta acción no está permitida», decisión del dueño 2026-11-15). Devuelve el nombre canónico (recortado, NFC, espacios juntos): es el que se guarda. Es la regla ESTRICTA de un alta o de un cambio de
 * nombre; lo ya guardado no se toca. Puro: lo comparten los guards de `core/features/` (no es un guard por sí mismo).
 */
export function nombreDeCatalogo(nombre: unknown, mensajeVacio: string): ResultadoDato<string> {
  return nombreDeFicha(nombre, "ELECCION", mensajeVacio);
}
