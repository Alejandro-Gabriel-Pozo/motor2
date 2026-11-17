import { TEXTO_DEL_REPARTO, TEXTO_DEL_REPARTO_CON_RANGO, TEXTO_SIN_PRODUCTOS, repartoDelPrecioDeLaPromo, textoDeLaFilaDelReparto, type ParteParaRepartir } from "@/core/carta/public";

/**
 * «Reparto del precio» de una promo (solo lectura; detrás de `ARMADO_DE_PROMO_COMO_PEDERNAL`, lo decide la página): la parte del precio de la promo en ESTA sucursal (`precio`) que le toca a cada
 * componente, con su precio de lista. No escribe nada. Sin componentes no se dibuja.
 */
export function RepartoDelPrecio({ precio, partes }: { precio: number; partes: readonly ParteParaRepartir[] }) {
  if (!partes.length) return null;
  const reparto = repartoDelPrecioDeLaPromo(precio, partes);
  return (
    <div className="mt-3 flex flex-col gap-1" data-reparto-del-precio>
      <h3 className="text-sm font-medium">Reparto del precio</h3>
      {reparto.tipo === "sin-productos" ? (
        <p className="text-sm text-tinta-tenue">{TEXTO_SIN_PRODUCTOS}</p>
      ) : reparto.tipo === "error" ? (
        <p className="text-sm text-error" role="alert">
          {reparto.mensaje}
        </p>
      ) : (
        <>
          <ul className="flex flex-col text-sm">
            {reparto.filas.map((f, i) => (
              <li key={`${i}-${f.parte}`}>{textoDeLaFilaDelReparto(f)}</li>
            ))}
            {reparto.sinProducto.map((n) => (
              <li key={n} className="text-tinta-tenue">
                {n}: sin producto disponible para el ejemplo (no entra en el reparto)
              </li>
            ))}
          </ul>
          <p className="text-xs text-tinta-tenue">
            {TEXTO_DEL_REPARTO}
            {reparto.usaMaximo ? ` ${TEXTO_DEL_REPARTO_CON_RANGO}` : ""}
          </p>
        </>
      )}
    </div>
  );
}
