/**
 * Tipos del motor de «contratos compartidos declarados» (ver `LEEME.md`).
 *
 * Un contrato es una regla transversal con UNA fuente (un símbolo o una regla de CSS que dice cómo se hace algo) y muchos consumidores. El motor exige que cada
 * consumidor lo DECLARE de una forma que una máquina puede verificar dentro del propio archivo (importar el ancla, llevar la clase compañera, usar un nombre que la
 * fuente define). Lo que se usa sin declarar falla: no alcanza con que nadie se haya quejado.
 *
 * `Contrato` NO tiene campos opcionales: `tsc` rechaza un contrato al que le falte algo. «Nada» se escribe a propósito (`[]`, `"descubiertos"`).
 */

/**
 * Los únicos hallazgos que el motor sabe dar. Cerrado: agregar uno obliga a tocar el motor, su reporte y sus pruebas, y el meta-test del arnés de mutaciones
 * (`mutaciones-de-contratos.test.ts`) exige que algún invariante de la matriz lo produzca o que un test de `motor.test.ts` lo cubra. La lista es la fuente del tipo.
 */
export const TIPOS_DE_HALLAZGO = [
  "uso-sin-declarar",
  "definicion-duplicada",
  "consumidor-fantasma",
  "declaracion-sin-uso",
  "fuente-ausente",
  "marca-desconocida",
  "marca-duplicada",
  "excepcion-sobrante",
  "excepcion-sin-motivo",
  "deuda-sobrante",
  "deuda-sin-motivo",
  "caso-legitimo-sobrante",
  "caso-legitimo-sin-motivo",
  "excepcion-vencida",
  "deuda-vencida",
  "excepcion-sin-responsable",
  "excepcion-sin-aprobacion",
  "horizonte-excedido",
  "alcance-vacio",
] as const;

export type TipoDeHallazgo = (typeof TIPOS_DE_HALLAZGO)[number];

/**
 * Qué busca un detector. Todo es texto y AST: no se lee ninguna configuración de Tailwind, de Next ni de PostCSS.
 *  - `clases`: un token de una cadena de clases (un literal de texto de un `.ts`/`.tsx`: `className`, constantes, plantillas), SIN las variantes (`sm:`, `hover:`,
 *    `[&>li]:`, `!`). Una cadena es la unidad: se informa una vez por cadena y detector.
 *  - `ts / codigo`: una expresión regular sobre el CÓDIGO del archivo: sin comentarios y sin el interior de los strings, las plantillas ni los regex literales.
 *    Una mención en un comentario o en un texto no cuenta. La expresión lleva la bandera `g`.
 *  - `ts / propiedad`: una propiedad de un objeto literal (`{ nombre: valor }`) cuyo nombre y cuyo texto de valor coinciden.
 *  - `ts / declara`: una declaración (función, variable, clase, interfaz, tipo, enum) cuyo nombre coincide.
 *  - `css / declaracion`: una declaración `propiedad: valor` dentro de una regla.
 *  - `css / variable`: un `var(--nombre)` (el nombre es lo que se compara con la fuente cuando la declaración es `nombre-definido-en-la-fuente`).
 *  - `css / define-variable`: una propiedad personalizada `--nombre: …` (también dentro de `@theme`).
 * `que` es la frase del reporte («usa `border-t`», «redondea con Math.round»…).
 */
export type Detector =
  | { adaptador: "clases"; token: RegExp; que: string }
  | { adaptador: "ts"; tipo: "codigo"; patron: RegExp; que: string }
  | { adaptador: "ts"; tipo: "propiedad"; nombre: RegExp; valor: RegExp; que: string }
  | { adaptador: "ts"; tipo: "declara"; nombre: RegExp; que: string }
  | { adaptador: "css"; tipo: "declaracion"; propiedad: RegExp; valor: RegExp; que: string }
  | { adaptador: "css"; tipo: "variable"; nombre: RegExp; que: string }
  | { adaptador: "css"; tipo: "define-variable"; nombre: RegExp; que: string };

/**
 * Cómo dice un consumidor, dentro de su propio archivo, que depende del contrato:
 *  - `importar-ancla`: (TS) importa el ancla de la fuente (con o sin alias, o por `import * as`). Va con señales `ts`.
 *  - `clase-companera`: (clases y CSS) la misma cadena de clases lleva `clase` (o una de las `equivalentes`, clases que traen lo mismo por su cuenta); en CSS, el
 *    selector de la regla la nombra. Va con señales `clases` o `css`.
 *  - `nombre-definido-en-la-fuente`: el nombre que se usa (`var(--x)`) tiene que estar definido en la fuente; y un nombre definido que nadie usa también falla.
 */
export type Declaracion =
  | { tipo: "importar-ancla" }
  | { tipo: "clase-companera"; clase: string; equivalentes: readonly string[] }
  | { tipo: "nombre-definido-en-la-fuente" };

/** Quién responde por una excepción o una deuda. Lista cerrada (ver `politica.ts`). */
export type Responsable = "dueño";

/** Quién aprobó y dónde quedó escrito: `referencia` es `PR #n`, `commit <sha>` o `DEC-nn`. */
export interface Aprobacion {
  por: string;
  referencia: string;
}

/** Una renovación de una excepción o una deuda: no se renueva sin justificación (motivo de 20 caracteres o más) ni sin aprobación. */
export interface Renovacion {
  /** `AAAA-MM-DD`: desde este día se cuenta el plazo (reemplaza a `creada`). */
  fecha: string;
  motivo: string;
  aprobacion: Aprobacion;
}

/**
 * Un uso o una definición que el contrato deja pasar a propósito. `fragmento` es el texto que se informa en el reporte (la cadena de clases entera, o lo que
 * coincidió), con los espacios colapsados. Se revisa en las dos direcciones: sin uso real sobra, y sin motivo (20 caracteres o más) falla. Además lleva su gobierno
 * (todo obligatorio): un `responsable` de la lista cerrada, la `aprobacion` con su referencia, `creada`, las `renovaciones` y `vence` (`AAAA-MM-DD`, rige hasta el final
 * de ese día, dentro del tope de `politica.ts` contado desde la última renovación o la creación).
 */
export interface Excepcion {
  archivo: string;
  fragmento: string;
  motivo: string;
  responsable: Responsable;
  aprobacion: Aprobacion;
  /** `AAAA-MM-DD`: el día en que se creó la entrada; el plazo se cuenta desde acá o desde la última renovación. */
  creada: string;
  /** Las renovaciones, de la más vieja a la más nueva (`[]` si no hubo). */
  renovaciones: readonly Renovacion[];
  /** `AAAA-MM-DD`: rige hasta el final de ese día y como mucho `tope` días después de la última renovación (o de `creada`). */
  vence: string;
}

/**
 * Un uso que es legítimo y permanente: es PARTE DE LA DEFINICIÓN del contrato, no una excepción. Si el contrato regula «un borde con ancho sin color», el borde punteado
 * de una línea guía (que no es un separador) está fuera de lo que el contrato quiere vigilar, para siempre. Por eso no lleva responsable, aprobación ni vencimiento: lo
 * decide quien define el contrato (ver «Casos legítimos» en `LEEME.md`). Coincide por el MISMO `archivo` y el `fragmento` exacto (con los espacios colapsados), y se revisa
 * en las dos direcciones: sin uso real sobra (`caso-legitimo-sobrante`) y sin motivo (20 caracteres o más) falla (`caso-legitimo-sin-motivo`).
 */
export interface CasoLegitimo {
  archivo: string;
  fragmento: string;
  motivo: string;
}

/**
 * Un uso o una definición que se arregla más adelante: UNA entrada por cada uso real (dos usos iguales en un archivo son dos entradas). Sin uso real sobra; sin motivo
 * (20 caracteres o más) o sin `resuelveEn` (dónde se paga: un paso, una fase, un pendiente) falla; con el mismo gobierno que una excepción (`responsable`,
 * `aprobacion`, `vence`) y un horizonte más corto. El motor informa cuánta deuda hay.
 */
export interface Deuda {
  archivo: string;
  fragmento: string;
  motivo: string;
  resuelveEn: string;
  responsable: Responsable;
  aprobacion: Aprobacion;
  /** `AAAA-MM-DD`: el día en que se creó la entrada; el plazo se cuenta desde acá o desde la última renovación. */
  creada: string;
  /** Las renovaciones, de la más vieja a la más nueva (`[]` si no hubo). */
  renovaciones: readonly Renovacion[];
  /** `AAAA-MM-DD`: rige hasta el final de ese día y como mucho `tope` días después de la última renovación (o de `creada`). */
  vence: string;
}

export interface Contrato {
  /** kebab-case, único en el manifiesto. */
  id: string;
  /** El riesgo si el contrato falla abierto, en una línea. */
  porQue: string;
  /** El archivo y el ancla de la fuente. El ancla es un símbolo exportado (TS), el selector de una regla (CSS) o un `@theme`. El archivo lleva EXACTAMENTE UNA marca `@contrato <id>` en un comentario. */
  fuente: { archivo: string; ancla: string };
  /** Dónde se busca: carpetas (o archivos) relativas a la raíz del repo, con `/`, y extensiones. Si no da ningún archivo, falla. */
  alcance: { raices: readonly string[]; extensiones: readonly string[] };
  /** El USO crudo que exige el contrato (al menos uno). */
  senales: readonly Detector[];
  declaracion: Declaracion;
  /** Una REDEFINICIÓN de lo que la fuente ya define, fuera de la fuente (`[]` si no hay nada que detectar). */
  definicion: readonly Detector[];
  /** `"descubiertos"`: consumidor es todo archivo del alcance que declara el contrato (tiene que haber al menos uno). Una lista: los consumidores exactos, en las dos direcciones. */
  consumidores: "descubiertos" | readonly string[];
  /** Los usos legítimos y permanentes que el contrato no quiere vigilar, parte de su definición y sin vencimiento (`[]` si no hay). Una excepción o una deuda, en cambio, es temporal. */
  casosLegitimos: readonly CasoLegitimo[];
  excepciones: readonly Excepcion[];
  deuda: readonly Deuda[];
}

export interface Hallazgo {
  /** El id del contrato (o, en una marca desconocida, el id que se leyó). */
  contrato: string;
  tipo: TipoDeHallazgo;
  /** Ruta relativa a la raíz del repo, con `/`. */
  archivo: string;
  /** 1-based. */
  linea: number;
  /** 1-based. */
  columna: number;
  /** Qué falta o qué pasa. */
  que: string;
  /** Cómo se corrige. */
  como: string;
  /** El texto con el que se declara una excepción o una deuda de este hallazgo (vacío si no se puede exceptuar). */
  fragmento: string;
  /** Dónde está la fuente del contrato (`archivo` o `archivo:línea`); vacío si el hallazgo no depende de ella. */
  fuente: string;
}

export interface Resumen {
  contratos: number;
  archivosLeidos: number;
  /** Cuántas entradas de deuda hay en total y por contrato (solo los contratos con deuda). */
  deudaTotal: number;
  deudaPorContrato: Readonly<Record<string, number>>;
  excepcionesTotal: number;
  /** Cuántos casos legítimos hay en total y por contrato (solo los contratos que los tienen): se cuentan en el reporte para que no crezcan en silencio. */
  casosLegitimosTotal: number;
  casosLegitimosPorContrato: Readonly<Record<string, number>>;
}

/** Un aviso del reporte que NO falla: algo que vence pronto, o una deuda que ya se renovó demasiadas veces. */
export type Aviso = { contrato: string; clase: "excepcion" | "deuda"; archivo: string; fragmento: string } & (
  | { tipo: "vence-pronto"; vence: string; dias: number }
  | { tipo: "muchas-renovaciones"; renovaciones: number }
);

export interface Resultado {
  hallazgos: readonly Hallazgo[];
  avisos: readonly Aviso[];
  resumen: Resumen;
}
