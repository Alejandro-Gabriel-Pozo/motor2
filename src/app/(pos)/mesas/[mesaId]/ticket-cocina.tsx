import type { DocumentoImprimible } from "@/core/pos/impresion";
import { formatearCantidad, formatearFechaHora } from "./formato";

type DocumentoDeCocina = Extract<DocumentoImprimible, { comanda: unknown }>;

const ENCABEZADO: Record<DocumentoDeCocina["tipo"], string> = {
  comanda: "COMANDA · COCINA",
  reimpresion: "REIMPRESIÓN",
  anulacion: "ANULACIÓN · NO PREPARAR",
};

/**
 * La comanda de cocina impresa (docs/plan-imprimir-comanda-y-boleta-2026-09-25.md, B1): solo presentación. SIN PRECIOS — los datos
 * (`ComandaDeEnvio`) no los tienen. La hora es la de impresión (la del envío no se guarda). Estilos de papel en src/app/globals.css.
 */
export function TicketCocina({ documento, mesa, impresoEn }: { documento: DocumentoDeCocina; mesa: string; impresoEn: Date }) {
  const { comanda } = documento;
  return (
    <div className="ticket">
      <p className="ticket-encabezado">{ENCABEZADO[documento.tipo]}</p>
      <p className="ticket-titulo">{mesa}</p>
      <p className="ticket-dato">
        Envío {comanda.numero} · {formatearFechaHora(impresoEn)}
      </p>

      {documento.tipo === "anulacion" ? (
        <>
          <p className="ticket-dato">Anuló: {documento.anulacion.por}</p>
          <p className="ticket-item ticket-separador">
            {formatearCantidad(documento.anulacion.cantidad)} × {documento.anulacion.producto}
          </p>
          <p className="ticket-dato">Motivo: {documento.anulacion.motivo}</p>
          <p className="ticket-item">Quedan: {formatearCantidad(documento.anulacion.quedan)}</p>
        </>
      ) : (
        <>
          <p className="ticket-dato">Tomó: {comanda.tomo.join(", ")}</p>
          <ul className="ticket-separador">
            {comanda.lineas.map((l) => (
              <li key={l.itemId} className="ticket-item">
                {formatearCantidad(l.cantidad)} × {l.producto}
              </li>
            ))}
          </ul>
          {comanda.anulaciones.length > 0 && (
            <div className="ticket-separador">
              <p className="ticket-dato">Anulado</p>
              <ul>
                {comanda.anulaciones.map((a) => (
                  <li key={a.id} className="ticket-dato">
                    {formatearCantidad(a.cantidad)} × {a.producto} · {a.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
