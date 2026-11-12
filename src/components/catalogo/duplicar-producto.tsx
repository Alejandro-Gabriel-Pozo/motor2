"use client";

import { useEffect, useRef, useState } from "react";
import { CampoNumero } from "@/components/campo-numero";
import { FormConResultado } from "@/components/form-con-resultado";
import { LO_QUE_NO_SE_COPIA } from "@/core/catalogo/public";
import type { ResultadoAccion, ResultadoConId } from "@/server/actions/tipos";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Casilla } from "@/ui/primitivas/casilla";
import { Enlace } from "@/ui/primitivas/enlace";
import { Selector } from "@/ui/primitivas/selector";

/** Lo que la pantalla sabe del original y de quien mira (cortesía de la interfaz: el servidor vuelve a verificar cada permiso al duplicar). */
export interface PropsDeDuplicarProducto {
  origen: { id: string; nombre: string; esDeVenta: boolean; esBase: boolean; precioVenta: number };
  /** ¿El original tiene receta (central o propia de alguna sucursal)? */
  tieneReceta: boolean;
  /** Los grupos y opciones activos que admite, o `null` si no admite nada. */
  opciones: { grupos: number; opciones: number; conPrecio: number } | null;
  /** Quien mira puede copiar la receta (`guardar_receta`, con el módulo Recetas). */
  puedeCopiarReceta: boolean;
  /** Quien mira puede copiar las opciones (`producto_opciones_admitidas`). */
  puedeCopiarOpciones: boolean;
  /** Quien mira puede fijar el precio de lista (`producto_campos_sensibles`). */
  puedeFijarPrecio: boolean;
  /** Las sucursales de las que quien mira puede tomar la receta (S-07: membresía y «Ver» de `receta_sucursal_copiar`). La Central siempre se ofrece. */
  sucursalesDeLaReceta: readonly { id: string; nombre: string }[];
  /** La Server Action `duplicarProducto` (el cierre lo arma la página: acá solo se arma el pedido). */
  accion: (entrada: {
    duplicadoId: string;
    origenId: string;
    nombre: string;
    copiarReceta: boolean;
    copiarOpciones: boolean;
    sucursalDeLaRecetaId: string | null;
    precioVenta?: string;
  }) => Promise<ResultadoConId>;
}

const CENTRAL = "";

/** Un identificador al azar para el producto nuevo. `randomUUID` solo existe en un contexto seguro (https o localhost); sin él, 16 bytes al azar en hexadecimal (el servidor acepta de 16 a 64 letras, números, guiones y guiones bajos). */
function nuevoIdDeDuplicado(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  return Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * «Duplicar» de la ficha del producto (etapa E4 de `docs/diseno-duplicar-producto-2026-11-12.md`): un diálogo que crea un producto NUEVO a partir de este, con nombre propio OBLIGATORIO (vacío al abrir) y copia lo que se tilde — la
 * receta con su ficha técnica y las opciones vinculadas —, más el precio de lista como punto de partida editable. Antes de confirmar dice qué se copia y qué no.
 *
 * El id del producto nuevo (`duplicadoId`) se genera al abrir el diálogo: es la clave de idempotencia del servidor, así que un doble clic o un reintento caen sobre el mismo producto y no crean dos. `FormConResultado` además frena el
 * doble envío en la pantalla. Si el servidor rechaza, el mensaje queda DENTRO del diálogo, que sigue abierto con lo escrito; si sale bien, el diálogo dice qué se copió (incluido el aviso de pasos a revisar) y ofrece abrir el producto nuevo.
 *
 * Los permisos son cortesía de la pantalla: sin `producto_campos_sensibles` el precio no se edita y la pantalla dice que el producto nace en $0 y sin disponibilidad; sin `guardar_receta` o `producto_opciones_admitidas` la casilla
 * correspondiente se ve apagada con el motivo. La barrera es la del servidor.
 */
export function DuplicarProducto({ origen, tieneReceta, opciones, puedeCopiarReceta, puedeCopiarOpciones, puedeFijarPrecio, sucursalesDeLaReceta, accion }: PropsDeDuplicarProducto) {
  const [abierto, setAbierto] = useState(false);
  const [duplicadoId, setDuplicadoId] = useState("");
  const [creado, setCreado] = useState<{ id: string; nombre: string; mensaje: string } | null>(null);
  const puedeRecibirReceta = puedeCopiarReceta && tieneReceta;
  const [copiarReceta, setCopiarReceta] = useState(puedeRecibirReceta);
  const puedeRecibirOpciones = puedeCopiarOpciones && opciones !== null;
  const nombre = useRef<HTMLInputElement>(null);

  // Al abrir, el foco va al nombre (el diálogo nativo lo pondría en «Cerrar»). Corre después del efecto de `Dialogo` (el que llama a `showModal`), con el diálogo ya abierto.
  useEffect(() => {
    if (abierto) nombre.current?.focus();
  }, [abierto]);

  function abrir() {
    setDuplicadoId(nuevoIdDeDuplicado());
    setCreado(null);
    setCopiarReceta(puedeRecibirReceta);
    setAbierto(true);
  }

  async function duplicar(formData: FormData): Promise<ResultadoAccion> {
    const resultado = await accion({
      duplicadoId,
      origenId: origen.id,
      nombre: String(formData.get("nombre") ?? ""),
      copiarReceta: puedeRecibirReceta && formData.get("copiarReceta") === "on",
      copiarOpciones: puedeRecibirOpciones && (formData.get("copiarOpciones") === "on" || origen.esBase),
      sucursalDeLaRecetaId: puedeRecibirReceta && formData.get("copiarReceta") === "on" && formData.get("sucursalDeLaReceta") ? String(formData.get("sucursalDeLaReceta")) : null,
      ...(puedeFijarPrecio && origen.esDeVenta && !origen.esBase ? { precioVenta: String(formData.get("precioVenta") ?? "") } : {}),
    });
    if (resultado.ok) setCreado({ id: resultado.id, nombre: resultado.nombre, mensaje: resultado.mensaje });
    return resultado;
  }

  return (
    <div>
      <Boton variante="secundario" tamano="tactil" onClick={abrir} data-duplicar-producto>
        Duplicar
      </Boton>
      <Dialogo abierto={abierto} titulo={`Duplicar «${origen.nombre}»`} ancho="ancho" onCerrar={() => setAbierto(false)}>
        {creado ? (
          <div className="flex flex-col gap-4">
            <Aviso variante="exito">{creado.mensaje}</Aviso>
            <div className="flex flex-wrap justify-end gap-2">
              <Boton variante="secundario" tamano="tactil" onClick={() => setAbierto(false)}>
                Cerrar
              </Boton>
              <Enlace href={`/catalogo/productos/${creado.id}`} data-abrir-duplicado>
                Abrir «{creado.nombre}»
              </Enlace>
            </div>
          </div>
        ) : (
          <FormConResultado accion={duplicar} className="flex flex-col gap-4">
            <p className="text-sm text-tinta-suave">
              Crea un producto nuevo a partir de «{origen.nombre}». El nombre es obligatorio y propio; lo que copies queda independiente del original: cambiar uno después no cambia el otro.
            </p>
            <Campo ref={nombre} etiqueta="Nombre del producto nuevo" name="nombre" required defaultValue="" autoComplete="off" maxLength={120} />

            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm font-medium">Qué copiar</legend>
              <Casilla
                etiqueta="La receta y la ficha técnica"
                name="copiarReceta"
                checked={copiarReceta && puedeRecibirReceta}
                disabled={!puedeRecibirReceta}
                onChange={(e) => setCopiarReceta(e.target.checked)}
                ayuda={
                  !puedeCopiarReceta
                    ? "No tenés el permiso para copiar recetas."
                    : !tieneReceta
                      ? "El producto no tiene receta: no hay nada que copiar."
                      : "Ingredientes con sus sustitutos, pasos y ficha técnica, como versión 1 de la receta del producto nuevo."
                }
              />
              {copiarReceta && puedeRecibirReceta && sucursalesDeLaReceta.length > 1 ? (
                <Selector etiqueta="Sacar la receta de" name="sucursalDeLaReceta" defaultValue={CENTRAL} ayuda="Se copia la receta que rige en ese lugar: la propia de la sucursal si la tiene, y si no la central.">
                  <option value={CENTRAL}>Central (la receta de toda la empresa)</option>
                  {sucursalesDeLaReceta.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </Selector>
              ) : null}
              <Casilla
                etiqueta="Las opciones vinculadas"
                name="copiarOpciones"
                defaultChecked={puedeRecibirOpciones}
                disabled={!puedeRecibirOpciones || origen.esBase}
                ayuda={
                  !puedeCopiarOpciones
                    ? "No tenés el permiso para elegir las opciones de un producto."
                    : opciones === null
                      ? "El producto no admite opciones: no hay nada que copiar."
                      : origen.esBase
                        ? "Se vende por opción: sus opciones se copian siempre, porque en ellas está el precio."
                        : `${opciones.grupos} grupo${opciones.grupos === 1 ? "" : "s"} con ${opciones.opciones} opcion${opciones.opciones === 1 ? "" : "es"}${opciones.conPrecio > 0 ? `, ${opciones.conPrecio} con precio` : ""}. Son los mismos de la biblioteca de opciones, no copias: cambiar el nombre de una opción afecta a todos los productos que la usan.`
                }
              />
            </fieldset>

            {origen.esDeVenta ? (
              origen.esBase ? (
                <p className="text-sm text-tinta-suave">Se vende por opción: el precio final está en cada opción, y se copia con ellas.</p>
              ) : puedeFijarPrecio ? (
                <CampoNumero
                  name="precioVenta"
                  tipo="importe"
                  etiqueta="El precio de venta"
                  prefijo="$"
                  defaultValue={String(origen.precioVenta)}
                  ariaLabel="Precio de venta del producto nuevo"
                  ayuda={`Parte del precio de «${origen.nombre}»: cambialo si hace falta.`}
                />
              ) : (
                <Aviso variante="advertencia">
                  No tenés el permiso «campos sensibles del producto» (producto_campos_sensibles): el producto nuevo nace con precio $0 y sin disponibilidad para vender, hasta que alguien con ese permiso le cargue el precio y lo active.
                </Aviso>
              )
            ) : null}

            <section aria-labelledby="titulo-que-se-copia" className="rounded border border-borde p-3 text-sm">
              <h3 id="titulo-que-se-copia" className="mb-1 font-medium">
                Lo que se copia y lo que no
              </h3>
              <p>
                <span className="font-medium">Se copia:</span> los datos del producto (tipo, categoría, unidad de stock, cómo se vende, IVA, observaciones)
                {puedeRecibirReceta ? ", lo que tildaste de la receta" : ""}
                {puedeRecibirOpciones ? " y de las opciones" : ""}.
              </p>
              <p className="mt-1">
                <span className="font-medium">No se copia:</span> {LO_QUE_NO_SE_COPIA.join("; ")}.
              </p>
            </section>

            <div className="flex flex-wrap justify-end gap-2">
              <Boton variante="secundario" tamano="tactil" onClick={() => setAbierto(false)}>
                Cancelar
              </Boton>
              <Boton type="submit" tamano="tactil" data-confirmar-duplicar>
                Duplicar
              </Boton>
            </div>
          </FormConResultado>
        )}
      </Dialogo>
    </div>
  );
}
