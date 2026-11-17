import Link from "next/link";
import { ARMADO_DE_PROMO_COMO_PEDERNAL, textosDeLaPantallaDePromos } from "@/core/carta/public";
import { formatearMonto } from "@/core/formato-de-numero";
import { claseDeBoton } from "@/ui/primitivas/boton";

/**
 * La lista de combos «como la maqueta» (`combos.html` de Pedernal), detrás de `ARMADO_DE_PROMO_COMO_PEDERNAL`: una fila por combo con el nombre en negrita, debajo en gris lo que lleva y si está activo o pausado, y el precio a la derecha; cada fila lleva a la ficha del combo.
 * Con permiso de definir promos, «Nuevo combo» al pie lleva a la ficha vacía. Sin acordeones y sin formularios: todo se hace en la ficha.
 */
export interface FilaDeLaListaDeCombos {
  id: string;
  titulo: string;
  /** Lo que lleva, en una línea («Hamburguesa Funghi + 1 de Bebidas»). */
  loQueLleva: string;
  activo: boolean;
  /** Lo que se cobra en esta sucursal. */
  precio: number;
}

export function ListaDeCombos({ filas, rutaDeLaFicha, puedeDefinir }: { filas: FilaDeLaListaDeCombos[]; rutaDeLaFicha: string; puedeDefinir: boolean }) {
  const t = textosDeLaPantallaDePromos(ARMADO_DE_PROMO_COMO_PEDERNAL);
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4" data-lista-de-combos>
      {filas.length === 0 ? (
        <p className="text-sm text-tinta-suave">{t.sinPromos}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-borde border-y border-borde">
          {filas.map((f) => (
            <li key={f.id} data-promo-carta={f.titulo}>
              <Link href={`${rutaDeLaFicha}/${f.id}`} className="flex min-h-16 items-start justify-between gap-3 px-1 py-2 hover:bg-superficie-suave" data-renglon-de-promo>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-semibold [overflow-wrap:anywhere]">{f.titulo}</span>
                  <span className="text-sm text-tinta-suave">
                    {f.loQueLleva} · {f.activo ? t.activo : t.pausado}
                  </span>
                </span>
                <span className="whitespace-nowrap font-semibold">{formatearMonto(f.precio)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {puedeDefinir && (
        <Link href={`${rutaDeLaFicha}/nuevo`} className={`${claseDeBoton("primario", "tactil")} w-full`}>
          {t.tituloDelAlta}
        </Link>
      )}
    </div>
  );
}
