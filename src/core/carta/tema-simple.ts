import { DEFAULTS_DEL_LIBRO_MAQUETA } from "./libro-estilo-maqueta";

/**
 * INTERRUPTOR de la pantalla simple del Tema de la carta (PASO A de «Apariencia y publicación», `docs/diseno-carta-apariencia-y-publicacion-como-pedernal-2026-11-17.md`; dueño, 2026-11-17: «Te pedía color de marca nada más…»).
 * Una sola constante, y NACE APAGADA (todo nace cerrado). Con `false`, la pestaña Tema y su guardado son los de siempre, sin ningún cambio. Con `true`, la pestaña pide solo diez campos (`CLAVES_TEMA_SIMPLE`) con un único
 * «Guardar» que cambia SOLO esas claves y conserva todas las demás: lo ya cargado por una empresa sigue mandando. Qué se hace con las otras 58 claves está declarado clave por clave en el diseño (§2.2).
 *
 * NECESIDAD (quién y dónde está escrita): el dueño, 2026-11-17 (registrada en `motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`): «Te pedía color de marca nada más. Lo otro iba por contraste y como era
 * oscuro quedaba ahí.» y «lo del contacto sí». Rubro, lugar y foto de portada (dueño, 2026-11-17: «2.- si como pedernal», «El lugar sí.», «Si suma foto de portada»; diseño §2.5 y §2.6). Lema, descripción y tipografía NO se piden.
 *
 * La condición para encenderla es el spec `test/e2e/carta-tema-simple.spec.ts` (los dos estados, con axe a 375 y 1366 px). Para volver a apagarla: poner `false` (nada más; no se borra nada ni se toca la base).
 * `src/lib/tema-simple-visible.ts` es quien la consulta (agrega un encendido SOLO de prueba por variable de entorno).
 */
export const TEMA_SIMPLE_VISIBLE: boolean = false;

/**
 * El marcador de `marca_derivada` que escribe la pantalla simple: la carta se lee sobre el fondo oscuro del sistema con la tinta del sistema (colores FIJOS, no derivados de la marca) y la marca solo en acentos y bordes
 * (dueño, 2026-11-17: «Ve como un pedernal.»). Distinto de «si» (fondo claro, ya cargado por algunas empresas): «lo cargado manda».
 */
export const MARCADOR_DE_MARCA_OSCURA = "oscura";

/** El fondo oscuro del sistema: el mismo de la maqueta de Pedernal (`#19191a`). Solo se usa cuando la empresa no cargó un fondo propio. */
export const FONDO_OSCURO_DEL_SISTEMA: string = DEFAULTS_DEL_LIBRO_MAQUETA.color_fondo_dia!;

/** Lo que responde el servidor al guardado simple con el interruptor apagado (aunque el pedido se arme a mano; el permiso sigue siendo lo primero). */
export const MENSAJE_TEMA_SIMPLE_APAGADO = "La pantalla simple del tema de la carta todavía no está disponible.";

/**
 * Las diez claves de la pantalla simple, en el orden en que se muestran: color de marca, logo, nombre, rubro (`hero_etiqueta_superior`), lugar (`restaurante_subtitulo`), foto de portada (`hero_imagen_fondo_url`) y los cuatro del contacto. Es la lista PERMITIDA: el guardado simple solo lee estas claves del pedido y solo cambia estas
 * claves de lo guardado. Una clave nueva del Tema no entra acá sin una decisión del dueño (lo vigila `test/carta/tema-simple.test.ts`, con la declaración de las 65 en `tema-simple.oraculo.ts`).
 */
export const CLAVES_TEMA_SIMPLE = [
  "color_marca",
  "restaurante_logo_url",
  "restaurante_nombre",
  "hero_etiqueta_superior",
  "restaurante_subtitulo",
  "hero_imagen_fondo_url",
  "restaurante_instagram",
  "restaurante_facebook",
  "restaurante_whatsapp",
  "restaurante_footer_maps_url",
] as const;
/** Largo máximo del rubro en la pantalla simple: el de Pedernal (`zuluhub-erp` `src/primitivas/texto/datos-de-carta-publica.ts:15`, `LARGO_MAXIMO_DEL_RUBRO_DE_CARTA = 40`). El catálogo del Tema admite 120; se exige 40 SOLO si el rubro cambia (un rubro ya cargado más largo no bloquea el guardado mientras no se toque). */
export const LARGO_MAXIMO_DEL_RUBRO_SIMPLE = 40;
export const MENSAJE_RUBRO_DEMASIADO_LARGO = `El rubro puede tener hasta ${LARGO_MAXIMO_DEL_RUBRO_SIMPLE} caracteres.`;

export type ClaveTemaSimple = (typeof CLAVES_TEMA_SIMPLE)[number];

const objetoPlano = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * MEZCLA del guardado simple (invariante I1 del diseño, «lo cargado manda»): parte de lo GUARDADO tal cual (todas las claves, incluidas las que el catálogo ya no conoce y las que están mal cargadas) y cambia SOLO las diez de
 * `CLAVES_TEMA_SIMPLE`: la que viene con valor se escribe, la que viene vacía se saca (vacío = default de la carta, como en el guardado de siempre). El marcador `marca_derivada` es el único otro cambio: con color de marca queda
 * en `oscura` (la carta se muestra sobre el fondo oscuro, con el texto en colores fijos del sistema), sin color de marca se saca. Pura: no toca los argumentos.
 */
export function mezclarTemaSimple(guardado: unknown, simples: Readonly<Partial<Record<ClaveTemaSimple, string>>>): Record<string, unknown> {
  const mezcla = { ...objetoPlano(guardado) };
  for (const clave of CLAVES_TEMA_SIMPLE) {
    const valor = simples[clave];
    if (valor === undefined || valor === "") delete mezcla[clave];
    else mezcla[clave] = valor;
  }
  if (mezcla.color_marca === undefined) delete mezcla.marca_derivada;
  else mezcla.marca_derivada = MARCADOR_DE_MARCA_OSCURA;
  return mezcla;
}

/** ¿Dos Json tienen el mismo contenido, sin importar el orden de las claves? (para no escribir ni versionar un guardado que no cambia nada). */
export function mismoContenido(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => mismoContenido(x, b[i]));
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && mismoContenido((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return Object.is(a, b);
}

/** Los dos textos de la pantalla que nombran el formato del color (aprobados en `carta.html` de Pedernal, 09/11/2026), acá para que el guard y la pantalla digan lo mismo. */
export const ROTULO_DE_OTRO_COLOR = "Color principal (por ejemplo #0e7490)";
export const MENSAJE_FORMATO_DEL_COLOR = "Escribí el color como #0e7490";

/** Las seis paletas de Pedernal (`carta.html` y `portal-de-la-empresa.html`, aprobadas el 09/11/2026). «Otro color» es un `#rrggbb` escrito a mano. */
export const PALETAS_DE_MARCA = [
  { id: "azul", nombre: "Azul", hex: "#1f4e79" },
  { id: "verde", nombre: "Verde", hex: "#17562f" },
  { id: "bordo", nombre: "Bordó", hex: "#7a1f2b" },
  { id: "tostado", nombre: "Tostado", hex: "#6b3f1d" },
  { id: "negro", nombre: "Negro", hex: "#1b1f24" },
  { id: "violeta", nombre: "Violeta", hex: "#4b2e83" },
] as const;

export type EleccionDeMarca = "ninguna" | "otro" | (typeof PALETAS_DE_MARCA)[number]["id"];

/** El color de marca que sale de lo elegido en la pantalla: el de la paleta, lo escrito en «Otro color» o vacío (sin color de marca: el de la carta). Cualquier elección que no sea una de la lista da vacío (todo nace cerrado). */
export function marcaDeLaEleccion(eleccion: unknown, otro: unknown): string {
  if (eleccion === "otro") return typeof otro === "string" ? otro.trim() : "";
  return PALETAS_DE_MARCA.find((p) => p.id === eleccion)?.hex ?? "";
}

/** Al revés: qué opción de la pantalla corresponde a un color de marca ya guardado. Vacío es «ninguna»; el de una paleta, esa paleta; cualquier otro texto, «Otro color» con ese texto a la vista (para corregirlo, no para perderlo). */
export function eleccionDeLaMarca(marca: string): { eleccion: EleccionDeMarca; otro: string } {
  const texto = marca.trim();
  if (texto === "") return { eleccion: "ninguna", otro: "" };
  const paleta = PALETAS_DE_MARCA.find((p) => p.hex === texto.toLowerCase());
  return paleta ? { eleccion: paleta.id, otro: "" } : { eleccion: "otro", otro: texto };
}
