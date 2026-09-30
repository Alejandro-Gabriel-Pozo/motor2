import { Cormorant_Garamond, Lora, Montserrat, Playfair_Display } from "next/font/google";

// Las familias de `carta_fuente_familia` (`FAMILIAS_TIPOGRAFICAS`, `src/core/carta/tema.ts`). Playfair es el default y se precarga; las
// alternativas no (`preload: false`): el navegador baja su archivo solo si la sucursal la elige, porque solo entonces algún texto la usa.
// Geist, la cuarta alternativa, ya la carga el layout raíz (`--font-geist-sans`).
const playfair = Playfair_Display({ variable: "--font-carta-serif", subsets: ["latin"], display: "swap" });
const lora = Lora({ variable: "--font-carta-lora", subsets: ["latin"], display: "swap", preload: false });
const cormorant = Cormorant_Garamond({ variable: "--font-carta-cormorant", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap", preload: false });
const montserrat = Montserrat({ variable: "--font-carta-montserrat", subsets: ["latin"], display: "swap", preload: false });

/** Clases que declaran las variables de todas las fuentes de la carta: el layout público y las vistas previas del admin las ponen junto a `carta-shell`. */
export const clasesFuentesCarta = [playfair, lora, cormorant, montserrat].map((f) => f.variable).join(" ");
