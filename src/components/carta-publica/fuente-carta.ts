import { Playfair_Display } from "next/font/google";

/** Serif de la carta (`--font-carta-serif`, la usa `.carta-shell font-serif`). Compartida por el layout público y por la vista previa del admin. */
export const fuenteCartaSerif = Playfair_Display({ variable: "--font-carta-serif", subsets: ["latin"] });
