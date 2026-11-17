import { textosDeLaPantallaDePromos } from "@/core/carta/public";
import { Aviso } from "@/ui/primitivas/aviso";
import { TEXTO_DEL_REPARTO, TEXTO_NO_SE_REPARTE, TEXTO_SIN_PRODUCTOS, repartoDelPrecioDeLaPromo, textoDeLaFilaDelReparto, type ParteParaRepartir } from "@/core/pos/public";

/**
 * «Reparto del precio» de una promo (solo lectura; detrás de `ARMADO_DE_PROMO_COMO_PEDERNAL`, lo decide la página): la parte del precio de la promo en ESTA sucursal (`precio`) que le toca a cada
 * componente, con su precio de lista. No escribe nada. Sin componentes no se dibuja.
 */
export function RepartoDelPrecio({ precio, partes }: { precio: number; partes: readonly ParteParaRepartir[] }) {
  if (!partes.length) return null;
  const reparto = repartoDelPrecioDeLaPromo(precio, partes);
  // El reparto solo se dibuja con el armado «como Pedernal»: siempre con sus textos.
  const t = textosDeLaPantallaDePromos(true);
  return (
    <div className="mt-3 flex flex-col gap-2" data-reparto-del-precio>
      <h3 className="text-sm font-medium">Reparto del precio</h3>
      {reparto.tipo === "sin-productos" ? (
        <p className="text-sm text-tinta-tenue">{TEXTO_SIN_PRODUCTOS}</p>
      ) : reparto.tipo === "incompleto" ? (
        <p className="text-sm text-tinta-tenue" data-reparto-incompleto>
          {TEXTO_NO_SE_REPARTE}: {reparto.sinProducto.join(", ")}.
        </p>
      ) : reparto.tipo === "error" ? (
        <Aviso variante="error" forma="en-linea">
          {reparto.mensaje}
        </Aviso>
      ) : (
        <>
          <ul className="flex flex-col gap-1 text-sm">
            {reparto.filas.map((f, i) => (
              <li key={`${i}-${f.parte}`}>{textoDeLaFilaDelReparto(f)}</li>
            ))}
          </ul>
          <p className="text-xs text-tinta-tenue">
            {TEXTO_DEL_REPARTO}
            {reparto.usaMaximo && t.ayudaDelRepartoConRango !== null ? ` ${t.ayudaDelRepartoConRango}` : ""}
          </p>
        </>
      )}
    </div>
  );
}
