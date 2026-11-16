import type { Exito, Fracaso, ResultadoCaso } from "@/core/resultado-caso";
import type { DatosDeParte, EntradaDeParte } from "@/core/datos/datos-de-parte";

/**
 * Tipos de la feature «partes» (ficha única de personas y empresas; docs/diseno-parte-ficha-unica-2026-11-15.md, etapa P1 (b)): los comandos y resultados de los casos de uso de `src/server/actions/partes/casos-de-uso/`.
 * Todo error es un CÓDIGO estable (la pantalla lo traduce a texto en la etapa (c)), igual que Pedernal (`ErrorDeClientes`).
 */

/** Alta: la clave de reintento (UUID que la pantalla genera al abrir el formulario y repite en cada reintento) y los datos ya validados. */
export interface ComandoAltaDeParte {
  claveIdempotencia: string;
  datos: DatosDeParte;
}

/** Edición: la ficha, la versión que se leyó (control optimista) y los datos COMPLETOS ya validados. */
export interface ComandoEditarParte {
  parteId: string;
  versionEsperada: number;
  datos: DatosDeParte;
}

/** Desactivar (`activa: false`) o reactivar (`activa: true`). */
export interface ComandoCambiarEstadoDeParte {
  parteId: string;
  activa: boolean;
}

/** La entrada sin validar de un alta o una edición (lo que llega del formulario). */
export type EntradaDeAltaDeParte = Readonly<{ claveIdempotencia: unknown; datos: EntradaDeParte }>;
export type EntradaDeEdicionDeParte = Readonly<{ parteId: unknown; versionEsperada: unknown; datos: EntradaDeParte }>;

/** Lo que devuelve un alta: la ficha (nueva o ya existente por la misma clave) y las fichas que podrían ser la misma persona (por nombre, correo o teléfono: aviso, no bloqueo). */
export interface DatosDeAltaDeParte {
  parteId: string;
  yaExistia: boolean;
  posiblesDuplicados: readonly string[];
}

/**
 *  - `CLAVE_REUTILIZADA`: la misma clave de alta con otros datos;
 *  - `DOCUMENTO_YA_REGISTRADO`: el documento es de otra ficha activa (`parteId` es la ganadora: la pantalla usa esa);
 *  - `PARTE_INACTIVA_CON_ESE_DOCUMENTO`: el documento es de una ficha desactivada (se reactiva, no se duplica; `parteId` es esa);
 *  - `DATOS_INVALIDOS`: un código por campo (`erroresPorCampo`).
 */
export type CodigoDeFalloDeAltaDeParte = "CLAVE_REUTILIZADA" | "DOCUMENTO_YA_REGISTRADO" | "PARTE_INACTIVA_CON_ESE_DOCUMENTO" | "DATOS_INVALIDOS";
/** Un fallo que puede llevar el id de la ficha con la que choca (`DOCUMENTO_YA_REGISTRADO`, `PARTE_INACTIVA_CON_ESE_DOCUMENTO`): la pantalla usa esa ficha. */
export type FalloDeParte<C extends string> = Fracaso<C> & { parteId?: string };
export type ResultadoAltaDeParte = Exito<DatosDeAltaDeParte> | FalloDeParte<CodigoDeFalloDeAltaDeParte>;

export type CodigoDeFalloDeEdicionDeParte = "PARTE_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA" | "DOCUMENTO_YA_REGISTRADO" | "DATOS_INVALIDOS";
export interface DatosDeEdicionDeParte {
  parteId: string;
  /** `false` si los datos eran los mismos que los guardados: no se escribió ni se auditó nada. */
  cambio: boolean;
  version: number;
}
export type ResultadoEdicionDeParte = Exito<DatosDeEdicionDeParte> | FalloDeParte<CodigoDeFalloDeEdicionDeParte>;

export type CodigoDeFalloDeEstadoDeParte = "PARTE_NO_ENCONTRADA";
export interface DatosDeEstadoDeParte {
  parteId: string;
  activa: boolean;
  /** `true` si ya estaba en ese estado: no se escribió ni se auditó nada. */
  yaEstaba: boolean;
}
export type ResultadoEstadoDeParte = ResultadoCaso<DatosDeEstadoDeParte, CodigoDeFalloDeEstadoDeParte>;

