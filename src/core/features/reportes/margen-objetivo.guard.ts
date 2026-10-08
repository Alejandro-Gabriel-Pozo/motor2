import { validarFoodCostObjetivo } from "@/core/datos/food-cost-objetivo";
import { esIdentificador } from "@/core/datos/identificador";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoGuardarMargenObjetivo } from "./margen-objetivo.schema";

/**
 * Guard del comando «fijar, cambiar o borrar el food cost objetivo» (convención «guard por feature», 2026-09-25; Hito 4, bloque C, paso H4C-16). EXACTAMENTE lo que
 * antes era lo primero de `guardarMargenObjetivo` (src/server/actions/reportes/margen-objetivo.ts), antes de leer la categoría, con los MISMOS textos y en el
 * MISMO orden: la categoría (`null` es «toda la empresa» a propósito; un `undefined`, un objeto o un texto vacío es un argumento roto, y con
 * `findFirst({ where: { categoriaId } })` tocaría cualquier fila → «Categoría inválida.») y después el porcentaje (`validarFoodCostObjetivo`: vacío → `null`,
 * 0 < % < 100, con sus decimales). Que la categoría exista lo resuelve el caso de uso. Lo llama la Server Action DENTRO de su `conPermisoDeEmpresa(…)`. Puro: sin
 * Prisma ni permisos.
 */
export function guardComandoGuardarMargenObjetivo(entrada: { categoriaId: unknown; porcentaje: unknown }): ResultadoDato<ComandoGuardarMargenObjetivo> {
  const { categoriaId } = entrada;
  if (categoriaId !== null && !esIdentificador(categoriaId)) return rechazar("formato", "Categoría inválida.");
  const validado = validarFoodCostObjetivo(entrada.porcentaje);
  if (!validado.ok) return rechazar(validado.codigo, validado.mensaje);
  return aceptar({ categoriaId, valor: validado.valor });
}
