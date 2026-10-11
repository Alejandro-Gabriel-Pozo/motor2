import localFont from "next/font/local";

// Las familias de `carta_fuente_familia` (`FAMILIAS_TIPOGRAFICAS`, `src/core/carta/tema.ts`). Playfair es el default y se precarga; las
// alternativas no (`preload: false`): el navegador baja su archivo solo si la sucursal la elige, porque solo entonces algún texto la usa.
// Geist, la cuarta alternativa, ya la carga el layout raíz (`--font-geist-sans`).
// Los archivos salen del repo (`src/fonts/`, licencias OFL junto a ellos), no de fonts.googleapis.com: el build no depende de la red de Google.
// Son los mismos woff2 variables, subconjunto latin, que bajaba el cargador de Google con `subsets: ["latin"]`. Cormorant es un único archivo variable (500–700).
// `adjustFontFallback` usa Times New Roman para las serifa (Playfair, Lora, Cormorant) y Arial para la sans (Montserrat), como antes.
// OJO con los nombres: `next/font/local` toma el nombre del `font-family` del identificador de la constante, y los e2e miran el `font-family` calculado
// (`/Playfair/`, `/Lora/`, `/Montserrat/`): por eso van capitalizados.
const Playfair = localFont({ src: [{ path: "../../fonts/PlayfairDisplay-latin.woff2", weight: "400 900", style: "normal" }], variable: "--font-carta-serif", display: "swap", adjustFontFallback: "Times New Roman" });
const Lora = localFont({ src: [{ path: "../../fonts/Lora-latin.woff2", weight: "400 700", style: "normal" }], variable: "--font-carta-lora", display: "swap", preload: false, adjustFontFallback: "Times New Roman" });
const Cormorant = localFont({ src: [{ path: "../../fonts/CormorantGaramond-latin.woff2", weight: "500 700", style: "normal" }], variable: "--font-carta-cormorant", display: "swap", preload: false, adjustFontFallback: "Times New Roman" });
const Montserrat = localFont({ src: [{ path: "../../fonts/Montserrat-latin.woff2", weight: "100 900", style: "normal" }], variable: "--font-carta-montserrat", display: "swap", preload: false, adjustFontFallback: "Arial" });

/** Clases que declaran las variables de todas las fuentes de la carta: el layout público y las vistas previas del admin las ponen junto a `carta-shell`. */
export const clasesFuentesCarta = [Playfair, Lora, Cormorant, Montserrat].map((f) => f.variable).join(" ");
