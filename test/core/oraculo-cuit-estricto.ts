/**
 * ORÁCULO del CUIT estricto (`src/core/fiscal/cuit-estricto.ts`), escrito aparte del código y a mano: cada CUIT es un literal con su dígito verificador
 * calculado fuera del código (módulo 11, pesos 5,4,3,2,7,6,5,4,3,2). Lo que Pedernal acepta y rechaza (`cuit.test.ts` de Pedernal) más los prefijos que ya
 * NO se filtran.
 *
 * DIMENSIONES: la FORMA (11 dígitos, con o sin los dos guiones exactos), el DÍGITO VERIFICADOR y el PREFIJO (no cambia nada). Lo exportado se declara acá;
 * `test/arquitectura/texto-de-catalogo-declarado.test.ts` falla si aparece una exportación sin declarar.
 */
export const EXPORTADOS_DE_CUIT_ESTRICTO = ["ErrorDeCuit", "LARGO_DE_CUIT", "cuitDesdeTexto", "digitoVerificadorDeCuit"] as const;
export const CODIGOS_DE_ERROR = ["CUIT_FORMATO_INVALIDO", "CUIT_DIGITO_VERIFICADOR_INVALIDO"] as const;

/** [entrada, los 11 dígitos que se guardan]. */
export const ACEPTADOS: ReadonlyArray<readonly [string, string]> = [
  ["20123456786", "20123456786"],
  ["20-12345678-6", "20123456786"],
  ["33693450239", "33693450239"],
  ["33-69345023-9", "33693450239"],
  ["27123456780", "27123456780"],
  ["30000000007", "30000000007"],
  // Prefijos fuera de la lista de ARCA que la regla vieja filtraba (20 23 24 27 30 33 34): estricta en la forma, permisiva en el prefijo.
  ["10123456780", "10123456780"],
  ["11123456787", "11123456787"],
  ["40123456787", "40123456787"],
  ["55123456784", "55123456784"],
  ["99123456781", "99123456781"],
  ["00123456785", "00123456785"],
  ["00-12345678-5", "00123456785"],
];

export const FORMATO_INVALIDO: readonly string[] = [
  "",
  " ",
  "2012345678",
  "201234567866",
  "2012345678a",
  "20 12345678 6",
  " 20123456786",
  "20123456786 ",
  "20123456786\n",
  "\n20123456786",
  "20.12345678.6",
  "20-12345678-66",
  "2012-345678-6",
  "20-1234567-86",
  "20-12345678-",
  "-20-12345678-6",
  "20-12345678-6-",
  "20--12345678-6",
  "2012345678-6",
  "20-123456786",
  "20_12345678_6",
  "20/12345678/6",
  "２０１２３４５６７８６",
  "٢٠١٢٣٤٥٦٧٨٦",
  "x20-12345678-6",
  "abc20-12345678-6",
  "20-12345678-6x",
  "CUIT 20-12345678-6",
  "20-12345678-6\u200b",
  "2012345678\u0000",
  "20,123456786",
  "0x123456789a",
  "1e10000000000",
];

/** Forma correcta, dígito verificador equivocado. */
export const VERIFICADOR_INVALIDO: readonly string[] = ["20123456787", "20-12345678-0", "33693450238", "10123456781", "00123456780", "99123456780"];

/** Las 10 posiciones iniciales cuyo dígito verificador NO existe (resto 10): ningún dígito final los vuelve válidos. */
export const BASES_SIN_DIGITO: readonly string[] = ["3069345023", "0000000006"];

/** Base de diez dígitos → su único dígito válido (calculado fuera del código). */
export const DIGITO_DE_LA_BASE: ReadonlyArray<readonly [string, number]> = [
  ["2012345678", 6],
  ["3369345023", 9],
  ["0000000000", 0],
  ["0000000005", 1],
  ["0000000001", 9],
];
