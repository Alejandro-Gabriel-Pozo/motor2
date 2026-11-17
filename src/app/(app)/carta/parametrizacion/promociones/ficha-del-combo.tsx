"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { CampoNumero } from "@/components/campo-numero";
import { formatearMonto } from "@/core/formato-de-numero";
import { ARMADO_DE_PROMO_COMO_PEDERNAL, textosDeLaPantallaDePromos } from "@/core/carta/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Aviso } from "@/ui/primitivas/aviso";
import { AreaDeTexto } from "@/ui/primitivas/area-de-texto";
import { Boton, claseDeBoton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";

/**
 * La ficha de un combo «como la maqueta» (`combos.html` de Pedernal), detrás de `ARMADO_DE_PROMO_COMO_PEDERNAL`. En este orden: cabecera (‹ y el nombre, o «Nuevo combo»), Nombre y Precio lado a lado, «Qué lleva», «Cómo lo ve el cliente», «Reparto del precio», el bloque
 * plegado «Más información» y el pie fijo con «Guardar». Lo que cambia con cada tarjeta (los componentes, las lecturas) llega ya armado desde la página como `componentes` y `lecturas`.
 *
 * «Guardar» manda Nombre, Precio, Sección de carta, Descripción y Orden con el MISMO comando de siempre (`guardarPromoCarta`, vía `guardar`): ni versiones ni comandos nuevos. Lo demás de «Más información» (solo salón, precio de esta sucursal, prender y apagar) sigue siendo cada uno
 * su propio formulario y su propio comando, que la página trae como `extra`. Sin permiso de definir promos no hay campos editables ni «Guardar». Un doble toque no manda dos veces; el servidor vuelve a validar todo.
 */
export interface DatosDeLaFicha {
  titulo: string;
  precio: string;
  seccionCartaId: string;
  descripcion: string;
  orden: string;
}

export function FichaDelCombo({
  nuevo,
  inicial,
  secciones,
  puedeDefinir,
  rutaDeLaLista,
  guardar,
  componentes,
  lecturas,
  extra,
}: {
  nuevo: boolean;
  inicial: DatosDeLaFicha;
  secciones: { id: string; nombre: string; activa: boolean }[];
  puedeDefinir: boolean;
  rutaDeLaLista: string;
  guardar: (datos: DatosDeLaFicha) => Promise<ResultadoAccion>;
  componentes: ReactNode;
  lecturas: ReactNode;
  extra: ReactNode;
}) {
  const t = textosDeLaPantallaDePromos(ARMADO_DE_PROMO_COMO_PEDERNAL);
  const [datos, setDatos] = useState<DatosDeLaFicha>(inicial);
  const [resultado, setResultado] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [pendiente, startTransition] = useTransition();
  const enviando = useRef(false);
  const cambiar = (cambio: Partial<DatosDeLaFicha>) => {
    setResultado(null);
    setDatos((antes) => ({ ...antes, ...cambio }));
  };
  const completo = datos.titulo.trim() !== "" && datos.precio.trim() !== "";
  const guardarLaFicha = () => {
    if (enviando.current || !completo) return;
    enviando.current = true;
    startTransition(async () => {
      try {
        const r = await guardar(datos);
        setResultado({ ok: r.ok, mensaje: r.mensaje });
      } finally {
        enviando.current = false;
      }
    });
  };
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6" data-ficha-del-combo={nuevo ? "nuevo" : inicial.titulo}>
      <header className="flex items-center gap-3">
        <Link href={rutaDeLaLista} aria-label="Volver" className={`${claseDeBoton("secundario", "tactil")} min-w-11`}>
          ‹
        </Link>
        <h2 className="text-lg font-semibold">{nuevo ? t.tituloDelAlta : inicial.titulo}</h2>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta={t.rotuloDelTitulo} value={datos.titulo} onChange={(e) => cambiar({ titulo: e.target.value })} disabled={!puedeDefinir} maxLength={120} />
        <div className="flex flex-col gap-1">
          <label htmlFor="ficha-precio" className="text-sm font-medium">
            {t.rotuloDelPrecio}
          </label>
          {puedeDefinir ? <CampoNumero id="ficha-precio" tipo="importe" etiqueta="El precio" value={datos.precio} onChange={(v) => cambiar({ precio: v })} /> : <p id="ficha-precio">{formatearMonto(Number(datos.precio))}</p>}
        </div>
      </div>

      {componentes}
      {lecturas}

      <details className="rounded-lg border border-borde p-4" data-mas-informacion>
        <summary className="cursor-pointer font-semibold max-md:min-h-11 max-md:py-2">{t.masInformacion}</summary>
        <div className="mt-3 flex flex-col gap-4">
          {puedeDefinir && (
            <>
              <Selector etiqueta={t.rotuloDeLaSeccionDeCarta} value={datos.seccionCartaId} onChange={(e) => cambiar({ seccionCartaId: e.target.value })}>
                {nuevo && <option value="">— elegí una —</option>}
                {secciones.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                    {s.activa ? "" : " (apagada)"}
                  </option>
                ))}
              </Selector>
              <AreaDeTexto etiqueta={t.rotuloDeLaDescripcion} rows={2} value={datos.descripcion} onChange={(e) => cambiar({ descripcion: e.target.value })} />
              <div className="flex flex-col gap-1">
                <label htmlFor="ficha-orden" className="text-sm font-medium">
                  {t.rotuloDelOrden}
                </label>
                <CampoNumero id="ficha-orden" tipo="entero" etiqueta="El orden" value={datos.orden} onChange={(v) => cambiar({ orden: v })} permitirNegativo />
              </div>
            </>
          )}
          {extra}
        </div>
      </details>

      {puedeDefinir && (
        <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-borde bg-superficie p-3" data-pie-de-la-ficha>
          {resultado && (
            <Aviso variante={resultado.ok ? "exito" : "error"} forma="en-linea">
              {resultado.mensaje}
            </Aviso>
          )}
          <Boton tamano="tactil" className="w-full" disabled={!completo} cargando={pendiente} onClick={guardarLaFicha}>
            {t.botonGuardarPromo}
          </Boton>
        </div>
      )}
    </div>
  );
}
