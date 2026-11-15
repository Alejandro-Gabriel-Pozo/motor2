import { texto } from "@/core/texto";
import { LARGO_MAXIMO_CUIT } from "@/core/datos/limites";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { cuitDesdeTexto } from "./cuit-estricto";

/** Prefijos que ARCA asigna: personas (20/23/24/27) y empresas (30/33/34). */
const PREFIJOS_VALIDOS = new Set(["20", "23", "24", "27", "30", "33", "34"]);
const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Saca espacios, puntos y guiones. Devuelve los 11 dígitos, o `null` si lo que queda no son exactamente 11 dígitos (no borra letras en silencio). */
export function normalizarCuit(valor: unknown): string | null {
  const limpio = String(valor ?? "").replace(/[\s.-]/g, "");
  return /^\d{11}$/.test(limpio) ? limpio : null;
}

/** `digitos` son 11 dígitos ya normalizados: prefijo de ARCA y dígito verificador por módulo 11. */
export function esCuitValido(digitos: string): boolean {
  if (!/^\d{11}$/.test(digitos) || !PREFIJOS_VALIDOS.has(digitos.slice(0, 2))) return false;
  const suma = PESOS.reduce((acc, peso, i) => acc + peso * Number(digitos[i]), 0);
  const resto = suma % 11;
  // Resto 1 da un esperado de 10, que ningún dígito iguala: ARCA nunca lo emite (reasigna el prefijo a 23/33), así que queda inválido solo.
  const esperado = resto === 0 ? 0 : 11 - resto;
  return esperado === Number(digitos[10]);
}

/**
 * CUIT opcional: vacío → `null`; válido → los 11 dígitos (lo que se guarda). Desde la etapa E1 (paridad con Pedernal, 2026-11-15) la regla es la ESTRICTA de Pedernal (`cuit-estricto.ts`):
 * 11 dígitos, o `XX-XXXXXXXX-X` con los guiones exactos, y el dígito verificador; SIN lista de prefijos y SIN limpiar espacios, puntos ni guiones sueltos de adentro (solo se recortan los
 * extremos, como todo texto de un formulario). Los mensajes siguen siendo los de Motor2 de siempre (siguen siendo verdad con la regla estricta); los de Pedernal (`apps/plataforma/logica/errores-de-plataforma.ts`: «no tiene un
 * formato válido. Escribilo con 11 números.» y «no es válido. Revisá los números.») están en la tabla del PR para que el dueño decida si se cambian. `normalizarCuit` y `esCuitValido` siguen siendo del diagnóstico de la consola de plataforma, que lee datos viejos con separadores.
 */
export function validarCuit(valor: unknown, etiqueta = "El CUIT"): ResultadoDato<string | null> {
  const v = texto(valor);
  if (!v) return aceptar(null);
  if (v.length > LARGO_MAXIMO_CUIT) return rechazar("largo", `${etiqueta} no puede superar los ${LARGO_MAXIMO_CUIT} caracteres.`);
  const r = cuitDesdeTexto(v);
  if (r.ok) return aceptar(r.valor);
  if (r.error === "CUIT_DIGITO_VERIFICADOR_INVALIDO") return rechazar("verificador", `${etiqueta} no es válido: el dígito verificador no coincide.`);
  return rechazar("formato", `${etiqueta} no tiene un formato válido: son 11 dígitos, por ejemplo 30-12345678-1.`);
}

/** `XX-XXXXXXXX-X` si son 11 dígitos; cualquier otra cosa se devuelve tal cual, para no esconder datos viejos. */
export function formatearCuit(valor: string | null | undefined): string {
  const v = valor ?? "";
  return /^\d{11}$/.test(v) ? `${v.slice(0, 2)}-${v.slice(2, 10)}-${v.slice(10)}` : v;
}
