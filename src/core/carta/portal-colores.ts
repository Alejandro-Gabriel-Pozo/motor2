import { razonDeContraste } from "./color-css";
import { canalesDeMarcaHex, marcaGuardadaLegible } from "./marca-derivada";
import { resolverEstiloPortal, type EstiloPortal } from "./portal";
import { valoresDelPortalDual, type EstiloDelPortalNuevo } from "./portal-de-empresa-lectura";

/**
 * COLORES DEL PORTAL como en Pedernal (pestaña Portal de «Apariencia y publicación»; decisión del dueño, 2026-11-17: «Sí, los tres fondos elegibles.»; instrucción: «2.- si como pedernal»: un color que no se lee se AJUSTA y se avisa, no se rechaza).
 * Los tres fondos son los de la maqueta `portal-de-la-empresa.html` de Pedernal (líneas 398, 422-424, 482 y 798): ENCABEZADO (detrás del logo), PÁGINA y DETRÁS DE LA IMAGEN (la tarjeta redondeada detrás de la imagen o del listado). Los textos NO se eligen: se
 * derivan (blanco o negro, el que más contraste da) y el fondo llega a 7:1 AL MOSTRAR. PURO: no lee la base ni el reloj.
 *
 * El ajuste es la función `colorDeLaCarta` de Pedernal (ZuluHub-ERP `src/capacidades/experiencia/vidriera/color-de-la-carta.ts:102-119`), reproducida con el mismo comportamiento: se guarda el color ELEGIDO y el ajustado se calcula al mostrar (así se puede
 * subir el mínimo después sin migrar datos). UNIFICAR después con la constante y la función del «paso A» de la pestaña Tema (`CONTRASTE_MINIMO_DE_LA_CARTA`) cuando esa etapa esté integrada: hoy son dos copias de una misma regla (7 a 1).
 */

/** Contraste mínimo del texto sobre cada fondo del portal (Pedernal `color-de-la-carta.ts:14`; «ok» del dueño el 09/11). */
const CONTRASTE_MINIMO_DEL_PORTAL = 7;

/** Las seis paletas de la maqueta del portal de Pedernal (`portal-de-la-empresa.html:438`); «Otro color» es cualquier `#rrggbb`. */
export const PALETAS_DEL_PORTAL = [
  { nombre: "Azul", hex: "#1f4e79" },
  { nombre: "Verde", hex: "#17562f" },
  { nombre: "Bordó", hex: "#7a1f2b" },
  { nombre: "Tostado", hex: "#6b3f1d" },
  { nombre: "Negro", hex: "#1b1f24" },
  { nombre: "Violeta", hex: "#4b2e83" },
] as const;

/** Mensaje del «Otro color» (el texto de Pedernal, `carta.html` 09/11/2026: un `#` y seis caracteres). */
export const MENSAJE_FORMATO_DEL_COLOR_DEL_PORTAL = "Escribí el color como #0e7490";

const FORMA_DEL_COLOR = /^#[0-9a-f]{6}$/;
const BLANCO = "#ffffff";
const NEGRO = "#000000";
/** Hasta dónde se baja la luminosidad (puntos de HSL, de a uno): cerca del negro, donde ya no hay tono que cuidar (Pedernal `:35`). */
const LUMINOSIDAD_MINIMA = 4;

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

export interface ColorDelPortal {
  /** El color a usar: el elegido si ya llega a 7:1 con su texto, o el elegido oscurecido con el mismo tono. `#rrggbb` en minúsculas. */
  hex: string;
  /** El texto que se pone encima: blanco o negro, lo elige el sistema. */
  texto: typeof BLANCO | typeof NEGRO;
  /** `true` si hubo que oscurecer el color elegido (la pantalla avisa; guardar sigue permitido). */
  ajustado: boolean;
  /** La razón de contraste de `hex` con su texto (el «N a 1» del aviso de la maqueta). */
  razon: number;
}

const canales = (hex: string): [number, number, number] => [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
const razon = (a: string, b: string): number => razonDeContraste(canales(a), canales(b));

/** El «N a 1» de la pantalla: con coma decimal (es-AR) y TRUNCADO a un decimal, para no informar nunca más contraste del real (7,04 se dice «7») (maqueta `portal-de-la-empresa.html:633`). */
export const textoDelContraste = (n: number): string => String(Math.floor(n * 10 + 1e-9) / 10).replace(".", ",");

const armar = (hex: string, ajustado: boolean): ColorDelPortal => {
  const texto = textoSobre(hex);
  return { hex, texto, ajustado, razon: razon(hex, texto) };
};

/** `#rrggbb` → [matiz 0-360, saturación 0-100, luminosidad 0-100]. */
function aHsl(hex: string): readonly [number, number, number] {
  const [r, g, b] = canales(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

function deHsl(matiz: number, saturacion: number, luminosidad: number): string {
  const s = saturacion / 100;
  const l = luminosidad / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + matiz / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const dos = (v: number): string => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${dos(f(0))}${dos(f(8))}${dos(f(4))}`;
}

/** Blanco o negro, el que más contraste da; si empatan, blanco (igual que Pedernal). */
const textoSobre = (hex: string): ColorDelPortal["texto"] => (razon(hex, BLANCO) >= razon(hex, NEGRO) ? BLANCO : NEGRO);

/**
 * Lo que el portal usa para un color elegido; `null` si no es `#rrggbb` (mayúsculas o minúsculas; falla cerrado, no adivina). Si el elegido llega a 7:1 con su texto se devuelve igual (en minúsculas); si no, se baja la luminosidad de a un punto conservando matiz
 * y saturación hasta llegar a 7:1 con texto BLANCO; el tope es el negro puro (21:1), así que siempre termina y el portal nunca queda ilegible.
 */
export function colorDelPortal(elegido: unknown): ColorDelPortal | null {
  if (typeof elegido !== "string") return null;
  const hex = elegido.toLowerCase();
  if (!FORMA_DEL_COLOR.test(hex)) return null;
  const texto = textoSobre(hex);
  if (razon(hex, texto) >= CONTRASTE_MINIMO_DEL_PORTAL) return armar(hex, false);
  const [matiz, saturacion, luminosidad] = aHsl(hex);
  for (let l = Math.floor(luminosidad); l >= LUMINOSIDAD_MINIMA; l--) {
    const candidato = deHsl(matiz, saturacion, l);
    if (razon(candidato, BLANCO) >= CONTRASTE_MINIMO_DEL_PORTAL) return armar(candidato, true);
  }
  return armar(NEGRO, true);
}

/** Los tres fondos elegidos (`PortalDeEmpresa.colorEncabezado|colorPagina|colorDetras`; `null` = el valor de siempre del portal). */
export interface FondosDelPortal {
  encabezado: string | null;
  pagina: string | null;
  detras: string | null;
}

/** Variable CSS del color de los textos sobre la página (la lee `globals.css`: el pie y el aviso de «todavía no hay cartas»). */
const VARIABLE_TEXTO_DE_LA_PAGINA = "--portal-pagina-color";

/**
 * El portal con los tres fondos elegidos y los textos derivados. Sin fondo elegido NO toca nada de ese grupo (el portal sale como hoy: lo cargado manda). Con fondo: el fondo se muestra ajustado a 7:1 y los textos que van encima salen derivados; pero un texto que la empresa YA
 * cargó (`portal_header_color`, etc.) sigue mandando si llega a 7:1 sobre el fondo que se muestra (lo cargado manda) y, si no llega, se deriva (el portal nunca queda ilegible). Los textos de la tarjeta dependen del fondo «detrás de la imagen» (`portal_card_bg`: la equivalencia
 * la fija el diseño `docs/diseno-carta-apariencia-y-publicacion-como-pedernal-2026-11-17.md` §2.3, fila «Fondo de la tarjeta»). El borde, los tamaños y lo demás siguen siendo los del portal de hoy. Devuelve un estilo nuevo; no modifica el recibido.
 */
export function conFondosDelPortal(estilo: EstiloPortal, fondos: FondosDelPortal): EstiloPortal {
  const valores = { ...estilo.valores };
  const variablesCss = { ...estilo.variablesCss };
  const fijar = (clave: keyof typeof valores & string, variable: string, valor: string) => {
    (valores as Record<string, string>)[clave] = valor;
    variablesCss[variable] = valor;
  };
  const textoSobreFondo = (cargado: string, fondo: ColorDelPortal): string => {
    const legible = marcaGuardadaLegible(cargado);
    const canalesCargado = legible === null ? null : canalesDeMarcaHex(legible);
    return canalesCargado !== null && razonDeContraste([...canalesCargado], canales(fondo.hex)) >= CONTRASTE_MINIMO_DEL_PORTAL ? cargado : fondo.texto;
  };

  const encabezado = colorDelPortal(fondos.encabezado);
  if (encabezado) {
    fijar("portal_header_bg", "--portal-header-bg", encabezado.hex);
    fijar("portal_header_color", "--portal-header-color", textoSobreFondo(estilo.valores.portal_header_color, encabezado));
    fijar("portal_etiqueta_color", "--portal-etiqueta-color", textoSobreFondo(estilo.valores.portal_etiqueta_color, encabezado));
    fijar("portal_titulo_color", "--portal-titulo-color", textoSobreFondo(estilo.valores.portal_titulo_color, encabezado));
  }
  const pagina = colorDelPortal(fondos.pagina);
  if (pagina) {
    fijar("portal_fondo_color", "--portal-fondo-color", pagina.hex);
    variablesCss[VARIABLE_TEXTO_DE_LA_PAGINA] = pagina.texto;
  }
  const detras = colorDelPortal(fondos.detras);
  if (detras) {
    fijar("portal_card_bg", "--portal-card-bg", detras.hex);
    fijar("portal_card_color", "--portal-card-color", textoSobreFondo(estilo.valores.portal_card_color, detras));
    fijar("portal_card_color_hover", "--portal-card-color-hover", textoSobreFondo(estilo.valores.portal_card_color_hover, detras));
    fijar("portal_card_notas_color", "--portal-card-notas-color", textoSobreFondo(estilo.valores.portal_card_notas_color, detras));
    fijar("portal_card_flecha_color", "--portal-card-flecha-color", textoSobreFondo(estilo.valores.portal_card_flecha_color, detras));
  }
  return { ...estilo, valores, variablesCss };
}

/** Lo que la fila `PortalDeEmpresa` dice del estilo, con el tercer fondo. */
export interface PortalNuevoParaElEstilo extends EstiloDelPortalNuevo {
  colorDetras: string | null;
}

/**
 * El estilo del portal cuando la empresa tiene su fila nueva Y la pantalla simple está encendida. Igual que la lectura dual de PR-A (`valoresDelPortalDual`) con UNA diferencia: lo que la fila no cargó (color de encabezado, color de página, línea superior, título) sigue saliendo
 * de lo que la empresa ya tenía en el Json, en vez de caer al valor por defecto («lo que la empresa ya cargó sigue mandando»: crear la fila no cambia el portal). Después aplica los tres fondos elegidos con sus textos derivados (`conFondosDelPortal`); un fondo que viene SOLO
 * del Json se muestra como siempre, sin ajustar.
 */
export function estiloDelPortalSimple(valoresJson: unknown, nuevo: PortalNuevoParaElEstilo): EstiloPortal {
  const json: Record<string, unknown> = typeof valoresJson === "object" && valoresJson !== null && !Array.isArray(valoresJson) ? (valoresJson as Record<string, unknown>) : {};
  const deJson = (clave: string): string | null => (typeof json[clave] === "string" ? json[clave] : null);
  const valores = valoresDelPortalDual(valoresJson, {
    ...nuevo,
    colorEncabezado: nuevo.colorEncabezado ?? deJson("portal_header_bg"),
    colorPagina: nuevo.colorPagina ?? deJson("portal_fondo_color"),
    lineaSuperior: nuevo.lineaSuperior ?? deJson("portal_etiqueta"),
    titulo: nuevo.titulo ?? deJson("portal_titulo"),
  });
  return conMaquetaDelPortal(conFondosDelPortal(resolverEstiloPortal(valores), { encabezado: nuevo.colorEncabezado, pagina: nuevo.colorPagina, detras: nuevo.colorDetras }), nuevo.colorDetras);
}

/** Variables CSS propias de la maqueta (las lee `globals.css`, `.portal[data-maqueta]`). */
const VARIABLE_DETRAS_DE_LA_MAQUETA = "--portal-detras-bg";
const VARIABLE_BARRA_DE_LA_MAQUETA = "--portal-barra-color";
const VARIABLE_VER_CARTA_DE_LA_MAQUETA = "--portal-ver-carta-color";

/**
 * El portal como la maqueta de Pedernal (`portal-de-la-empresa.html:285-307`, variante A, «Vista previa»): el tercer fondo («detrás de la imagen») es la TARJETA CONTENEDORA redondeada que envuelve el listado, y adentro cada sucursal es una tarjeta BLANCA con barra lateral de color,
 * nombre, teléfono y «Ver carta». Por eso los textos de esas tarjetas se pintan sobre BLANCO (no sobre el tercer fondo) con tokens fijos del sistema: la tinta (`--carta-ink`), la tinta suave (`--carta-ink-soft`) y «Ver carta» con el color de marca si llega a 7:1 sobre blanco, y si no `--carta-primary`
 * (los tres ya llegan a 7:1: lo fija `test/carta/portal-colores-maqueta.test.ts`). Sobre el tercer fondo no cae ningún texto. La barra lateral es decorativa: el color de marca del portal si lo hay, si no `--carta-primary`. Sin tercer fondo elegido la tarjeta contenedora no se pinta (transparente).
 * Solo agrega variables y la marca `conMaqueta`: `valores` queda como estaba.
 */
function conMaquetaDelPortal(estilo: EstiloPortal, detrasElegido: string | null): EstiloPortal {
  const variablesCss = { ...estilo.variablesCss };
  const detras = colorDelPortal(detrasElegido);
  if (detras) variablesCss[VARIABLE_DETRAS_DE_LA_MAQUETA] = detras.hex;
  const marca = estilo.valores.portal_color_marca;
  const canalesMarca = canalesDeMarcaHex(marca);
  if (canalesMarca !== null) {
    variablesCss[VARIABLE_BARRA_DE_LA_MAQUETA] = marca;
    if (razonDeContraste([...canalesMarca], canales(BLANCO)) >= CONTRASTE_MINIMO_DEL_PORTAL) variablesCss[VARIABLE_VER_CARTA_DE_LA_MAQUETA] = marca;
  }
  return { ...estilo, variablesCss, conMaqueta: true };
}
