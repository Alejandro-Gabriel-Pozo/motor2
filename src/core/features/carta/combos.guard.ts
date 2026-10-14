import { esIdentificador } from "@/core/datos/identificador";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { mascaraDeDias, TODOS_LOS_DIAS, validarVigenciaDePromo } from "@/core/carta/public";
import type { ComandoActivarEntradaDeCupo, ComandoAgregarEntradaDeCupo, ComandoGuardarVigenciaPromoCarta, OpcionDeConfiguracionFija } from "./combos.schema";

/**
 * Guard de la feature «combos y menú del día» (GO-3b, ADR-032). Formato del comando, ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermiso…(…)`, así el rechazo por permiso
 * sigue llegando antes que el de formato. Puro: sin Prisma ni permisos.
 */

const LARGO_MAXIMO_DE_ID = 64;
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

export function guardComandoAgregarEntradaDeCupo(entrada: { cupoId: unknown; productoId: unknown; opciones?: unknown }): ResultadoDato<ComandoAgregarEntradaDeCupo> {
  const cupoId = id(entrada.cupoId, "No se encontró ese lugar de la promo.");
  if (!cupoId.ok) return cupoId;
  const productoId = id(entrada.productoId, "Elegí un producto de venta.");
  if (!productoId.ok) return productoId;
  const opciones = configuracion(entrada.opciones);
  if (!opciones.ok) return opciones;
  return aceptar({ cupoId: cupoId.valor, productoId: productoId.valor, opciones: opciones.valor });
}

export function guardComandoActivarEntradaDeCupo(entrada: { entradaId: unknown; activa: unknown }): ResultadoDato<ComandoActivarEntradaDeCupo> {
  const entradaId = id(entrada.entradaId, "No se encontró esa opción del lugar.");
  if (!entradaId.ok) return entradaId;
  if (typeof entrada.activa !== "boolean") return rechazar("formato", "Elegí si la opción queda activa o no.");
  return aceptar({ entradaId: entradaId.valor, activa: entrada.activa });
}

/** Un día «AAAA-MM-DD», o vacío/`null` = sin límite por ese lado. */
function dia(valor: unknown, etiqueta: string): ResultadoDato<string | null> {
  if (valor === undefined || valor === null || valor === "") return aceptar(null);
  return typeof valor === "string" ? aceptar(valor) : rechazar("formato", `La fecha «${etiqueta}» de la promo no es válida.`);
}

/**
 * La vigencia: «desde» y «hasta» (días «AAAA-MM-DD» o vacío) y los días de la semana como lista de 0 (lunes) a 6 (domingo). Ningún día elegido se rechaza (una promo que no vale ningún día se
 * apaga, no se guarda así); los siete juntos se guardan como «todos los días» (`null`). La validez del calendario y el orden de las fechas los mira `validarVigenciaDePromo` (core/carta).
 */
export function guardComandoGuardarVigenciaPromoCarta(entrada: {
  promoCartaId: unknown;
  versionEsperada: unknown;
  vigenteDesde?: unknown;
  vigenteHasta?: unknown;
  diasDeSemana?: unknown;
}): ResultadoDato<ComandoGuardarVigenciaPromoCarta> {
  const promoCartaId = id(entrada.promoCartaId, "No se encontró la promo.");
  if (!promoCartaId.ok) return promoCartaId;
  const v = entrada.versionEsperada;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return rechazar("formato", "La versión de la promo que mostraba la pantalla no es válida: recargala.");
  const desde = dia(entrada.vigenteDesde, "desde");
  if (!desde.ok) return desde;
  const hasta = dia(entrada.vigenteHasta, "hasta");
  if (!hasta.ok) return hasta;
  let diasDeSemana: number | null = null;
  if (entrada.diasDeSemana !== undefined && entrada.diasDeSemana !== null) {
    const dias = entrada.diasDeSemana;
    if (!Array.isArray(dias) || dias.length > 7 || !dias.every((d) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6)) {
      return rechazar("formato", "Los días de la semana de la promo no son válidos.");
    }
    if (dias.length === 0) return rechazar("vacio", "Elegí al menos un día de la semana en que vale la promo.");
    const mascara = mascaraDeDias(dias as number[]);
    diasDeSemana = mascara === TODOS_LOS_DIAS ? null : mascara;
  }
  const vigencia = { vigenteDesde: desde.valor, vigenteHasta: hasta.valor, diasDeSemana };
  const valida = validarVigenciaDePromo(vigencia);
  if (!valida.ok) return rechazar("formato", valida.mensaje);
  return aceptar({ promoCartaId: promoCartaId.valor, versionEsperada: v, vigencia });
}
