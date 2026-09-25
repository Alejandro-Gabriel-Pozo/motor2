"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { documentoDeReimpresion, type ComandaDeEnvio } from "@/core/pos/comanda";
import { resolverImpresion, type DocumentoImprimible, type PedidoImpresion } from "@/core/pos/impresion";
import { BOTON_CHICO } from "./estilos";
import { TicketCocina } from "./ticket-cocina";

/**
 * Impresión de la pantalla de la mesa (docs/plan-imprimir-comanda-y-boleta-2026-09-25.md, B7/B9): UNA infraestructura para los
 * documentos que se imprimen desde acá (la comanda de cocina y, más adelante, la boleta del cliente), cada uno con su propio
 * componente de presentación.
 *
 * - Vive en la CIMA de la página (por encima de «mesa libre» y «cuenta abierta»): así sobrevive a que la acción que pidió imprimir
 *   haga desaparecer su botón después de `router.refresh()` (que conserva el estado de los componentes de cliente).
 * - Un único pedido pendiente (se imprime una cosa a la vez): la acción lo deja al salir bien (`pedir`) y `resolverImpresion` decide,
 *   con los datos que trajo el refresco, si imprime, si espera o si lo descarta.
 * - El documento se monta en un portal directo en `document.body`, con `data-imprimible` y `data-tipo`: en pantalla nunca se ve, y al
 *   imprimir es lo único que se ve (CSS en src/app/globals.css). Un efecto sobre su `id` anota UNA VEZ `afterprint` (lo desmonta) y
 *   llama a `window.print()`; una ref con el último id impreso evita la doble impresión del modo estricto de React en desarrollo.
 */

interface ApiImpresion {
  /** El mayor número de envío que se ve en pantalla (0 si todavía no hay ninguno). */
  ultimoEnvio: number;
  /** Ids de las anulaciones que el ítem tiene hoy. */
  anulacionesDe: (itemId: string) => string[];
  pedir: (pedido: PedidoImpresion) => void;
  reimprimirEnvio: (numero: number) => void;
}

const ImpresionContexto = createContext<ApiImpresion>({ ultimoEnvio: 0, anulacionesDe: () => [], pedir: () => {}, reimprimirEnvio: () => {} });

export function useImpresion() {
  return useContext(ImpresionContexto);
}

interface EnCurso {
  id: number;
  documento: DocumentoImprimible;
  impresoEn: Date;
}

export function ImpresionProvider({ mesa, comandas, children }: { mesa: string; comandas: ComandaDeEnvio[]; children: React.ReactNode }) {
  const [pedido, setPedido] = useState<PedidoImpresion | null>(null);
  const [enCurso, setEnCurso] = useState<EnCurso | null>(null);
  const [secuencia, setSecuencia] = useState(0);
  const ultimoImpreso = useRef<number | null>(null);

  const mostrar = (documento: DocumentoImprimible) => {
    setEnCurso({ id: secuencia + 1, documento, impresoEn: new Date() });
    setSecuencia(secuencia + 1);
  };

  // Con cada render (el refresco trae datos nuevos) se vuelve a mirar el pedido pendiente: el estado se ajusta durante el render, sin
  // efecto, igual que «guardar información de renders anteriores» (react.dev). Deja de ser pendiente en cuanto se imprime o se descarta.
  if (pedido) {
    const resolucion = resolverImpresion({ comandas }, pedido);
    if (resolucion.accion !== "esperar") {
      setPedido(null);
      if (resolucion.accion === "imprimir") mostrar(resolucion.documento);
    }
  }

  const id = enCurso?.id;
  useEffect(() => {
    if (id === undefined || ultimoImpreso.current === id) return;
    ultimoImpreso.current = id;
    window.addEventListener("afterprint", () => setEnCurso((actual) => (actual?.id === id ? null : actual)), { once: true });
    window.print();
  }, [id]);

  const api: ApiImpresion = {
    ultimoEnvio: comandas.reduce((mayor, c) => Math.max(mayor, c.numero), 0),
    anulacionesDe: (itemId) => comandas.flatMap((c) => c.anulaciones.filter((a) => a.itemId === itemId).map((a) => a.id)),
    pedir: setPedido,
    reimprimirEnvio: (numero) => {
      const documento = documentoDeReimpresion(comandas, numero);
      if (documento) mostrar(documento);
    },
  };

  return (
    <ImpresionContexto.Provider value={api}>
      {children}
      {enCurso &&
        createPortal(
          <div data-imprimible data-tipo={enCurso.documento.tipo}>
            <TicketCocina documento={enCurso.documento} mesa={mesa} impresoEn={enCurso.impresoEn} />
          </div>,
          document.body
        )}
    </ImpresionContexto.Provider>
  );
}

/**
 * «Reimprimir» la comanda de un envío (B3): no llama al servidor ni toca `numeroEnvio`, solo vuelve a imprimir lo que se ve. Sin
 * `pos_tomar_pedido` Editar queda deshabilitado (guarda de interfaz: no hay ninguna escritura que proteger).
 */
export function ReimprimirEnvio({ numero, puede }: { numero: number; puede: boolean }) {
  const { reimprimirEnvio } = useImpresion();
  return (
    <button
      type="button"
      className={BOTON_CHICO}
      disabled={!puede}
      title={puede ? undefined : "Reimprimir la comanda requiere el permiso de tomar pedidos, que tu rol no tiene."}
      aria-label={`Reimprimir la comanda del envío ${numero}`}
      onClick={() => reimprimirEnvio(numero)}
    >
      Reimprimir
    </button>
  );
}
