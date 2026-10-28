import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVer } from "@/server/acceso/gate";
import { ACCION_POR_PROCESO, PROCESOS_DEL_SELECTOR, obtenerConfigProceso } from "@/core/movimientos/public";
import { listarProveedoresParaSelector } from "@/server/actions/catalogo/proveedores";
import { listarUnidadesActivas } from "@/server/actions/catalogo/unidades";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { listarMotivosMermaActivos, listarDestinosConsumoActivos } from "@/server/actions/movimientos/motivos";
import { obtenerProductoOpcion } from "@/server/consultas/catalogo/productos";
import { seccionesDesactivadas } from "@/server/consultas/movimientos/secciones-desactivadas";
import { FilaDeMovimientos } from "@/components/fila-de-movimientos";
import { listarOtrasSucursalesParaReparto, listarPropuestasEnviadas, listarPropuestasParaAceptar } from "@/server/consultas/movimientos/facturas-proveedor";
import { ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { PanelMovimientoForm } from "./panel-movimiento-form";
import { BandejaParaAceptar } from "./bandeja-para-aceptar";
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
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const accionClave = ACCION_POR_PROCESO[config.proceso];
  if (!accionClave) notFound();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, accionClave, ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

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

  // E3a (ADR-041): en Compra, la bandeja «Para aceptar» (lo que otra sucursal compró para esta: productos y cantidades, sin importes), «Lo que cargué» (estado de las partes propuestas a otras) y, para quien
  // puede repartir (`compra_repartir`), el interruptor «Repartir entre sucursales».
  const esCompra = config.proceso === "COMPRA";
  const [paraAceptar, enviadas, otrasSucursales, nivelReparto] = esCompra
    ? await Promise.all([
        listarPropuestasParaAceptar(ctx.sucursalId, ctx.db),
        listarPropuestasEnviadas(ctx.sucursalId, ctx.db),
        listarOtrasSucursalesParaReparto(ctx.sucursalId, ctx.db),
        obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "compra_repartir", ctx.db),
      ])
    : [[], [], [], { ver: false, editar: false }];
  const dia = (f: Date) => diaDeCalendario(f, ZONA_ARGENTINA);
  const hoy = dia(new Date());
  const diasEntre = (desde: string, hasta: string) => Math.max(0, Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000));

  // Un proceso del selector lleva el título «Registrar movimiento · {etiqueta}» y la fila para pasar a otro; Merma y Compra (directos) no: su título es el del proceso y no hay fila.
  const delSelector = PROCESOS_DEL_SELECTOR.find((p) => p.href === `/movimientos/${slug}`);

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{delSelector ? `Registrar movimiento · ${delSelector.etiquetaCorta}` : config.titulo}</h1>
      {delSelector && <FilaDeMovimientos ctx={ctx} actual={delSelector.href} />}
      {esCompra && (
        <BandejaParaAceptar
          secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))}
          propuestas={paraAceptar.map((p) => ({
            id: p.id,
            proveedorNombre: p.proveedorNombre,
            nroFactura: p.nroFactura,
            diaFactura: dia(p.fechaFactura),
            origenNombre: p.origenNombre,
            antiguedadDias: diasEntre(dia(p.propuestaEn), hoy),
            renglones: p.renglones,
          }))}
        />
      )}
      <div className="max-w-2xl">
        <PanelMovimientoForm
          config={config}
          secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))}
          seccionesDesactivadas={desactivadas}
          proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.nombre }))}
          unidades={unidades.map((u) => ({ id: u.id, nombre: u.nombre }))}
          motivos={motivos.map((m) => ({ id: m.id, nombre: m.nombre }))}
          destinos={destinos.map((d) => ({ id: d.id, nombre: d.nombre }))}
          productoInicial={productoInicial ? { id: productoInicial.id, etiqueta: `${productoInicial.codigo} — ${productoInicial.nombre}` } : undefined}
          reparto={esCompra && nivelReparto.editar && otrasSucursales.length ? { sucursalActiva: { id: ctx.sucursalId, nombre: ctx.sucursalNombre }, otras: otrasSucursales } : undefined}
        />
      </div>
      {esCompra && enviadas.length > 0 && (
        <section className="flex max-w-2xl flex-col gap-2" aria-labelledby="titulo-lo-que-cargue">
          <h2 id="titulo-lo-que-cargue" className="text-lg font-semibold">
            Partes propuestas a otras sucursales
          </h2>
          <ul className="flex flex-col gap-1 text-sm" data-testid="propuestas-enviadas">
            {enviadas.map((p) => (
              <li key={p.id}>
                {p.proveedorNombre}
                {p.nroFactura ? ` · Factura ${p.nroFactura}` : ""} → «{p.destinoNombre}»:{" "}
                {p.estado === "ACEPTADA" ? `aceptada el ${dia(p.aceptadaEn as Date)}` : p.estado === "ANULADA" ? "anulada (la factura se anuló)" : `pendiente desde el ${dia(p.propuestaEn)}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
