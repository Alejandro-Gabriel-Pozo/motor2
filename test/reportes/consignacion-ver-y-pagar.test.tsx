import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// El botón «Registrar pago» es un componente de cliente: fuera de Next no hay router. Esta prueba mide lo que la PÁGINA real le pasa a la tabla y lo que la tabla DIBUJA.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { registrarPagoConsignante } from "../../src/server/actions/reportes/consignacion";
import ConsignacionPage from "../../src/app/(app)/reportes/consignacion/page";
import { TablaDebidoConsignante } from "../../src/app/(app)/reportes/consignacion/tabla-consignacion";

/** Los props de cada `tipo` de componente que el árbol (ya armado por la página) lleva. */
function propsDe(arbol: ReactNode, tipo: unknown): Record<string, unknown>[] {
  const hallados: Record<string, unknown>[] = [];
  const recorrer = (nodo: ReactNode) => {
    if (Array.isArray(nodo)) return nodo.forEach(recorrer);
    if (!nodo || typeof nodo !== "object" || !("props" in nodo)) return;
    const el = nodo as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
    if (el.type === tipo) hallados.push(el.props);
    recorrer(el.props.children);
  };
  recorrer(arbol);
  return hallados;
}

/**
 * Fase 2b, D3 (decisión del dueño): en Consignación se separa VER de PAGAR con los NIVELES de la misma clave `pagar_consignante`, sin clave nueva. Con «Ver» se ve el reporte
 * (lo que se le debe a cada consignante); el botón «Registrar pago» lo recibe solo quien tiene «Editar»; y la acción, llamada directo, sigue exigiendo «Editar» en el servidor.
 *
 * `pagar_consignante` tiene piso administrador: solo la alcanza el rol de sistema `admin` (un rol creado a mano no llega al piso, ni para ver). Por eso «Ver sin Editar» se arma
 * bajándole al rol administrador la fila de la clave a solo «Ver», como lo haría la matriz de permisos.
 */
describe("Consignación: ver el reporte no es poder pagar", () => {
  let sucursalId: string;
  let consignanteId: string;
  let adminId: string;
  let rolAdminId: string;

  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const pagina = async () => ConsignacionPage({ searchParams: Promise.resolve({}) });
  const propsDeLaTabla = async () => propsDe(await pagina(), TablaDebidoConsignante)[0] as { filas: { proveedorId: string | null; importe: number }[]; puedePagar: boolean } | undefined;
  const dibujo = (props: Record<string, unknown>) => renderToStaticMarkup(<TablaDebidoConsignante {...(props as Parameters<typeof TablaDebidoConsignante>[0])} />);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    const seccionId = (await sembrarSeccion(sucursalId)).id;
    rolAdminId = base.admin.id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: rolAdminId })).id;

    // Un consignante con deuda: 3 unidades vendidas a $20 de consignación = $60 (mismo armado que test/reportes/consignacion.test.ts).
    await como(adminId, "admin@test.com");
    consignanteId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Vinos del Valle" } })).id;
    const mp = await sembrarProductoDisponible(
      { codigo: "MP_VINO", nombre: "Vino en consignación", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id, esConsignacion: true, proveedorConsignacionId: consignanteId, precioConsignacion: 20 },
      sucursalId
    );
    const pv = await sembrarProductoDisponible({ codigo: "PV_COPA", nombre: "Copa de vino", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 50 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: catalogo.kg.id }] } } });
    expect((await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, proveedorId: consignanteId, items: [{ productoId: mp.id, cantidad: 10 }] })).ok).toBe(true);
    expect((await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 3 }] })).ok).toBe(true);
  });

  /** El rol administrador con `pagar_consignante` solo en «Ver». */
  const soloVer = async () => {
    const { count } = await prisma.permisoRol.updateMany({ where: { rolId: rolAdminId, accionClave: "pagar_consignante" }, data: { puedeVer: true, puedeEditar: false } });
    expect(count, "control: el rol administrador tiene la fila de pagar_consignante").toBe(1);
  };

  it("con «Editar» (administrador): la página le pasa puedePagar=true y la tabla dibuja «Registrar pago»", async () => {
    const props = await propsDeLaTabla();
    expect(props?.filas.find((f) => f.proveedorId === consignanteId)?.importe).toBe(60);
    expect(props?.puedePagar).toBe(true);
    expect(dibujo(props!)).toContain("Registrar pago");
  });

  it("con «Ver» sin «Editar»: ve el reporte (la deuda), la página le pasa puedePagar=false y la tabla NO dibuja «Registrar pago»", async () => {
    await soloVer();
    const props = await propsDeLaTabla();
    expect(props, "con «Ver» la página muestra el reporte").toBeDefined();
    expect(props!.filas.find((f) => f.proveedorId === consignanteId)?.importe).toBe(60);
    expect(props!.puedePagar).toBe(false);
    const html = dibujo(props!);
    expect(html).toContain("Vinos del Valle");
    expect(html).not.toContain("Registrar pago");
  });

  it("con «Ver» sin «Editar»: la acción llamada directo se rechaza en el servidor y no escribe ni pago ni auditoría", async () => {
    await soloVer();
    const resultado = await registrarPagoConsignante(consignanteId, 10, new Date(), undefined, crypto.randomUUID());
    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje, "lo rechaza el permiso, no otra validación").toMatch(/permiso/i);
    expect(await prisma.pagoConsignante.count()).toBe(0);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "PagoConsignante" } })).toBe(0);
  });
});
