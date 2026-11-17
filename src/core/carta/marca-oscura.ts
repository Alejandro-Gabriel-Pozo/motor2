import { razonDeContraste } from "./color-css";
import { DEFAULTS_DEL_LIBRO_MAQUETA } from "./libro-estilo-maqueta";
import { aHex, canalesDeMarcaHex, tintaSobreMarca, type Canales } from "./marca-derivada";

/**
 * La marca sobre el fondo OSCURO del sistema (PASO A de «Apariencia y publicación», `docs/diseno-carta-apariencia-y-publicacion-como-pedernal-2026-11-17.md`, §2.0 y §5 I2; dueño, 2026-11-17: «1. Oscura.» y
 * «2.- si como pedernal»). El color de marca que elige la empresa se GUARDA tal cual; AL MOSTRAR, si no llega a `CONTRASTE_MINIMO_DE_LA_CARTA` (7:1) contra el fondo, se ajusta su luminosidad conservando el tono y la
 * saturación (nunca se guarda otro color que el elegido) y la pantalla avisa cuál se usa. Pura: sin Prisma ni React; la importan el resolvedor del estilo y el editor (la vista previa y el aviso).
 */

/** El contraste mínimo de lo que la carta muestra con la marca derivada (WCAG AAA para texto normal): una sola constante, la del diseño (I2). */
const CONTRASTE_MINIMO_DE_LA_CARTA = 7;

/** El marcador de `marca_derivada` que escribe la pantalla simple: la carta se lee con la marca elegida sobre el fondo oscuro del sistema. Distinto de «si» (fondo claro, ya cargado por algunas empresas): «lo cargado manda». */
export const MARCADOR_DE_MARCA_OSCURA = "oscura";

/** El fondo oscuro del sistema: el mismo de la maqueta de Pedernal (`#19191a`) (`DEFAULTS_DEL_LIBRO_MAQUETA.color_fondo_dia`). Solo se usa cuando la empresa no cargó un fondo propio. */
export const FONDO_OSCURO_DEL_SISTEMA: string = DEFAULTS_DEL_LIBRO_MAQUETA.color_fondo_dia!;

export interface MarcaAjustada {
  /** La marca elegida, tal cual. */
  elegida: string;
  /** La marca que se USA al mostrar: la elegida si ya llega, si no la misma con la luminosidad corregida. */
  usada: string;
  /** `true` si la usada no es la elegida (la pantalla avisa). */
  ajustada: boolean;
}

/** HSL (h en grados, s y l de 0 a 1) a canales 0 a 255. */
function canalesDeHsl(h: number, s: number, l: number): Canales {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Canales 0 a 255 a HSL (h en grados, s y l de 0 a 1). */
function hslDeCanales(canales: Canales): { h: number; s: number; l: number } {
  const [r, g, b] = canales.map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

const BLANCO: Canales = [255, 255, 255];
const NEGRO: Canales = [0, 0, 0];
const PASOS = 200;

/** ¿La marca cumple las dos cosas que se le piden? Contra el fondo, a 7:1; y el texto que va SOBRE ella (la tinta más legible de las dos fijas), también a 7:1. */
function cumple(marca: Canales, fondo: Canales): boolean {
  return razonDeContraste([...marca], [...fondo]) >= CONTRASTE_MINIMO_DE_LA_CARTA && tintaSobreMarca(marca).contraste >= CONTRASTE_MINIMO_DE_LA_CARTA;
}

/**
 * La marca que se usa al mostrar sobre ese fondo. `marca` es un `#rrggbb` ya validado (M1) y `fondo` también; con algo que no se pueda leer devuelve null (la carta usa el color del sistema, falla cerrado).
 * Si la marca ya cumple, se usa tal cual. Si no, se mueve la luminosidad en pasos de 0,5 % hacia el lado que más contraste da contra el fondo (más clara sobre un fondo oscuro, más oscura sobre uno claro), sin tocar el
 * tono ni la saturación, hasta el primer punto que cumple; si no hay ninguno (un fondo de tono medio) queda en el extremo, el más legible posible.
 */
export function ajustarMarcaSobreFondo(marca: string, fondo: string): MarcaAjustada | null {
  const canalesMarca = canalesDeMarcaHex(marca);
  const canalesFondo = canalesDeMarcaHex(fondo);
  if (!canalesMarca || !canalesFondo) return null;
  if (cumple(canalesMarca, canalesFondo)) return { elegida: marca, usada: marca, ajustada: false };

  const haciaLoClaro = razonDeContraste([...BLANCO], [...canalesFondo]) >= razonDeContraste([...NEGRO], [...canalesFondo]);
  const { h, s, l } = hslDeCanales(canalesMarca);
  let mejor = aHex(haciaLoClaro ? BLANCO : NEGRO);
  for (let paso = 1; paso <= PASOS; paso++) {
    const luz = haciaLoClaro ? Math.min(1, l + paso / PASOS) : Math.max(0, l - paso / PASOS);
    const candidata = aHex(canalesDeHsl(h, s, luz));
    const canales = canalesDeMarcaHex(candidata);
    if (canales && cumple(canales, canalesFondo)) {
      mejor = candidata;
      break;
    }
  }
  return { elegida: marca, usada: mejor, ajustada: mejor !== marca };
}

/**
 * Lo que dice el aviso del editor cuando la marca se ajustó: el contraste de la usada contra el fondo y hacia qué lado se movió. Con algo que no se pueda leer devuelve null.
 */
export function detalleDelAjuste(elegida: string, usada: string, fondo: string): { contraste: number; masClara: boolean } | null {
  const canalesElegida = canalesDeMarcaHex(elegida);
  const canalesUsada = canalesDeMarcaHex(usada);
  const canalesFondo = canalesDeMarcaHex(fondo);
  if (!canalesElegida || !canalesUsada || !canalesFondo) return null;
  const sobreNegro = (c: Canales) => razonDeContraste([...c], [...NEGRO]);
  return { contraste: razonDeContraste([...canalesUsada], [...canalesFondo]), masClara: sobreNegro(canalesUsada) > sobreNegro(canalesElegida) };
}
