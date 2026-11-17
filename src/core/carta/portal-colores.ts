import { resolverEstiloPortal, type EstiloPortal } from "./portal";
import { valoresDelPortalDual, type EstiloDelPortalNuevo } from "./portal-de-empresa-lectura";

/**
 * COLORES DEL PORTAL como en Pedernal. Decisiones del dueño, 2026-11-17: «Sí, los tres fondos elegibles.» y «Ve como un pedernal.»: en el portal el texto y los íconos NO dependen del color elegido (son los colores fijos del sistema, `--carta-ink`, `--carta-ink-soft` y el blanco de la tarjeta,
 * a 7:1 o más sobre los fondos del sistema); el color elegido solo pinta ACENTOS y bordes. Se guarda el color del dueño TAL CUAL (nada de ajustar la luminosidad ni de avisar «se usa otro»: Pedernal no rechaza ni ajusta una marca, `apps/web/ui/tokens.css:43-49`: «Acción y acento: lo único que
 * sale de la marca»; `apps/web/ui/plantillas/vidriera/contraste.test.ts`: «una marca no puede bajar la legibilidad»). PURO: no lee la base ni el reloj.
 *
 * Los tres colores (maqueta `portal-de-la-empresa.html` de Pedernal, líneas 398, 422-424, 482 y 798) pintan: ENCABEZADO = el filo de abajo del encabezado; PÁGINA = el filo de arriba de la página; DETRÁS DE LA IMAGEN = el borde de las tarjetas. (PROPUESTA: qué acento pinta cada uno lo decide este PR
 * porque el dueño pidió «tres fondos elegibles» y a la vez que el texto no dependa de ellos; ver la pregunta abierta del diseño §10.)
 */

/** Las seis paletas de la maqueta del portal de Pedernal (`portal-de-la-empresa.html:438`); «Otro color» es cualquier `#rrggbb`. */
export const PALETAS_DEL_PORTAL = [
  { nombre: "Azul", hex: "#1f4e79" },
  { nombre: "Verde", hex: "#17562f" },
  { nombre: "Bordó", hex: "#7a1f2b" },
  { nombre: "Tostado", hex: "#6b3f1d" },
  { nombre: "Negro", hex: "#1b1f24" },
  { nombre: "Violeta", hex: "#4b2e83" },
] as const;
const FORMA_DEL_COLOR = /^#[0-9a-f]{6}$/;

/** Rótulo y mensaje del «Otro color» (los textos de Pedernal, `carta.html` 09/11/2026: un `#` y seis caracteres). */
export const ROTULO_DE_OTRO_COLOR_DEL_PORTAL = "Color (por ejemplo #0e7490)";
export const MENSAJE_FORMATO_DEL_COLOR_DEL_PORTAL = "Escribí el color como #0e7490";

/** El color elegido en minúsculas, o `null` si no es `#rrggbb` (mayúsculas o minúsculas; falla cerrado, no adivina). NO se ajusta nunca. */
export function colorDelPortal(elegido: unknown): string | null {
  if (typeof elegido !== "string") return null;
  const hex = elegido.toLowerCase();
  return FORMA_DEL_COLOR.test(hex) ? hex : null;
}

export type EleccionDeFondo = "ninguna" | "otro" | (typeof PALETAS_DEL_PORTAL)[number]["hex"];

/** El color que sale de lo elegido en la pantalla: el de la paleta (el valor del radio ES el hex), lo escrito en «Otro color» o vacío («sin color»: el del portal de siempre). Toda elección que no sea de la lista da vacío (todo nace cerrado). */
export function fondoDeLaEleccion(eleccion: unknown, otro: unknown): string {
  if (eleccion === "otro") return typeof otro === "string" ? otro.trim() : "";
  return PALETAS_DEL_PORTAL.find((p) => p.hex === eleccion)?.hex ?? "";
}

/** Al revés: qué opción de la pantalla corresponde a un color ya guardado (vacío = «ninguna»; el de una paleta, esa; otro texto, «Otro color» con ese texto a la vista, para corregirlo y no perderlo). */
export function eleccionDeFondo(guardado: string | null): { eleccion: EleccionDeFondo; otro: string } {
  const texto = (guardado ?? "").trim();
  if (texto === "") return { eleccion: "ninguna", otro: "" };
  const paleta = PALETAS_DEL_PORTAL.find((p) => p.hex === texto.toLowerCase());
  return paleta ? { eleccion: paleta.hex, otro: "" } : { eleccion: "otro", otro: texto };
}

/** Los tres colores elegidos (`PortalDeEmpresa.colorEncabezado|colorPagina|colorDetras`; `null` = el valor de siempre del portal). */
export interface FondosDelPortal {
  encabezado: string | null;
  pagina: string | null;
  detras: string | null;
}

/** Las variables CSS de los acentos (las lee `globals.css`; ninguna es un color de texto ni de ícono). */
export const VARIABLES_DE_ACENTO_DEL_PORTAL = { encabezado: "--portal-acento-encabezado", pagina: "--portal-acento-pagina", detras: "--portal-card-border" } as const;

/**
 * El portal con los tres colores como ACENTOS: el filo del encabezado, el filo de la página y el borde de las tarjetas (también al pasar el mouse). Los textos, los íconos y los fondos NO se tocan: salen de los tokens del sistema (o de lo que la empresa ya cargó en el Json). Sin color
 * elegido no cambia nada. Devuelve un estilo nuevo; no modifica el recibido.
 */
export function conFondosDelPortal(estilo: EstiloPortal, fondos: FondosDelPortal): EstiloPortal {
  const variablesCss = { ...estilo.variablesCss };
  const encabezado = colorDelPortal(fondos.encabezado);
  const pagina = colorDelPortal(fondos.pagina);
  const detras = colorDelPortal(fondos.detras);
  if (encabezado) variablesCss[VARIABLES_DE_ACENTO_DEL_PORTAL.encabezado] = encabezado;
  if (pagina) variablesCss[VARIABLES_DE_ACENTO_DEL_PORTAL.pagina] = pagina;
  if (detras) {
    variablesCss[VARIABLES_DE_ACENTO_DEL_PORTAL.detras] = detras;
    variablesCss["--portal-card-border-hover"] = detras;
  }
  return { ...estilo, variablesCss };
}

/** Lo que la fila `PortalDeEmpresa` dice del estilo, con el tercer fondo. */
export interface PortalNuevoParaElEstilo extends EstiloDelPortalNuevo {
  colorDetras: string | null;
}

/**
 * El estilo del portal cuando la empresa tiene su fila nueva Y la pantalla simple está encendida. Igual que la lectura dual de PR-A (`valoresDelPortalDual`) con UNA diferencia: lo que la fila no cargó (color de encabezado, color de página, línea superior, título) sigue saliendo
 * de lo que la empresa ya tenía en el Json, en vez de caer al valor por defecto («lo que la empresa ya cargó sigue mandando»: crear la fila no cambia el portal). Después aplica los tres colores elegidos como acentos (`conFondosDelPortal`).
 */
export function estiloDelPortalSimple(valoresJson: unknown, nuevo: PortalNuevoParaElEstilo): EstiloPortal {
  const json: Record<string, unknown> = typeof valoresJson === "object" && valoresJson !== null && !Array.isArray(valoresJson) ? (valoresJson as Record<string, unknown>) : {};
  const deJson = (clave: string): string | null => (typeof json[clave] === "string" ? json[clave] : null);
  const valores = valoresDelPortalDual(valoresJson, {
    ...nuevo,
    // Los colores elegidos NO son fondos: el fondo del encabezado y el de la página siguen siendo los que la empresa ya cargó (o los del sistema).
    colorEncabezado: deJson("portal_header_bg"),
    colorPagina: deJson("portal_fondo_color"),
    lineaSuperior: nuevo.lineaSuperior ?? deJson("portal_etiqueta"),
    titulo: nuevo.titulo ?? deJson("portal_titulo"),
  });
  return conFondosDelPortal(resolverEstiloPortal(valores), { encabezado: nuevo.colorEncabezado, pagina: nuevo.colorPagina, detras: nuevo.colorDetras });
}
