import { ARMADO_DE_PROMO_COMO_PEDERNAL, textosDeLaPantallaDePromos } from "@/core/carta/public";
import { formatearMonto } from "@/core/formato-de-numero";
import { Aviso } from "@/ui/primitivas/aviso";
import { TEXTO_DEL_REPARTO, TEXTO_NO_SE_REPARTE, TEXTO_SIN_PRODUCTOS, repartoDelPrecioDeLaPromo, type ParteParaRepartir } from "@/core/pos/public";

/**
 * Las dos tarjetas de lectura de la ficha de un combo «como la maqueta» (`combos.html` de Pedernal): «Cómo lo ve el cliente» (el nombre y el precio en negrita y, en gris, lo que lleva) y «Reparto del precio» (cada producto con la parte del precio
 * de ESTA sucursal que le toca y, en gris, su precio de lista). Solo lectura: no escriben nada. Sin componentes no se dibujan.
 */
export function ComoLoVeElCliente({ titulo, precio, loQueLleva }: { titulo: string; precio: number; loQueLleva: string }) {
  const t = textosDeLaPantallaDePromos(ARMADO_DE_PROMO_COMO_PEDERNAL);
  return (
    <section aria-labelledby="titulo-como-lo-ve" className="flex flex-col gap-2 rounded-lg border border-borde p-4" data-como-lo-ve-el-cliente>
      <h2 id="titulo-como-lo-ve" className="text-base font-semibold">
        {t.comoLoVeElCliente}
      </h2>
      <p className="font-semibold">
        {titulo} {formatearMonto(precio)}
      </p>
      <p className="text-sm text-tinta-suave">{loQueLleva}</p>
    </section>
  );
}

export function RepartoDelPrecio({ precio, partes }: { precio: number; partes: readonly ParteParaRepartir[] }) {
  if (!partes.length) return null;
  const reparto = repartoDelPrecioDeLaPromo(precio, partes);
  const t = textosDeLaPantallaDePromos(ARMADO_DE_PROMO_COMO_PEDERNAL);
  return (
    <section aria-labelledby="titulo-reparto" className="flex flex-col gap-2 rounded-lg border border-borde p-4" data-reparto-del-precio>
      <h2 id="titulo-reparto" className="text-base font-semibold">
        {t.repartoDelPrecio}
      </h2>
      {reparto.tipo === "sin-productos" ? (
        <p className="text-sm text-tinta-suave">{TEXTO_SIN_PRODUCTOS}</p>
      ) : reparto.tipo === "incompleto" ? (
        <p className="text-sm text-tinta-suave" data-reparto-incompleto>
          {TEXTO_NO_SE_REPARTE}: {reparto.sinProducto.join(", ")}.
        </p>
      ) : reparto.tipo === "error" ? (
        <Aviso variante="error" forma="en-linea">
          {reparto.mensaje}
        </Aviso>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-borde">
            {reparto.filas.map((f, i) => (
              <li key={`${i}-${f.parte}`} className="flex flex-col gap-1 py-2 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-semibold">
                    {f.producto}
                    {f.cantidad > 1 ? ` × ${f.cantidad}` : ""}
                  </span>
                  <span className="whitespace-nowrap font-semibold">{formatearMonto(f.reparto)}</span>
                </div>
                <span className="text-sm text-tinta-suave">Lista {formatearMonto(f.lista)}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-tinta-suave">{TEXTO_DEL_REPARTO}</p>
        </>
      )}
    </section>
  );
}
