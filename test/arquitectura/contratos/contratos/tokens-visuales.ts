import type { Contrato } from "../tipos";

/**
 * Contrato «tokens visuales» (Fase 6, paso 6.1). Los colores del sistema visual nacen UNA vez, como tokens `--color-*` en el bloque `@theme static` de `src/app/globals.css`
 * (la fuente, que lleva la marca del contrato junto al ancla), y de ahí salen tanto las variables (`var(--color-papel)`) como las utilidades de Tailwind (`bg-papel`,
 * `text-tinta-suave`, `border-borde`…). El contrato vigila tres cosas:
 *  1. un uso de un token que la fuente no define (`text-tinta-sueve`, `var(--color-papell)`): cae en silencio a otro color o a ninguno (`uso-sin-declarar`);
 *  2. un token definido fuera de `@theme static`, o definido dos veces (`definicion-duplicada`): dos valores para el mismo color;
 *  3. un token definido que nadie usa (`declaracion-sin-uso`): un token sin consumidor es ruido en el sistema.
 * Las clases se leen con una expresión laxa a propósito: tiene que casar también el nombre MAL escrito (`bg-papell`), porque si solo casara nombres válidos el error de
 * tipeo pasaría sin que nadie lo vea. La señal de clases se dispara con el nombre BASE de un token (`papel`, `tinta`, `borde`, `marca`, `ok`, `aviso`, `error`, `foco`,
 * `velo`, `sombra`, `superficie`) tras una utilidad de color; un nombre nuevo de familia se agrega acá junto con su token.
 *
 * DEUDA INICIAL (DEC-03, inventario inicial de la Fase 6: PENDIENTE de ratificación del dueño antes del pull request). Lo que no se pudo resolver en 6.1 está escrito
 * uso por uso en `deuda`, con su motivo y el paso que lo paga: los 15 alias de `.pos-shell` (6.30, lote POS)
 * (y los dos colores sueltos de `:root`, `--background` y `--foreground`, que se pagaron en 6.30 al pasar los tooltips de los gráficos a `var(--color-*)`). Todas vencen a los 60 días de su creación. (La paleta propia de la carta del panel, ADR-034, se pagó en 6.4: `carta-mant.module.css` ya consume los tokens;
 * el alias `--color-background` de `@theme inline` se pagó en 6.8.2: `avisos-de-accion.tsx` usa `bg-superficie` y nadie más lo leía.)
 */
const RE_UTILIDAD_DE_TOKEN = new RegExp(
  "^(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|divide|fill|stroke|accent|caret|decoration|placeholder|from|via|to|shadow)-" +
    "(?<nombre>(?:papel|superficie|tinta|borde|marca|ok|aviso|error|foco|velo|sombra)[\\w-]*)(?:\\/[\\w.%[\\]]+)?$"
);

const MOTIVO_ALIAS_DEL_SALON = "alias de color del salón (`.pos-shell`) que el POS lee con var(); vale lo mismo que su token y ya nadie los lee (6.30, la regla `sin-alias-de-color-del-salon`); se borran junto con la última deuda";

const DEUDA_COMUN = {
  responsable: "dueño",
  aprobacion: { por: "dueño", referencia: "DEC-03" },
  creada: "2026-10-21",
  renovaciones: [],
  vence: "2026-12-20",
} as const;

export const TOKENS_VISUALES: Contrato = {
  id: "tokens-visuales",
  porQue: "un color fuera de los tokens, o un token mal escrito, separa la pantalla del sistema visual único y cae en silencio a otro color",
  fuente: { archivo: "src/app/globals.css", ancla: "@theme static" },
  alcance: { raices: ["src/app", "src/components", "src/ui"], extensiones: [".css", ".ts", ".tsx"] },
  senales: [
    { adaptador: "css", tipo: "variable", nombre: /^--color-/, que: "lee un token con var()" },
    { adaptador: "clases", token: RE_UTILIDAD_DE_TOKEN, que: "usa un token en una clase" },
  ],
  declaracion: { tipo: "nombre-definido-en-la-fuente", prefijoDeNombre: "--color-" },
  definicion: [
    { adaptador: "css", tipo: "define-variable", nombre: /^--color-/, que: "define un token fuera de `@theme static`" },
    {
      adaptador: "css",
      tipo: "define-variable",
      nombre: /^--(?:paper|ink|ink-soft|ink-faint|brand|brand-hover|border|mesa-(?:libre|draft|ocupada)(?:-tint|-ink)?)$/,
      que: "define un alias de color del salón",
    },
    { adaptador: "css", tipo: "define-variable", nombre: /^--(?:background|foreground)$/, que: "define un fondo o texto suelto fuera de los tokens" },
  ],
  consumidores: "descubiertos",
  casosLegitimos: [],
  excepciones: [],
  deuda: [
    // 1) Los 15 alias de `.pos-shell` (uno por uso): el salón los lee con `var(--paper)`, `var(--mesa-libre-tint)`… en decenas de archivos de `src/app/(pos)` y `src/components`. Valen lo mismo que el
    //    token; se retiran cuando el lote POS migre esos usos a las utilidades de los tokens.
    { archivo: "src/app/globals.css", fragmento: "--paper: var(--color-papel)", motivo: MOTIVO_ALIAS_DEL_SALON, resuelveEn: "6.30 (lote POS, después del bloque 2)", ...DEUDA_COMUN },
    { archivo: "src/app/globals.css", fragmento: "--ink: var(--color-tinta)", motivo: MOTIVO_ALIAS_DEL_SALON, resuelveEn: "6.30 (lote POS, después del bloque 2)", ...DEUDA_COMUN },
    { archivo: "src/app/globals.css", fragmento: "--brand: var(--color-marca)", motivo: MOTIVO_ALIAS_DEL_SALON, resuelveEn: "6.30 (lote POS, después del bloque 2)", ...DEUDA_COMUN },
    { archivo: "src/app/globals.css", fragmento: "--brand-hover: var(--color-marca-hover)", motivo: MOTIVO_ALIAS_DEL_SALON, resuelveEn: "6.30 (lote POS, después del bloque 2)", ...DEUDA_COMUN },
    { archivo: "src/app/globals.css", fragmento: "--border: var(--color-borde)", motivo: MOTIVO_ALIAS_DEL_SALON, resuelveEn: "6.30 (lote POS, después del bloque 2)", ...DEUDA_COMUN },
    { archivo: "src/app/globals.css", fragmento: "--ink-soft: var(--color-tinta-suave)", motivo: MOTIVO_ALIAS_DEL_SALON, resuelveEn: "6.30 (lote POS, después del bloque 2)", ...DEUDA_COMUN },
    { archivo: "src/app/globals.css", fragmento: "--ink-faint: var(--color-tinta-tenue)", motivo: MOTIVO_ALIAS_DEL_SALON, resuelveEn: "6.30 (lote POS, después del bloque 2)", ...DEUDA_COMUN },
    { archivo: "src/app/globals.css", fragmento: "--mesa-libre: var(--color-ok)", motivo: MOTIVO_ALIAS_DEL_SALON, resuelveEn: "6.30 (lote POS, después del bloque 2)", ...DEUDA_COMUN },
    { archivo: "src/app/globals.css", fragmento: "--mesa-libre-tint: var(--color-ok-tinte)", motivo: MOTIVO_ALIAS_DEL_SALON, resuelveEn: "6.30 (lote POS, después del bloque 2)", ...DEUDA_COMUN },
    { archivo: "src/app/globals.css", fragmento: "--mesa-libre-ink: var(--color-ok-tinta)", motivo: MOTIVO_ALIAS_DEL_SALON, resuelveEn: "6.30 (lote POS, después del bloque 2)", ...DEUDA_COMUN },
    { archivo: "src/app/globals.css", fragmento: "--mesa-draft: var(--color-aviso)", motivo: MOTIVO_ALIAS_DEL_SALON, resuelveEn: "6.30 (lote POS, después del bloque 2)", ...DEUDA_COMUN },
    { archivo: "src/app/globals.css", fragmento: "--mesa-draft-tint: var(--color-aviso-tinte)", motivo: MOTIVO_ALIAS_DEL_SALON, resuelveEn: "6.30 (lote POS, después del bloque 2)", ...DEUDA_COMUN },
    { archivo: "src/app/globals.css", fragmento: "--mesa-draft-ink: var(--color-aviso-tinta)", motivo: MOTIVO_ALIAS_DEL_SALON, resuelveEn: "6.30 (lote POS, después del bloque 2)", ...DEUDA_COMUN },
    { archivo: "src/app/globals.css", fragmento: "--mesa-ocupada: var(--color-error)", motivo: MOTIVO_ALIAS_DEL_SALON, resuelveEn: "6.30 (lote POS, después del bloque 2)", ...DEUDA_COMUN },
    { archivo: "src/app/globals.css", fragmento: "--mesa-ocupada-tint: var(--color-error-tinte)", motivo: MOTIVO_ALIAS_DEL_SALON, resuelveEn: "6.30 (lote POS, después del bloque 2)", ...DEUDA_COMUN },
  ],
};
