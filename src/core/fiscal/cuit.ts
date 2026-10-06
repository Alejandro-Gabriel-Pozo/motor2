import { texto } from "@/core/texto";
import { LARGO_MAXIMO_CUIT } from "@/core/datos/limites";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";

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

/** CUIT opcional: vacío → `null`; válido → los 11 dígitos (lo que se guarda). */
export function validarCuit(valor: unknown, etiqueta = "El CUIT"): ResultadoDato<string | null> {
  const v = texto(valor);
  if (!v) return aceptar(null);
  if (v.length > LARGO_MAXIMO_CUIT) return rechazar("largo", `${etiqueta} no puede superar los ${LARGO_MAXIMO_CUIT} caracteres.`);
  const digitos = normalizarCuit(v);
  if (!digitos || !PREFIJOS_VALIDOS.has(digitos.slice(0, 2))) return rechazar("formato", `${etiqueta} no tiene un formato válido: son 11 dígitos, por ejemplo 30-12345678-1.`);
  if (!esCuitValido(digitos)) return rechazar("verificador", `${etiqueta} no es válido: el dígito verificador no coincide.`);
  return aceptar(digitos);
}

/** `XX-XXXXXXXX-X` si son 11 dígitos; cualquier otra cosa se devuelve tal cual, para no esconder datos viejos. */
export function formatearCuit(valor: string | null | undefined): string {
  const v = valor ?? "";
  return /^\d{11}$/.test(v) ? `${v.slice(0, 2)}-${v.slice(2, 10)}-${v.slice(10)}` : v;
}
