import { CLAVES_TEMA_SIMPLE, MENSAJE_FORMATO_DEL_COLOR, esMarcaHex, validarMarcaParaGuardar, validarValoresTema } from "@/core/carta/public";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoGuardarTemaCarta, ComandoGuardarTemaSimpleCarta } from "./tema.schema";

/**
 * Guard de la feature «tema de la carta» (convención «guard por feature», 2026-09-25; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Formato del comando,
 * ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermiso("carta_tema", …)`, así que el rechazo por permiso sigue llegando antes que el de
 * formato. Puro: sin Prisma ni permisos.
 *
 * Es EXACTAMENTE lo que antes era lo primero de cada acción, antes de leer nada y en el MISMO orden: `carta_tema` es de contexto sucursal, así que otra sucursal
 * responde igual que una inexistente («No se encontró la sucursal.»; `sucursalActivaId` es la del contexto de quien llama); y después los valores.
 */

const SUCURSAL_NO_ENCONTRADA = "No se encontró la sucursal.";

/** Guard del comando «guardar el tema de la sucursal activa»: primero que sea la activa, después `validarValoresTema` (hasta 5 errores juntos en un mensaje, sin escribir). */
export function guardComandoGuardarTemaCarta(entrada: { sucursalId: string; valores: Readonly<Record<string, unknown>>; sucursalActivaId: string }): ResultadoDato<ComandoGuardarTemaCarta> {
  if (entrada.sucursalId !== entrada.sucursalActivaId) return rechazar("formato", SUCURSAL_NO_ENCONTRADA);
  const validados = validarValoresTema(entrada.valores);
  if (!validados.ok) return rechazar("formato", validados.mensaje);
  // Modo marca (paso 9): con el marcador `marca_derivada = "si"` el color de marca tiene que cumplir M1, M2 y M3; si no, se rechaza SIN escribir y el mensaje dice qué hacer. Sin marcador, nada cambia.
  if (validados.valor.marca_derivada === "si") {
    const marca = validarMarcaParaGuardar(validados.valor.color_marca);
    if (!marca.ok) return rechazar("formato", `Color de marca: ${marca.mensaje}`);
  }
  return aceptar({ sucursalId: entrada.sucursalId, valores: validados.valor });
}

/** La versión que vio la pantalla: el `actualizadoEn` del tema en ISO (milisegundos, UTC) o `sin-tema`. Lista de permitidos: cualquier otra forma se rechaza antes de leer nada. */
const VERSION_ESPERADA = /^(?:sin-tema|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/;

/**
 * Guard del comando «guardar la pantalla simple del tema de la sucursal activa» (PASO A de «Apariencia y publicación»). Primero que sea la sucursal activa; después la versión; después SOLO las siete claves de la pantalla simple
 * (`CLAVES_TEMA_SIMPLE`: cualquier otra clave que llegue se ignora, no se valida ni se guarda) con los mismos validadores de siempre (`validarValoresTema`, hasta 5 errores juntos). El color de marca exige M1 (`#rrggbb`; las mayúsculas se
 * pasan a minúsculas) y NO exige contraste: un color que no se lee se guarda tal cual y se ajusta al mostrar (decisión del dueño, 2026-11-17: «2.- si como pedernal»; las reglas M2 y M3 siguen en el guardado de siempre).
 */
export function guardComandoGuardarTemaSimpleCarta(entrada: { sucursalId: string; valores: Readonly<Record<string, unknown>>; versionEsperada: unknown; sucursalActivaId: string }): ResultadoDato<ComandoGuardarTemaSimpleCarta> {
  if (entrada.sucursalId !== entrada.sucursalActivaId) return rechazar("formato", SUCURSAL_NO_ENCONTRADA);
  if (typeof entrada.versionEsperada !== "string" || !VERSION_ESPERADA.test(entrada.versionEsperada)) return rechazar("formato", "No se pudo saber qué versión del tema estabas viendo: recargá la pantalla.");
  const pedido: Record<string, unknown> = {};
  for (const clave of CLAVES_TEMA_SIMPLE) {
    if (!Object.hasOwn(entrada.valores, clave)) continue;
    const crudo = entrada.valores[clave];
    pedido[clave] = clave === "color_marca" && typeof crudo === "string" && /^#[0-9a-fA-F]{6}$/.test(crudo.trim()) ? crudo.trim().toLowerCase() : crudo;
  }
  const validados = validarValoresTema(pedido);
  if (!validados.ok) return rechazar("formato", validados.mensaje);
  if (validados.valor.color_marca !== undefined && !esMarcaHex(validados.valor.color_marca)) return rechazar("formato", `Color de marca: ${MENSAJE_FORMATO_DEL_COLOR} (seis dígitos hexadecimales).`);
  return aceptar({ sucursalId: entrada.sucursalId, valores: validados.valor, versionEsperada: entrada.versionEsperada });
}
