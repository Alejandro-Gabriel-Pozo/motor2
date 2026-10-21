import type { Contrato } from "../tipos";

/**
 * Contrato «borde propio de la carta» (paso G3b; antes lo vigilaba `carta-separadores-declarados.test.ts`, ya retirado). El elemento que dibuja su PROPIO borde con
 * una clase de ANCHO (`border`, `border-t`, `border-b`, `border-y`, `border-b-2`, `border-b-[1.5px]`…) no declara el color: sin color el borde cae al color del texto
 * (negro). El color se declara UNA vez en `globals.css` (`.carta-shell .carta-borde`) y el elemento lleva la clase `carta-borde`. La línea fina (`carta-linea-fina`) trae
 * su propio color en `globals.css`, por eso es equivalente. Nunca se escribe el color del borde en el componente: ni un `borderColor` suelto con `carta-border` o un color
 * literal, ni un color literal en una clase arbitraria (`border-[#e7e5e4]`).
 * Su par es `separador-de-lista-de-carta` (la lista con `divide-y`); comparten la fuente `globals.css` y por eso son DOS contratos con una marca cada uno.
 */
const FRASE_DE_ANCHO = "dibuja su propio borde con una clase de ancho";

export const BORDE_PROPIO_DE_CARTA: Contrato = {
  id: "borde-propio-de-carta",
  porQue: "un border-t/border-b/border sin carta-borde pinta el borde con el color del texto (negro) en vez del color de borde de la carta",
  fuente: { archivo: "src/app/globals.css", ancla: ".carta-shell .carta-borde" },
  alcance: { raices: ["src/components/carta-publica"], extensiones: [".tsx"] },
  senales: [
    // `border`, `border-t`, `border-b-2`, `border-y`, `border-b-[1.5px]`: un ANCHO (con o sin lado). Un color (`border-red-500`, `border-[var(--x)]`) o un estilo (`border-dotted`) no.
    { adaptador: "clases", token: /^border(?:-[tblrxyse])?(?:-(?:\d+|\[\d*\.?\d+(?:px|rem|em)\]))?$/, que: FRASE_DE_ANCHO },
  ],
  declaracion: { tipo: "clase-companera", clase: "carta-borde", equivalentes: ["carta-linea-fina"] },
  definicion: [
    // El color de un borde escrito en el componente: un `borderColor` suelto con el token del separador o con un color literal (hex, rgb(), hsl(), oklch()…).
    {
      adaptador: "ts",
      tipo: "propiedad",
      nombre: /^border(?:Top|Bottom|Left|Right|Block|Inline)?(?:Start|End)?Color$/,
      valor: /carta-border|#[0-9a-f]{3,8}\b|(?:^|[^-\w])(?:rgb|hsl|oklch|oklab|lab|lch|hwb)a?\(/i,
      que: "escribe el color de un borde en un `style` (`borderColor`)",
    },
    // Un color de borde literal en una clase arbitraria: `border-[#e7e5e4]`, `border-[rgb(…)]`, `border-t-[oklch(…)]`, `border-[var(--carta-border)]`.
    { adaptador: "clases", token: /^border(?:-[tblrxyse])?-\[(?:#|(?:rgb|hsl|oklch|oklab|lab|lch|hwb)a?\(|var\(--carta-border\))/, que: "escribe el color de un borde en una clase suelta" },
  ],
  consumidores: "descubiertos",
  excepciones: [
    {
      archivo: "src/components/carta-publica/navegacion-carta.tsx",
      fragmento: "flex h-12 w-12 items-center justify-center rounded-full border transition-opacity hover:opacity-80 disabled:opacity-25",
      motivo: "la flecha de página es un botón circular: su borde es del color de marca/flechas (`ESTILO_FLECHA`, un color-mix de `--carta-flechas`), no un separador",
      responsable: "dueño",
      aprobacion: { por: "dueño", referencia: "DEC-01" },
      creada: "2026-10-21",
      renovaciones: [],
      vence: "2026-12-20",
    },
    {
      archivo: "src/components/carta-publica/seccion.tsx",
      fragmento: "min-w-3 flex-1 -translate-y-1 border-b-[1.5px] border-dotted",
      motivo: "los puntitos entre la opción y su precio son decoración del color de la tinta atenuada (`--carta-ink-soft`), no un separador entre productos",
      responsable: "dueño",
      aprobacion: { por: "dueño", referencia: "DEC-01" },
      creada: "2026-10-21",
      renovaciones: [],
      vence: "2026-12-20",
    },
  ],
  deuda: [],
};
