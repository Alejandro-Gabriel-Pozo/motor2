import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { FilaDeStock } from "@/components/fila-de-stock";
import { PESTANAS_DE_EXISTENCIAS } from "@/core/stock/public";
import type { AccionClave } from "@/core/permisos/acciones";
import { ESTADO_STOCK_CONSOLIDADO_LABEL as ESTADO_LABEL, ESTADO_STOCK_CONSOLIDADO_COLOR as ESTADO_COLOR } from "@/core/stock/public";
import { calcularStockConsolidado } from "@/server/consultas/stock/consolidado";
import { calcularStockEnTransito } from "@/server/consultas/stock/en-transito";

const VER_STOCK: ReadonlySet<AccionClave> = new Set<AccionClave>(["ver_stock"]);

export default async function StockConsolidadoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_stock", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const [filas, enTransito] = await Promise.all([calcularStockConsolidado(ctx.sucursalId, ctx.db), calcularStockEnTransito(ctx.sucursalId, ctx.db)]);

  return (
    <div>
      <h1 className="mb-3 text-xl font-semibold">Existencias · Consolidado</h1>
      {/* DEC-27: las tres pestañas de Existencias se ven con ver_stock, que la guarda de arriba ya aprobó. */}
      <div className="mb-4">
        <FilaDeStock ctx={ctx} etiqueta="Qué existencias ver" pestanas={PESTANAS_DE_EXISTENCIAS} ruta="/stock/consolidado" visibles={VER_STOCK} />
      </div>
      <p className="mb-4 text-sm text-tinta-tenue">
        Teórico (libro mayor) vs. último conteo físico. &quot;Diferencia&quot; es la del último conteo — se congela ahí, no se recalcula contra el teórico de hoy.
      </p>
      {enTransito.length > 0 && (
        <section aria-labelledby="stock-en-transito" className="mb-6 rounded border border-aviso bg-aviso-tinte p-3 text-sm text-aviso-tinta">
          <h2 id="stock-en-transito" className="font-medium">
            Stock en tránsito entre sucursales
          </h2>
          <p className="mb-2">
            Esta mercadería ya salió de una sucursal y todavía no entró en otra: no suma en el &quot;Teórico&quot; de ninguna, pero no se perdió.
          </p>
          <table className="w-full">
            <thead>
              <tr className="border-b border-aviso text-left">
                <th className="py-1">Producto</th>
                <th>Por recibir (pendiente de aceptar acá)</th>
                <th>Enviado (el destino todavía no aceptó)</th>
                <th>Rechazado por el destino (pendiente de reingresar)</th>
              </tr>
            </thead>
            <tbody>
              {enTransito.map((f) => (
                <tr key={f.productoId} className="border-b border-aviso/40">
                  <td className="py-1">
                    {f.productoCodigo} — {f.productoNombre}
                  </td>
                  <td>{f.porRecibir ? `${f.porRecibir} ${f.unidadStockNombre}` : "—"}</td>
                  <td>{f.enviadoPorAceptar ? `${f.enviadoPorAceptar} ${f.unidadStockNombre}` : "—"}</td>
                  <td>{f.pendienteDeReingreso ? `${f.pendienteDeReingreso} ${f.unidadStockNombre}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-tinta-tenue">
            <th className="py-2">Producto</th>
            <th>Insumo</th>
            <th>Sección</th>
            <th>Lote</th>
            <th>Teórico</th>
            <th>Último físico</th>
            <th>Diferencia</th>
            <th>Entradas/Salidas desde conteo</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={`${f.productoId}-${f.seccionId ?? "none"}-${f.loteVencimiento}-${i}`} className="border-b">
              <td className="py-2">{f.productoCodigo} — {f.productoNombre}</td>
              <td>{f.insumoNombre ?? "—"}</td>
              <td>{f.seccionNombre || "—"}</td>
              <td>{f.loteVencimiento || "—"}</td>
              <td>{f.teorico} {f.unidadStockNombre}</td>
              <td>{f.ultimoFisico ?? "—"}</td>
              <td>{f.diferencia !== null ? (f.diferencia > 0 ? `+${f.diferencia}` : f.diferencia) : "—"}</td>
              <td>
                {f.entradasDesdeConteo > 0 && <span className="text-ok-tinta">+{f.entradasDesdeConteo}</span>}
                {f.entradasDesdeConteo > 0 && f.salidasDesdeConteo > 0 && " / "}
                {f.salidasDesdeConteo > 0 && <span className="text-error">−{f.salidasDesdeConteo}</span>}
                {!f.entradasDesdeConteo && !f.salidasDesdeConteo && "—"}
              </td>
              <td className={ESTADO_COLOR[f.estado]}>{ESTADO_LABEL[f.estado]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!filas.length && <p className="text-sm text-tinta-tenue">No hay productos elegibles (MP, o PV &quot;Se produce&quot;) todavía.</p>}
    </div>
  );
}
