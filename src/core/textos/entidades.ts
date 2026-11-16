/**
 * Las cosas del negocio que un texto nombra con artículo («No se encontró {entidad}.» → «No se encontró la sucursal.»): una sola vez cada una, con su género. El oráculo
 * (`test/textos/oraculo-de-entidades.ts`) tiene que declarar la frase esperada de cada una; una entidad nueva sin su fila hace fallar la prueba (diseño `docs/diseno-textos-en-codigo-2026-11-16.md`, §6, eje c).
 */
export type Entidad = { readonly nombre: string; readonly genero: "m" | "f" };

export const ENTIDADES = {
  membresia: { nombre: "membresía", genero: "f" },
  sucursal: { nombre: "sucursal", genero: "f" },
  usuario: { nombre: "usuario", genero: "m" },
  invitacion_pendiente: { nombre: "invitación pendiente", genero: "f" },
  categoria: { nombre: "categoría", genero: "f" },
  cliente: { nombre: "cliente", genero: "m" },
  conteo: { nombre: "conteo", genero: "m" },
  deposito: { nombre: "depósito", genero: "m" },
  deposito_habitual: { nombre: "depósito habitual", genero: "m" },
  destino: { nombre: "destino", genero: "m" },
  fila_de_frecuencia_de_conteo: { nombre: "fila de Frecuencia de conteo", genero: "f" },
  fila_de_stock_minimo: { nombre: "fila de Stock Mínimo", genero: "f" },
  motivo: { nombre: "motivo", genero: "m" },
  producto: { nombre: "producto", genero: "m" },
  seccion: { nombre: "sección", genero: "f" },
  seccion_de_origen: { nombre: "sección de origen", genero: "f" },
  seccion_destino: { nombre: "sección destino", genero: "f" },
  traspaso: { nombre: "traspaso", genero: "m" },
} as const satisfies Readonly<Record<string, Entidad>>;
