"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { BotonConConfirmacion } from "@/components/boton-con-confirmacion";
import { CampoNumero } from "@/components/campo-numero";
import { SincronizarPrecioGrupo } from "@/components/carta/sincronizar-precio-grupo";
import { cambioDePrecio, type CambioDePrecio } from "@/core/catalogo/public";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import type { PrecioLocalDeProductoVisto } from "@/core/features/catalogo/precio-local.schema";
import { formatearMonto } from "@/core/pos/public";
import { setPrecioLocalProducto, sincronizarPrecioLocalGrupoCarta } from "@/server/actions/catalogo/precio-local";
import type { ResultadoConSincronizable, SincronizablePrecioGrupo } from "@/server/actions/tipos";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";

const porciento = (p: number) => `${p > 0 ? "+" : ""}${p.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;

/** «$ 18.000 → $ 22.000 (+22,2 %)»: el antes y el después de lo que se está por guardar (siempre se muestra, decisión del dueño). */
export function textoDelCambio(c: CambioDePrecio): string {
  return `${formatearMonto(c.antes)} → ${formatearMonto(c.despues)}${c.porcentaje === null ? "" : ` (${porciento(c.porcentaje)})`}`;
}

/**
 * El precio del producto en la sucursal ACTIVA, editable en el mismo paso 2 «Opciones y precio» (Fase 6, bloque 3: «el precio por sucursal se carga en el producto»). Es el MISMO comando de
 * siempre, `setPrecioLocalProducto` (clave `precio_local`, el valor visto como control de concurrencia, `PRECIO_DESACTUALIZADO`): acá no hay lógica de dinero nueva, solo otra pantalla.
 *  - Siempre se ve «antes → después» de lo que se va a guardar; si el precio cambia MÁS de 30 % (`cambioDePrecio`), guardar pide una confirmación aparte («Sí, guardar el precio»).
 *  - Si el producto tiene un precio local habilitado, «Volver al precio global» lo deshabilita (queda guardado, sin cobrarse): lo mismo que el interruptor de la lista de Precio local.
 *  - Si el producto está en un ítem agrupado de la carta cuyos hermanos quedaron a otro precio, la acción devuelve `sincronizable` y se ofrece igualarlos, como en Precio local.
 * La PÁGINA decide si se dibuja (Editar de `precio_local` en la sucursal activa y un producto que se cobra al precio propio: uno que se vende por opción tiene el precio de cada opción, y la acción rechaza
 * habilitarle un precio local con `ES_BASE_CONFIGURABLE`); la acción lo vuelve a exigir.
 */
export function PrecioDeLaSucursal({
  productoId,
  sucursalId,
  sucursalNombre,
  precioVigente,
  precioGlobal,
  guardado,
  capacidadActiva,
}: {
  productoId: string;
  sucursalId: string;
  sucursalNombre: string;
  /** Lo que se cobra HOY en la sucursal (el precio local habilitado o, si no, el global): el «antes» del cambio. */
  precioVigente: number;
  precioGlobal: number;
  /** La fila del precio local como estaba al cargar la página (habilitada o no), o `null` si no tiene: es lo que vio quien guarda. */
  guardado: PrecioLocalDeProductoVisto | null;
  /** La sucursal tiene prendido el precio propio; apagado, rige el global aunque haya uno guardado. */
  capacidadActiva: boolean;
}) {
  const router = useRouter();
  const idCampo = useId();
  const [texto, setTexto] = useState(String(precioVigente));
  const [resultado, setResultado] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [sincronizable, setSincronizable] = useState<SincronizablePrecioGrupo | null>(null);
  const [pending, startTransition] = useTransition();

  // Vacío (`undefined`) o un texto que no se entiende (`NaN`): no hay un precio que guardar.
  const leido = numeroDelCampo(texto);
  const valor = leido === undefined || Number.isNaN(leido) ? null : leido;
  const cambio = valor === null ? null : cambioDePrecio(precioVigente, valor);
  // Sin cambio de verdad (el mismo precio que ya se cobra): no hay nada que guardar, salvo volver a HABILITAR un precio local guardado deshabilitado (ahí se cobra el mismo importe, pero el producto pasa a tener precio propio).
  const sinCambio = cambio !== null && cambio.diferencia === 0 && !(guardado !== null && !guardado.habilitado);

  async function guardar(precio: number, habilitado: boolean): Promise<ResultadoConSincronizable> {
    const r = await setPrecioLocalProducto(productoId, precio, habilitado, guardado);
    setSincronizable(r.ok && habilitado ? (r.sincronizable ?? null) : null);
    if (r.ok) router.refresh();
    return r;
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-borde p-3" data-precio-editable-de-la-sucursal="">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valor === null || cambio === null || cambio.pideConfirmar || sinCambio) return;
          startTransition(async () => {
            const r = await guardar(valor, true);
            setResultado({ ok: r.ok, mensaje: r.mensaje });
          });
        }}
      >
        <label htmlFor={idCampo} className="text-sm font-medium">
          Precio en «{sucursalNombre}»
        </label>
        <div className="max-w-xs">
          <CampoNumero id={idCampo} value={texto} onChange={(t) => (setTexto(t), setResultado(null))} prefijo="$" tipo="importe" etiqueta="El precio" required />
        </div>
        {cambio !== null && !sinCambio ? (
          <p className="text-sm" aria-live="polite" data-cambio-de-precio="">
            Antes → después: {textoDelCambio(cambio)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {cambio?.pideConfirmar && valor !== null && !sinCambio ? (
            <BotonConConfirmacion
              etiqueta="Guardar el precio"
              aviso={`El precio cambia más de 30 %: ${textoDelCambio(cambio)}. ¿Lo guardás?`}
              etiquetaConfirmar="Sí, guardar el precio"
              etiquetaEnCurso="Guardando…"
              etiquetaVolver="Volver"
              accion={() => guardar(valor, true)}
              alSalirBien={() => undefined}
            />
          ) : (
            <Boton type="submit" variante="primario" cargando={pending} disabled={valor === null || sinCambio}>
              Guardar el precio
            </Boton>
          )}
          {guardado?.habilitado ? (
            <Boton
              type="button"
              variante="enlace"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await guardar(guardado.precio, false);
                  setResultado({ ok: r.ok, mensaje: r.mensaje });
                })
              }
            >
              Volver al precio global ({formatearMonto(precioGlobal)})
            </Boton>
          ) : null}
        </div>
      </form>
      {resultado ? (
        <Aviso variante={resultado.ok ? "exito" : "error"} forma="en-linea">
          {resultado.mensaje}
        </Aviso>
      ) : null}
      {guardado && !guardado.habilitado ? (
        <p className="text-xs text-tinta-suave">
          Hay un precio local guardado ({formatearMonto(guardado.precio)}) pero deshabilitado: rige el precio global ({formatearMonto(precioGlobal)}).
        </p>
      ) : null}
      {!capacidadActiva ? (
        <Aviso variante="advertencia" forma="en-linea">
          «{sucursalNombre}» no usa precio propio: rige el precio global aunque guardes uno acá.
        </Aviso>
      ) : null}
      {sincronizable ? (
        <SincronizarPrecioGrupo
          sincronizable={sincronizable}
          aplicar={async (hermanos, precioNuevo) => {
            const r = await sincronizarPrecioLocalGrupoCarta(
              sucursalId,
              hermanos.map((h) => h.productoId),
              precioNuevo,
              true,
              Object.fromEntries(hermanos.map((h) => [h.productoId, h.precioActual]))
            );
            if (r.ok) setResultado({ ok: true, mensaje: r.mensaje });
            return r;
          }}
          alTerminar={(aplicado) => {
            setSincronizable(null);
            if (aplicado) router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
