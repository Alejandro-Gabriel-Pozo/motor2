"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { textoDe } from "@/core/textos/texto-de";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Insignia } from "@/ui/primitivas/insignia";

type Alcance = "LOCAL" | "EMPRESA";

/**
 * La tarjeta «Ocultar» de la ficha del producto (docs/diseno-ocultar-como-pedernal-2026-11-15.md, etapa d; Pedernal A15): una fila por alcance —la sucursal con la que se trabaja y toda la empresa— con el aviso si está
 * oculto y UN botón que pide el estado contrario («Ocultar» o «Volver a mostrar»). No tiene título propio: la nombra su `aria-label`. Todo texto sale del catálogo (`textoDe`).
 *
 * Cortesía, no barrera: `puedeEnElLocal` y `puedeEnLaEmpresa` los calcula la página, y el servidor vuelve a decidir cada pedido. La fila de la empresa se ofrece solo a quien puede (el operador no la ve como acción; si la empresa
 * oculta el producto, ve el aviso). Una sucursal no puede mostrar lo que la empresa oculta: sin botón en la fila del local mientras la empresa lo oculta. Doble clic: mientras hay un pedido en curso el botón no manda otro
 * (`cargando`) y, aunque llegara, el servidor fija un estado (la segunda llamada es «ya estaba»).
 */
export function TarjetaOcultar({
  sucursalNombre,
  ocultoEnLaSucursal,
  ocultoEnLaEmpresa,
  puedeEnElLocal,
  puedeEnLaEmpresa,
  accion,
}: {
  sucursalNombre: string;
  ocultoEnLaSucursal: boolean;
  ocultoEnLaEmpresa: boolean;
  puedeEnElLocal: boolean;
  puedeEnLaEmpresa: boolean;
  /** La Server Action ya con el producto cerrado: `ocultarProducto.bind(null, productoId)`. */
  accion: (alcance: Alcance, oculto: boolean) => Promise<ResultadoAccion>;
}) {
  const router = useRouter();
  const [enCurso, empezar] = useTransition();
  const [pedido, setPedido] = useState<Alcance | null>(null);
  const [resultado, setResultado] = useState<{ alcance: Alcance; r: ResultadoAccion } | null>(null);

  function pedir(alcance: Alcance, oculto: boolean) {
    if (enCurso) return;
    setResultado(null);
    setPedido(alcance);
    empezar(async () => {
      const r = await accion(alcance, oculto);
      setResultado({ alcance, r });
      // Una Server Action que no vuelve a renderizar la página dejaría el aviso viejo: se refresca para leer el estado nuevo.
      router.refresh();
    });
  }

  const hayFilaDelLocal = puedeEnElLocal || ocultoEnLaSucursal;
  const hayFilaDeLaEmpresa = puedeEnLaEmpresa || ocultoEnLaEmpresa;
  if (!hayFilaDelLocal && !hayFilaDeLaEmpresa) return null;
  const error = resultado && !resultado.r.ok ? resultado : null;

  return (
    <section aria-label={textoDe("accion.ocultar")} data-tarjeta-ocultar="">
      <ul className="flex flex-col gap-3 rounded border border-borde p-4 text-sm">
        {hayFilaDelLocal && (
          <li className="flex flex-wrap items-center gap-3" data-fila-ocultar="local">
            <span className="font-medium">{sucursalNombre}</span>
            {ocultoEnLaSucursal && <Insignia tono="aviso">{textoDe("aviso.oculto")}</Insignia>}
            {puedeEnElLocal && !ocultoEnLaEmpresa && (
              <Boton variante="secundario" tamano="tactil" cargando={enCurso && pedido === "LOCAL"} onClick={() => pedir("LOCAL", !ocultoEnLaSucursal)}>
                {ocultoEnLaSucursal ? textoDe("accion.volver_a_mostrar") : textoDe("accion.ocultar")}
              </Boton>
            )}
            {error?.alcance === "LOCAL" && (
              <Aviso variante="error" forma="en-linea">
                {error.r.mensaje}
              </Aviso>
            )}
          </li>
        )}
        {hayFilaDeLaEmpresa && (
          <li className="flex flex-wrap items-center gap-3" data-fila-ocultar="empresa">
            {ocultoEnLaEmpresa && <Insignia tono="aviso">{textoDe("aviso.oculto_en_la_empresa")}</Insignia>}
            {puedeEnLaEmpresa && (
              <Boton variante="secundario" tamano="tactil" cargando={enCurso && pedido === "EMPRESA"} onClick={() => pedir("EMPRESA", !ocultoEnLaEmpresa)}>
                {ocultoEnLaEmpresa ? textoDe("accion.volver_a_mostrar") : textoDe("accion.ocultar_en_la_empresa")}
              </Boton>
            )}
            {error?.alcance === "EMPRESA" && (
              <Aviso variante="error" forma="en-linea">
                {error.r.mensaje}
              </Aviso>
            )}
          </li>
        )}
      </ul>
    </section>
  );
}
