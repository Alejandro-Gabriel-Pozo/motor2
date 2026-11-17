/**
 * Oráculo de las entidades del catálogo de textos (diseño `docs/diseno-textos-en-codigo-2026-11-16.md`, §6, eje c: género de la cosa), escrito aparte del código: para cada entidad de
 * `src/core/textos/entidades.ts`, la frase que tiene que salir. Una entidad nueva sin su fila hace fallar `entidades.test.ts`.
 */
export const ORACULO_DE_ENTIDADES: Readonly<Record<string, { genero: "m" | "f"; noSeEncontro: string; /** Solo las entidades que hoy se repiten por nombre. */ yaExiste?: string }>> = {
  membresia: { genero: "f", noSeEncontro: "No se encontró la membresía." },
  sucursal: { genero: "f", noSeEncontro: "No se encontró la sucursal." },
  usuario: { genero: "m", noSeEncontro: "No se encontró el usuario." },
  invitacion_pendiente: { genero: "f", noSeEncontro: "No se encontró la invitación pendiente." },
  categoria: { genero: "f", noSeEncontro: "No se encontró la categoría." },
  cliente: { genero: "m", noSeEncontro: "No se encontró el cliente.", yaExiste: "Ya existe un cliente llamado «Fulano». Elegí otro nombre." },
  conteo: { genero: "m", noSeEncontro: "No se encontró el conteo." },
  deposito: { genero: "m", noSeEncontro: "No se encontró el depósito." },
  deposito_habitual: { genero: "m", noSeEncontro: "No se encontró el depósito habitual." },
  destino: { genero: "m", noSeEncontro: "No se encontró el destino." },
  fila_de_frecuencia_de_conteo: { genero: "f", noSeEncontro: "No se encontró la fila de Frecuencia de conteo." },
  fila_de_stock_minimo: { genero: "f", noSeEncontro: "No se encontró la fila de Stock Mínimo." },
  motivo: { genero: "m", noSeEncontro: "No se encontró el motivo." },
  producto: { genero: "m", noSeEncontro: "No se encontró el producto." },
  seccion: { genero: "f", noSeEncontro: "No se encontró la sección." },
  seccion_de_origen: { genero: "f", noSeEncontro: "No se encontró la sección de origen." },
  seccion_destino: { genero: "f", noSeEncontro: "No se encontró la sección destino." },
  traspaso: { genero: "m", noSeEncontro: "No se encontró el traspaso." },
};
