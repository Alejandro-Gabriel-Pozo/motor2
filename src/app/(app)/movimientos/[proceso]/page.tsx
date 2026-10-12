import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { ACCION_POR_PROCESO, obtenerConfigProceso } from "@/core/movimientos/public";
import { listarProveedoresParaSelector } from "@/server/actions/catalogo/proveedores";
import { listarUnidadesActivas } from "@/server/actions/catalogo/unidades";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { listarMotivosMermaActivos, listarDestinosConsumoActivos } from "@/server/actions/movimientos/motivos";
import { obtenerProductoOpcion } from "@/server/consultas/catalogo/productos";
import { seccionesDesactivadas } from "@/server/consultas/movimientos/secciones-desactivadas";
import { PanelMovimientoForm } from "./panel-movimiento-form";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

const PROCESOS_QUE_SACAN_DE_UNA_SECCION_DADA_DE_BAJA: ReadonlySet<string> = new Set(["CONSUMO", "MERMA", "TRANSFERENCIA"]);

export default async function MovimientoPage({
  params,
  searchParams,
}: {
  params: Promise<{ proceso: string }>;
  searchParams: Promise<ParametrosDeUrl<"productoId">>;
}) {
  const { proceso: slug } = await params;
  const config = obtenerConfigProceso(slug);
  if (!config) notFound();

  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const accionClave = ACCION_POR_PROCESO[config.proceso];
  if (!accionClave) notFound();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, accionClave, ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { productoId } = unicosDeUrl(await searchParams);

  const [secciones, desactivadas, proveedores, unidades, motivos, destinos, productoInicial] = await Promise.all([
    listarSeccionesActivas(ctx.sucursalId),
    // P17: una sección dada de baja solo admite SACAR mercadería: se ofrece como origen en los procesos que solo sacan (Merma, Consumo, Transferencia) y en ningún otro.
    PROCESOS_QUE_SACAN_DE_UNA_SECCION_DADA_DE_BAJA.has(config.proceso) ? seccionesDesactivadas(ctx.sucursalId, ctx.db) : Promise.resolve([]),
    config.requiereProveedor ? listarProveedoresParaSelector(true) : Promise.resolve([]),
    // Alta rápida de producto inline (solo Compra, ver QuickCrearProducto)
    // — no Devolución a proveedor pese a ser también `esCompraLike`: no
    // tiene sentido devolver algo que nunca se compró.
    config.proceso === "COMPRA" ? listarUnidadesActivas() : Promise.resolve([]),
    config.pideMotivo ? listarMotivosMermaActivos() : Promise.resolve([]),
    config.pideDestino ? listarDestinosConsumoActivos() : Promise.resolve([]),
    // Deep-link accionable desde un reporte (ej. "Costo incompleto" ->
    // "cargale precio a este insumo") — resuelto server-side así el form
    // cliente no tiene que pedirlo aparte.
    productoId ? obtenerProductoOpcion(productoId, ctx.db) : Promise.resolve(null),
  ]);

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">{config.titulo}</h1>
      <PanelMovimientoForm
        config={config}
        secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))}
        seccionesDesactivadas={desactivadas}
        proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.nombre }))}
        unidades={unidades.map((u) => ({ id: u.id, nombre: u.nombre }))}
        motivos={motivos.map((m) => ({ id: m.id, nombre: m.nombre }))}
        destinos={destinos.map((d) => ({ id: d.id, nombre: d.nombre }))}
        productoInicial={productoInicial ? { id: productoInicial.id, etiqueta: `${productoInicial.codigo} — ${productoInicial.nombre}` } : undefined}
      />
    </div>
  );
}
