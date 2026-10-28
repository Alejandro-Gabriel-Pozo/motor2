import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

/**
 * P1, paso 7 («el día en hora argentina», presentación): `Operacion.fecha`, `ConteoFisico.fecha` y el último movimiento son INSTANTES. Las pantallas mostraban su día con
 * `toISOString().slice(0, 10)` (el día en UTC): una operación de las 22:30 argentinas del 6/8 (01:30Z del 7/8) se veía como «2026-08-07». Ahora el día se lee en la zona: la de la empresa
 * en las páginas del servidor, la argentina en los componentes de cliente.
 *
 * Sin base: las tablas se dibujan sobre el HTML que arma el servidor (como `test/ui/tabla-y-fechas.test.tsx`) y las páginas se llaman con sus consultas y su gate reemplazados por datos fijos.
 * Qué se ve en un navegador real (con la zona del navegador distinta de la argentina): test/e2e/instantes-en-hora-argentina.spec.ts.
 */
const mocks = vi.hoisted(() => ({
  contexto: { usuarioId: "u-dia-ar", empresaId: "e1", empresaZonaHoraria: "America/Argentina/Buenos_Aires", sucursalId: "s1", membresias: [{ sucursalId: "s1" }], db: {} } as Record<string, unknown>,
  operacion: null as unknown,
  alertas: [] as unknown[],
  conteos: [] as unknown[],
  comparativa: [] as unknown[],
}));
// Los botones de cada fila del historial de conteos usan el router de Next, que fuera de una aplicación montada no existe.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("../../src/server/sesion/contexto", () => ({ obtenerContextoUsuario: vi.fn(async () => mocks.contexto) }));
vi.mock("../../src/server/acceso/gate", () => ({
  requierePermisoVer: vi.fn(async () => ({ ok: true })),
  requierePermisoVerDeEmpresa: vi.fn(async () => ({ ok: true })),
  obtenerMiNivelPermiso: vi.fn(async () => ({ ver: false, editar: false })),
}));
vi.mock("../../src/server/consultas/reportes/trazabilidad", () => ({
  obtenerOperacionPorId: vi.fn(async () => mocks.operacion),
  buscarOperacionesPorProducto: vi.fn(async () => []),
}));
vi.mock("../../src/server/actions/catalogo/proveedor-por-producto", () => ({ obtenerComparativaPreciosPorInsumo: vi.fn(async () => mocks.comparativa) }));
vi.mock("../../src/server/consultas/stock/alertas", () => ({ calcularAlertasStock: vi.fn(async () => mocks.alertas) }));
// La fila de pestañas de Existencias (DEC-27) es un componente de servidor asíncrono que `renderToStaticMarkup` no dibuja; acá se mira la tabla, no las pestañas (las prueba `stock-en-el-menu.test.ts`).
vi.mock("../../src/components/fila-de-stock", () => ({ FilaDeStock: () => null }));
vi.mock("../../src/server/actions/movimientos/secciones", () => ({ listarSeccionesActivas: vi.fn(async () => []) }));
vi.mock("../../src/server/actions/movimientos/lecturas-conteo-fisico", () => ({ obtenerHistorialConteosFisicos: vi.fn(async () => ({ items: mocks.conteos, nextCursor: null })) }));
vi.mock("../../src/server/consultas/movimientos/stock-para-conteo", () => ({ listarStockParaConteo: vi.fn(async () => []) }));

import TrazabilidadPage from "../../src/app/(app)/reportes/trazabilidad/page";
import AlertasStockPage from "../../src/app/(app)/stock/alertas/page";
import ComparativaPreciosPage from "../../src/app/(app)/catalogo/proveedores/comparativa/page";
import ConteoFisicoPage from "../../src/app/(app)/movimientos/conteo-fisico/page";
import { TablaOperacionesEncontradas } from "../../src/app/(app)/reportes/trazabilidad/tabla-trazabilidad";
import { TablaVentasSinReceta } from "../../src/app/(app)/reportes/sin-receta/tabla-sin-receta";
import { TablaMermas, TablaConsumoInterno } from "../../src/app/(app)/reportes/perdidas/tabla-perdidas";
import { TablaHistorialConteos } from "../../src/app/(app)/reportes/conteos/tabla-conteos";
import { TablaDiferenciasAjuste } from "../../src/app/(app)/reportes/diferencias/tabla-diferencias";
import type { FilaDiferenciaAjuste } from "../../src/core/reportes/public";

/** 22:30 argentinas del 6/8/2026: en UTC ya es 7/8. */
const NOCHE_ARGENTINA = new Date("2026-08-07T01:30:00Z");
const DIA_ARGENTINO = "2026-08-06";
const DIA_EN_UTC = "2026-08-07";

beforeEach(() => {
  mocks.contexto = { ...mocks.contexto, empresaZonaHoraria: "America/Argentina/Buenos_Aires" };
  mocks.operacion = null;
  mocks.alertas = [];
  mocks.conteos = [];
  mocks.comparativa = [];
});

function afirmarElDiaArgentino(html: string) {
  expect(html).toContain(DIA_ARGENTINO);
  expect(html, "el día en UTC es el del día siguiente: no se tiene que ver").not.toContain(DIA_EN_UTC);
}

describe("tablas de reportes (componentes de cliente): el día de una operación de las 22:30 argentinas es el argentino", () => {
  it("Trazabilidad: operaciones encontradas", () => {
    const html = renderToStaticMarkup(<TablaOperacionesEncontradas filas={[{ idOperacion: "op-1", fecha: NOCHE_ARGENTINA, proceso: "VENTA", seccionNombre: "Salón" }]} />);
    afirmarElDiaArgentino(html);
  });

  it("Ventas sin receta: primera y última fecha", () => {
    const html = renderToStaticMarkup(
      <TablaVentasSinReceta filas={[{ productoId: "p1", producto: "Pan", codigo: "PV_PAN", cantidadVentasSinReceta: 3, primeraFecha: NOCHE_ARGENTINA, ultimaFecha: new Date("2026-08-08T01:45:00Z") }]} />
    );
    expect(html).toContain("2026-08-06");
    expect(html).toContain("2026-08-07");
    expect(html).not.toContain("2026-08-08");
  });

  it("Pérdidas (mermas y consumo interno): la fecha de cada fila", () => {
    const fila = { idMovimiento: "m1", idOperacion: "op-1", fecha: NOCHE_ARGENTINA, motivo: "Rotura", producto: "Harina", productoId: "p1", cantidad: 2, valor: 100, sinPrecio: false };
    afirmarElDiaArgentino(renderToStaticMarkup(<TablaMermas filas={[fila]} />));
    afirmarElDiaArgentino(renderToStaticMarkup(<TablaConsumoInterno filas={[fila]} />));
  });

  it("Conteos: la fecha del conteo", () => {
    const html = renderToStaticMarkup(
      <TablaHistorialConteos
        filas={[
          {
            id: "c1",
            fecha: NOCHE_ARGENTINA,
            productoId: "p1",
            productoCodigo: "MP_HARINA",
            productoNombre: "Harina",
            seccionNombre: "Depósito",
            saldoSistema: 10,
            conteoReal: 9,
            diferencia: -1,
            accion: "AJUSTAR",
            estado: "RESUELTO",
          },
        ]}
      />
    );
    afirmarElDiaArgentino(html);
  });

  it("Diferencias de ajuste: último ajuste, último conteo y próximo conteo", () => {
    const fila: FilaDiferenciaAjuste = {
      productoId: "p1",
      producto: "Harina",
      codigo: "MP_HARINA",
      grupo: "a",
      grupoTexto: "Con receta",
      sumaAjustesManuales: -1,
      ultimaFechaAjuste: NOCHE_ARGENTINA,
      ultimaCantidadAjuste: -1,
      sumaConteosFisicos: 0,
      ultimaFechaConteo: new Date("2026-08-08T01:45:00Z"),
      ultimaCantidadConteo: 0,
      estado: "REVISAR",
      recetasQueLoUsan: [],
      sugerenciaMerma: null,
      proximaFechaConteo: new Date("2026-08-09T01:50:00Z"),
      conteoVencido: false,
    };
    const html = renderToStaticMarkup(<TablaDiferenciasAjuste filas={[fila]} />);
    expect(html).toContain("2026-08-06");
    expect(html).toContain("2026-08-07");
    expect(html).toContain("2026-08-08");
    expect(html).not.toContain("2026-08-09");
  });
});

describe("páginas del servidor: el día se lee en la zona de la empresa", () => {
  const datosDeOperacion = (fecha: Date, anuladaEn: Date | null = null) => ({
    idOperacion: "op-1",
    fecha,
    proceso: "VENTA",
    proveedorNombre: null,
    nroFactura: null,
    total: 1,
    items: [],
    anuladaEn,
    anuladaPorEmail: null,
  });
  const dibujarTrazabilidad = async () => renderToStaticMarkup((await TrazabilidadPage({ searchParams: Promise.resolve({ idOperacion: "op-1" }) })) as ReactNode as never);

  it("Trazabilidad: el encabezado de la operación y el «Anulada el» muestran el día argentino", async () => {
    mocks.operacion = datosDeOperacion(NOCHE_ARGENTINA, new Date("2026-08-08T01:45:00Z"));
    const html = await dibujarTrazabilidad();
    expect(html).toContain("op-1 — 2026-08-06 —");
    expect(html).toContain("Anulada el 2026-08-07");
  });

  it("Trazabilidad: con una empresa en otra zona, el día es el de ESA zona (no el argentino fijo)", async () => {
    // 04:00Z: en Argentina ya es el 7/8 (01:00), en México (UTC−6) todavía es el 6/8 (22:00).
    mocks.contexto = { ...mocks.contexto, empresaZonaHoraria: "America/Mexico_City" };
    mocks.operacion = datosDeOperacion(new Date("2026-08-07T04:00:00Z"));
    const html = await dibujarTrazabilidad();
    expect(html).toContain("op-1 — 2026-08-06 —");
  });

  it("Alertas de stock: el último movimiento", async () => {
    mocks.alertas = [
      {
        productoId: "p1",
        productoCodigo: "MP_HARINA",
        productoNombre: "Harina",
        seccionId: "s1",
        seccionNombre: "Depósito",
        saldoActual: 1,
        stockMinimo: 5,
        diferencia: -4,
        estado: "BAJO",
        ultimaFecha: NOCHE_ARGENTINA,
      },
    ];
    afirmarElDiaArgentino(renderToStaticMarkup((await AlertasStockPage()) as ReactNode as never));
  });

  it("Comparativa de precios: la fecha de la última compra (Operacion.fecha) en la zona de la empresa", async () => {
    const oferta = { proveedorNombre: "Molino SA", precioPorUnidadStock: 10, unidadCompraNombre: "Bolsa", ultimaCompra: NOCHE_ARGENTINA };
    mocks.comparativa = [{ insumo: "Harina", grupo: null, masBarato: oferta, todas: [oferta] }];
    const html = renderToStaticMarkup((await ComparativaPreciosPage()) as ReactNode as never);
    expect(html).toContain("06/08/2026");
    expect(html, "el día en UTC es el del día siguiente: no se tiene que ver").not.toContain("07/08/2026");
  });

  it("Conteo físico: la fecha de cada conteo del historial", async () => {
    mocks.conteos = [
      {
        id: "c1",
        fecha: NOCHE_ARGENTINA,
        producto: { nombre: "Harina" },
        seccion: { nombre: "Depósito" },
        saldoSistema: 10,
        conteoReal: 9,
        diferencia: -1,
        estado: "RESUELTO",
      },
    ];
    const html = renderToStaticMarkup((await ConteoFisicoPage({ searchParams: Promise.resolve({}) })) as ReactNode as never);
    afirmarElDiaArgentino(html);
  });
});
