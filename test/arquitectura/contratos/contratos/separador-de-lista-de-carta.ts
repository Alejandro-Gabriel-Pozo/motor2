import type { Contrato } from "../tipos";

/**
 * Contrato «separador de lista de la carta» (paso G3b; antes lo vigilaba `carta-separadores-declarados.test.ts`, ya retirado). `divide-y` / `divide-x` pintan el
 * borde de cada hijo con el color DEL HIJO, y un borde sin color cae al color del texto (negro): el bug de C12. El color de esos separadores se declara UNA vez,
 * en `globals.css` (`.carta-shell .carta-divisor > *`), y toda lista de la carta que use `divide-y` / `divide-x` lleva la clase `carta-divisor`.
 * Su par es `borde-propio-de-carta` (el elemento que dibuja su propio borde); comparten la fuente `globals.css` y por eso son DOS contratos con una marca cada uno.
 */
export const SEPARADOR_DE_LISTA_DE_CARTA: Contrato = {
  id: "separador-de-lista-de-carta",
  porQue: "un divide-y sin carta-divisor pinta los separadores de la lista con el color del texto (negro) en vez del color de borde de la carta",
  fuente: { archivo: "src/app/globals.css", ancla: ".carta-shell .carta-divisor > *" },
  alcance: { raices: ["src/components/carta-publica"], extensiones: [".tsx"] },
  senales: [
    // `divide-y`, `divide-x`, `divide-y-2`: un separador entre hijos (`divide-y-reverse` o `divide-dotted` solos no lo pintan).
    { adaptador: "clases", token: /^divide-[xy](?:-\d+)?$/, que: "separa los hijos de la lista con un `divide-*`" },
  ],
  declaracion: { tipo: "clase-companera", clase: "carta-divisor", equivalentes: [] },
  definicion: [
    // Un color de separador literal en una clase arbitraria: `divide-[#e7e5e4]`, `divide-[rgb(…)]`, `divide-[var(--carta-border)]`.
    { adaptador: "clases", token: /^divide(?:-[tblrxyse])?-\[(?:#|(?:rgb|hsl|oklch|oklab|lab|lch|hwb)a?\(|var\(--carta-border\))/, que: "escribe el color de un separador en una clase suelta" },
  ],
  consumidores: "descubiertos",
  casosLegitimos: [],
  excepciones: [],
  deuda: [],
};
