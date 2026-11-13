import { esIdentificador } from "@/core/datos/identificador";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoActivarEntradaDeCupo, ComandoAgregarEntradaDeCupo, OpcionDeConfiguracionFija } from "./combos.schema";
import { LARGO_MAXIMO_DE_ID } from "@/core/datos/limites";

/**
 * Guard de la feature «combos y menú del día» (GO-3b, ADR-032). Formato del comando, ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermiso…(…)`, así el rechazo por permiso
 * sigue llegando antes que el de formato. Puro: sin Prisma ni permisos.
 */

/** Tope de opciones de una configuración fija (una por grupo admitido, de sobra). */
const MAXIMO_OPCIONES_DE_CONFIGURACION = 20;

function id(valor: unknown, mensaje: string): ResultadoDato<string> {
  return esIdentificador(valor) && valor.length <= LARGO_MAXIMO_DE_ID ? aceptar(valor) : rechazar("formato", mensaje);
}

/** La configuración fija: a lo sumo 20 opciones, cada una con su id y de 1 a 10 unidades. Ausente o `null` = sin configuración. Un repetido lo rechaza el caso de uso (`claveDeConfiguracion`). */
function configuracion(valor: unknown): ResultadoDato<OpcionDeConfiguracionFija[]> {
  if (valor === undefined || valor === null) return aceptar([]);
  if (!Array.isArray(valor) || valor.length > MAXIMO_OPCIONES_DE_CONFIGURACION) return rechazar("formato", "La configuración del producto no es válida.");
  const salida: OpcionDeConfiguracionFija[] = [];
  for (const o of valor as unknown[]) {
    const op = (typeof o === "object" && o !== null ? o : {}) as { opcionId?: unknown; cantidad?: unknown };
    const opcionId = id(op.opcionId, "Una opción de la configuración no es válida.");
    if (!opcionId.ok) return opcionId;
    const cantidad = op.cantidad === undefined ? 1 : op.cantidad;
    if (typeof cantidad !== "number" || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10) return rechazar("rango", "Cada opción de la configuración va de 1 a 10 unidades.");
    salida.push({ opcionId: opcionId.valor, cantidad });
  }
  return aceptar(salida);
}

export function guardComandoAgregarEntradaDeCupo(entrada: { cupoId: unknown; productoId: unknown; opciones?: unknown; modoDeOpciones?: unknown }): ResultadoDato<ComandoAgregarEntradaDeCupo> {
  const cupoId = id(entrada.cupoId, "No se encontró ese lugar de la promo.");
  if (!cupoId.ok) return cupoId;
  const productoId = id(entrada.productoId, "Elegí un producto de venta.");
  if (!productoId.ok) return productoId;
  const opciones = configuracion(entrada.opciones);
  if (!opciones.ok) return opciones;
  // Ausente = `FIJAS` (lo de siempre); cualquier otro valor se rechaza.
  const modo = entrada.modoDeOpciones === undefined || entrada.modoDeOpciones === null ? "FIJAS" : entrada.modoDeOpciones;
  if (modo !== "FIJAS" && modo !== "A_ELEGIR") return rechazar("formato", "Elegí si las opciones de ese producto son fijas o las elige el mozo.");
  return aceptar({ cupoId: cupoId.valor, productoId: productoId.valor, modoDeOpciones: modo, opciones: opciones.valor });
}

export function guardComandoActivarEntradaDeCupo(entrada: { entradaId: unknown; activa: unknown }): ResultadoDato<ComandoActivarEntradaDeCupo> {
  const entradaId = id(entrada.entradaId, "No se encontró esa opción del lugar.");
  if (!entradaId.ok) return entradaId;
  if (typeof entrada.activa !== "boolean") return rechazar("formato", "Elegí si la opción queda activa o no.");
  return aceptar({ entradaId: entradaId.valor, activa: entrada.activa });
}

