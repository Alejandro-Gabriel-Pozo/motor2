import { type DocumentoImprimible, formatearCantidad } from "@/core/pos/public";
import { formatearFechaHora } from "@/core/tiempo/zona-horaria";

type DocumentoDeCocina = Extract<DocumentoImprimible, { comanda: unknown }>;

const ENCABEZADO: Record<DocumentoDeCocina["tipo"], string> = {
  comanda: "COMANDA · COCINA",
  reimpresion: "REIMPRESIÓN",
  anulacion: "ANULACIÓN · NO PREPARAR",
};

/**
 * La comanda de cocina impresa (docs/plan-imprimir-comanda-y-ticket-2026-09-25.md, B1): solo presentación. SIN PRECIOS — los datos
 * (`ComandaDeEnvio`) no los tienen. La hora es la de impresión (la del envío no se guarda). Estilos de papel en src/app/globals.css.
 *
 * Componente de una promo (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 10): `promoTitulo` anota "(Menú del día)" al
 * lado del ítem — la cocina lo prepara igual (es un PV real, con su propia receta), pero sabe que forma parte de un combo.
 *
 * GO-2d (ADR-030): un producto con opciones lleva su nombre compuesto («1 × Café solo chico», ya armado en `producto`) y, si hay, lo incluido debajo («nalga · puré de papa»); un adicional
 * va con sangría y «+» debajo del producto del que cuelga (la comanda ya los trae en ese orden y SIN precios: `armarComandas`).
 */
export function TicketCocina({ documento, mesa, impresoEn, zonaHoraria }: { documento: DocumentoDeCocina; mesa: string; impresoEn: Date; zonaHoraria: string }) {
  const { comanda } = documento;
  return (
    <div className="ticket">
      <p className="ticket-encabezado">{ENCABEZADO[documento.tipo]}</p>
      <p className="ticket-titulo">{mesa}</p>
      <p className="ticket-dato">
        Envío {comanda.numero} · {formatearFechaHora(impresoEn, zonaHoraria)}
      </p>

      {documento.tipo === "anulacion" ? (
        <>
          <p className="ticket-dato">Anuló: {documento.anulacion.por}</p>
          <p className="ticket-item ticket-separador">
            {documento.anulacion.esAdicional && "+ "}
            {formatearCantidad(documento.anulacion.cantidad)} × {documento.anulacion.producto}
            {documento.anulacion.promoTitulo && ` (${documento.anulacion.promoTitulo})`}
          </p>
          {documento.anulacion.detalle && <p className="ticket-dato">{documento.anulacion.detalle}</p>}
          <p className="ticket-dato">Motivo: {documento.anulacion.motivo}</p>
          <p className="ticket-item">Quedan: {formatearCantidad(documento.anulacion.quedan)}</p>
        </>
      ) : (
        <>
          <p className="ticket-dato">Tomó: {comanda.tomo.join(", ")}</p>
          <ul className="ticket-separador">
            {comanda.lineas.map((l) =>
              l.esAdicional ? (
                <li key={l.itemId} className="ticket-linea-indentada" data-adicional>
                  <p className="ticket-item">
                    + {formatearCantidad(l.cantidad)} × {l.producto}
                  </p>
                </li>
              ) : (
                <li key={l.itemId} className="ticket-item">
                  {formatearCantidad(l.cantidad)} × {l.producto}
                  {l.promoTitulo && ` (${l.promoTitulo})`}
                  {l.detalle && <span className="ticket-dato block">{l.detalle}</span>}
                </li>
              )
            )}
          </ul>
          {comanda.anulaciones.length > 0 && (
            <div className="ticket-separador">
              <p className="ticket-dato">Anulado</p>
              <ul>
                {comanda.anulaciones.map((a) => (
                  <li key={a.id} className="ticket-dato">
                    {a.esAdicional && "+ "}
                    {formatearCantidad(a.cantidad)} × {a.producto}
                    {a.detalle && ` (${a.detalle})`}
                    {a.promoTitulo && ` (${a.promoTitulo})`} · {a.motivo}
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
