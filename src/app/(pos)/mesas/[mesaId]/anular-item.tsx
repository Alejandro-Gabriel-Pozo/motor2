"use client";

import { useId, useState } from "react";
import { anularItemEnviado } from "@/server/actions/pos/cuenta-anulacion";
import { CampoNumero } from "@/components/campo-numero";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { AreaDeTexto } from "@/ui/primitivas/area-de-texto";
import { Boton } from "@/ui/primitivas/boton";
import { formatearCantidad } from "@/core/pos/public";
import { useImpresion } from "./imprimir";
import { useAccionMesa } from "./usar-accion";

/**
 * «Anular» un ítem que YA SALIÓ a cocina: diálogo con la cantidad (por defecto, todo lo que queda) y el motivo, obligatorio. Manda
 * además lo que quedaba al abrir el diálogo (`restanteVisto`): si otro lo anuló mientras tanto, el servidor rechaza en vez de anular
 * sobre un número viejo. El motivo no lleva `required` nativo a propósito: el que valida es el servidor, y su mensaje se muestra acá
 * (`role="alert"`). Sin `pos_anular_item`, el botón queda deshabilitado.
 *
 * La cantidad usa `CampoNumero` (nunca `Number(...)` a secas): antes un `<input>` crudo aceptaba notación científica en silencio
 * ("1e3" → 1000) sin marcar el campo como inválido. `CampoNumero` interpreta con `interpretarNumeroTecleado` y lo lee con `numeroDelCampo`
 * (src/core/datos/numero-tecleado.ts) y deja el campo `aria-invalid` con el mensaje nativo del navegador ante un formato que no
 * es un número — el servidor (`validarCantidadPedido`) sigue siendo quien valida decimales/paso de venta/rango.
 *
 * Al salir bien pide imprimir el aviso para cocina («ANULACIÓN · NO PREPARAR»): la anulación nueva del ítem, la que no estaba entre
 * las que tenía al confirmar (docs/plan-imprimir-comanda-y-ticket-2026-09-25.md, B4). Quitar un ítem SIN enviar no imprime nada.
 *
 * GO-2d: con `conAdicionales`, el diálogo avisa que se anulan también sus adicionales (lo hace el servidor, `anularItemEnviado`).
 */
export function AnularItem({ item, puede, conAdicionales = false }: { item: { id: string; productoNombre: string; restante: number }; puede: boolean; conAdicionales?: boolean }) {
  const { ejecutar, pending, error, setError } = useAccionMesa();
  const { pedir, anulacionesDe } = useImpresion();
  const [abierto, setAbierto] = useState(false);
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [restanteVisto, setRestanteVisto] = useState(item.restante);
  const base = useId();

  const abrir = () => {
    // Canónico (punto decimal, nunca coma): lo que CampoNumero espera como `value` controlado — ver textoCanonico.
    setCantidad(String(item.restante));
    setMotivo("");
    setRestanteVisto(item.restante);
    setError(null);
    setAbierto(true);
  };
  const cerrar = () => {
    if (!pending) setAbierto(false);
  };
  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    // numeroDelCampo: vacío → undefined, texto inválido (ej. notación científica) → NaN — el servidor lo rechaza, nunca un 0 encubierto.
    const n = numeroDelCampo(cantidad) ?? Number.NaN;
    const espejosAntes = anulacionesDe(item.id);
    ejecutar(
      () => anularItemEnviado(item.id, n, motivo, restanteVisto),
      () => {
        setAbierto(false);
        pedir({ tipo: "anulacion", itemId: item.id, espejosAntes });
      }
    );
  };

  return (
    <>
      <Boton
        variante="secundario"
        tamano="compacto"
        className="min-w-11"
        disabled={!puede}
        title={puede ? undefined : "Anular algo que ya salió a cocina requiere un permiso que tu rol no tiene."}
        aria-label={`Anular ${item.productoNombre}`}
        onClick={abrir}
      >
        Anular
      </Boton>

      <Dialogo abierto={abierto} titulo={`Anular «${item.productoNombre}»`} onCerrar={cerrar} cerrable={!pending}>
        <p className="mb-4 text-sm text-tinta-suave">Ya salió a cocina: queda registrado quién lo anuló y por qué. Quedan {formatearCantidad(item.restante)}.</p>
        {/* GO-2d: un producto con adicionales los arrastra (el servidor los anula en la misma proporción). */}
        {conAdicionales && <p className="-mt-2 mb-4 text-sm font-medium">Se anulan también sus adicionales, en la misma proporción.</p>}
        <form onSubmit={enviar} className="flex flex-col gap-3">
          {/* CampoNumero no lleva su propia etiqueta: la pone este <label> de afuera. */}
          <label htmlFor={`${base}-cantidad`} className="text-sm font-medium">
            Cantidad a anular
          </label>
          <CampoNumero id={`${base}-cantidad`} value={cantidad} onChange={setCantidad} />
          <AreaDeTexto etiqueta="Motivo (obligatorio)" data-foco-inicial="" maxLength={200} aria-required="true" value={motivo} onChange={(e) => setMotivo(e.target.value)} error={error} />
          <div className="mt-1 flex justify-end gap-2">
            <Boton variante="secundario" onClick={cerrar}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" disabled={pending}>
              {pending ? "Anulando…" : "Anular"}
            </Boton>
          </div>
        </form>
      </Dialogo>
    </>
  );
}
