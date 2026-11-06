import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/server/acceso/gate";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { listarComprasRegistradas } from "@/server/consultas/reportes/compras-registradas";
import { listarProveedoresParaSelector } from "@/server/actions/catalogo/proveedores";
import { formatearNumeroComprobante, leerNumeroComprobante } from "@/core/datos/numero-comprobante";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import { diaDeCalendario, esDiaISOReal, fechaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { CampoFecha } from "@/ui/componentes/selectores/campo-fecha";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";
import { Enlace } from "@/ui/primitivas/enlace";

const plata = (n: number) => `$${n.toLocaleString("es-AR")}`;

/**
 * «Corregir una factura de compra», PASO 1 de 2 — buscar la factura (mismo formato que «Corregir un ticket»): filtros en una fila (fecha, proveedor, letra, número) y los
 * resultados abajo; elegir una lleva a OTRA página (`/movimientos/corregir-compra/<compra>`). Lee las mismas compras que «Compras registradas» (etapa C0, docs/diseno-correccion-de-compras-2026-11-06.md).
 */
export default async function CorregirFacturaBuscar({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"desde" | "hasta" | "proveedorId" | "letra" | "numero">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario, antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;
  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "corregir_compra", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const { editar: puedeCorregir } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "corregir_compra", ctx.db);
  const sp = unicosDeUrl(await searchParams);
  const desde = esDiaISOReal(sp.desde) ? sp.desde : "";
  const hasta = esDiaISOReal(sp.hasta) ? sp.hasta : "";
  const letra = (sp.letra ?? "").trim().toUpperCase();
  const numero = (sp.numero ?? "").trim();
  const [{ items }, proveedores] = await Promise.all([
    listarComprasRegistradas(
      ctx.sucursalId,
      { desde: desde ? fechaDeColumnaDate(desde) : undefined, hasta: hasta ? fechaDeColumnaDate(hasta) : undefined, proveedorId: sp.proveedorId || undefined, factura: numero || undefined },
      ctx.db,
      ctx.empresaZonaHoraria
    ),
    listarProveedoresParaSelector(),
  ]);
  const resultados = items.filter((c) => !letra || (c.nroFactura ?? "").toUpperCase().startsWith(`${letra}-`));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Corregir una factura de compra</h1>
        <ol className="flex gap-4 text-sm" aria-label="Pasos">
          <li className="font-semibold">1. Buscar la factura</li>
          <li className="text-tinta-tenue">2. Corregirla</li>
        </ol>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded border p-3 text-sm" aria-label="Buscar factura">
        <CampoFecha etiqueta="Desde" name="desde" defaultValue={desde} />
        <CampoFecha etiqueta="Hasta" name="hasta" defaultValue={hasta} />
        <Selector etiqueta="Proveedor" name="proveedorId" defaultValue={sp.proveedorId ?? ""}>
          <option value="">Todos</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </Selector>
        <Selector etiqueta="Letra" name="letra" defaultValue={letra}>
          <option value="">Todas</option>
          {["A", "B", "C", "E", "M", "X"].map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Selector>
        <Campo etiqueta="N.º de factura" name="numero" defaultValue={numero} placeholder="contiene…" />
        <BotonDeServidor type="submit">Buscar</BotonDeServidor>
        <Enlace href="/movimientos/corregir-compra" className="self-center">
          Limpiar
        </Enlace>
      </form>

      <section aria-label="Resultados" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{resultados.length} factura(s) encontradas</h2>
        {resultados.length === 0 ? (
          <p className="text-sm text-tinta-tenue">No hay facturas con esos datos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-tinta-tenue">
                  <th className="px-2 py-1 font-normal">Fecha</th>
                  <th className="px-2 py-1 font-normal">Proveedor</th>
                  <th className="px-2 py-1 font-normal">N.º de factura</th>
                  <th className="px-2 py-1 font-normal">Renglones</th>
                  <th className="px-2 py-1 font-normal">Estado</th>
                  <th className="px-2 py-1 text-right font-normal">Total</th>
                  <th className="px-2 py-1 font-normal">
                    <span className="sr-only">Elegir</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {resultados.map((c) => {
                  const corregible = puedeCorregir && !c.anuladaEn && !c.facturaProveedorId;
                  return (
                    <tr key={c.idOperacion} className="border-b last:border-0" data-factura-resultado={c.nroFactura ?? "sin-numero"}>
                      <td className="px-2 py-2 tabular-nums text-tinta-tenue">{diaDeCalendario(c.fecha, ctx.empresaZonaHoraria)}</td>
                      <td className="px-2 py-2">{c.proveedorNombre ?? <span className="text-aviso-tinta">Sin proveedor</span>}</td>
                      <td className="px-2 py-2 text-tinta-tenue">{c.nroFactura ? formatearNumeroComprobante(leerNumeroComprobante(c.nroFactura)) : "sin N.º de factura"}</td>
                      <td className="px-2 py-2 text-tinta-tenue">{c.cantidadProductos} producto(s)</td>
                      <td className="px-2 py-2 text-tinta-tenue">{c.anuladaEn ? (c.reemplazadaPorId ? "Reemplazada por la versión corregida" : "Anulada") : c.reemplazaAId ? "Corregida" : c.facturaProveedorId ? "Parte de una factura repartida" : c.haySinPrecio ? "Hay renglones sin precio" : "Vigente"}</td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">{c.haySinPrecio && c.total === 0 ? "pendiente de completar" : plata(c.total)}</td>
                      <td className="px-2 py-2 text-right">
                        {corregible ? (
                          <Link href={`/movimientos/corregir-compra/${c.idOperacion}`} className="whitespace-nowrap underline">
                            Corregir →
                          </Link>
                        ) : (
                          <span className="whitespace-nowrap text-tinta-tenue">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
