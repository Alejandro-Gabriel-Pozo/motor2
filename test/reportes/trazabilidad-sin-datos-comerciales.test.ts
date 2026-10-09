import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarCompraDeKardex, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { DIA_MS, enElPasado } from "../setup/tiempo";
import TrazabilidadPage from "../../src/app/(app)/reportes/trazabilidad/page";
import { obtenerOperacionPorId } from "../../src/server/consultas/reportes/trazabilidad";

/**
 * S-14 (plan de endurecimiento de seguridad, tanda T7; B-A4 del informe B). «Trazabilidad por ID» (`reporte_trazabilidad`, piso operario) mostraba, de una COMPRA, el proveedor, el
 * N.º de factura y el email de quien la anuló: justo lo que «Historial de un producto» le saca a quien no tiene `reporte_historial_importes` (piso administrador; ver
 * `quitarDineroDeEventos`). Mismo dato por dos puertas con pisos distintos: se alinea el piso de la puerta más baja con el de la más alta. Se decide en la CONSULTA, que además
 * dejó de traer la fila entera del proveedor (CUIT, correo, condiciones de pago) y del usuario: `obtenerOperacionPorId` niega por defecto y la página pide los datos comerciales
 * solo con `reporte_historial_importes`.
 */
describe("S-14: Trazabilidad no muestra proveedor, factura ni quién anuló sin reporte_historial_importes", () => {
  const FACTURA = "A-0001-00004321";
  const PROVEEDOR = "Frigorífico Reservado SA";
  const CUIT = "30-71234567-8";
  let sucursalId: string;
  let adminId: string;
  let encargadoId: string;
  let operacionId: string;

  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });

  /** Todos los textos y números que el árbol de la página lleva en sus props y sus hijos (lo que se dibuja y lo que viaja a los componentes de cliente). */
  function textosDe(nodo: unknown, salida: string[] = []): string[] {
    if (nodo === null || nodo === undefined || typeof nodo === "boolean" || typeof nodo === "function") return salida;
    if (typeof nodo === "string" || typeof nodo === "number") {
      salida.push(String(nodo));
      return salida;
    }
    if (Array.isArray(nodo)) {
      nodo.forEach((n) => textosDe(n, salida));
      return salida;
    }
    if (typeof nodo === "object") {
      if (nodo instanceof Date) return salida;
      const props = "props" in nodo ? (nodo as ReactElement<Record<string, unknown>>).props : (nodo as Record<string, unknown>);
      for (const valor of Object.values(props)) textosDe(valor, salida);
    }
    return salida;
  }

  const pagina = async () => textosDe(await TrazabilidadPage({ searchParams: Promise.resolve({ idOperacion: operacionId }) })).join(" | ");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    const seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    // El rol «operador» de fábrica no ve Trazabilidad: se le da (piso operario) para tener un rol que ve el reporte y NO tiene reporte_historial_importes (piso administrador).
    await prisma.permisoRol.updateMany({ where: { rolId: base.operador.id, accionClave: "reporte_trazabilidad" }, data: { puedeVer: true, puedeEditar: true } });
    encargadoId = (await crearUsuarioConMembresia({ email: "encargado@test.com", sucursalId, rolId: base.operador.id })).id;
    const harina = await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id }, sucursalId);
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PROV_F", nombre: PROVEEDOR, cuit: CUIT, email: "ventas@frigorifico.test", condicionesPago: "30 dias" } });
    const compra = await sembrarCompraDeKardex({
      sucursalId,
      seccionId,
      usuarioId: adminId,
      productoId: harina.id,
      proveedorId: proveedor.id,
      fecha: enElPasado(3 * DIA_MS).toISOString(),
      precioPorUnidadStock: 100,
      anulada: true,
    });
    await prisma.operacion.update({ where: { id: compra.id }, data: { nroFactura: FACTURA } });
    operacionId = compra.id;
    await como(encargadoId, "encargado@test.com");
  });

  describe("la pantalla", () => {
    it("EL ATAQUE: un rol con reporte_trazabilidad y sin reporte_historial_importes no recibe proveedor, factura ni el email de quien anuló (antes: los tres)", async () => {
      const textos = await pagina();
      expect(textos).toContain("Harina"); // lo que Trazabilidad es: qué se movió, cuánto y dónde
      expect(textos).not.toContain(PROVEEDOR);
      expect(textos).not.toContain(FACTURA);
      expect(textos).not.toContain("admin@test.com");
    });

    it("sigue diciendo que la operación está anulada y cuándo (el estado no es el dato comercial)", async () => {
      const textos = await pagina();
      expect(textos).toContain("Anulada el");
    });

    it("control: el administrador (que tiene reporte_historial_importes) lo ve completo", async () => {
      await como(adminId, "admin@test.com");
      const textos = await pagina();
      expect(textos).toContain(PROVEEDOR);
      expect(textos).toContain(FACTURA);
      expect(textos).toContain("admin@test.com");
    });
  });

  describe("la consulta niega por defecto", () => {
    it("sin pedir los datos comerciales devuelve la operación sin proveedor, factura ni email, y sin ninguna fila entera de proveedor o de usuario", async () => {
      const datos = await obtenerOperacionPorId(sucursalId, operacionId, prisma);
      expect(datos).toMatchObject({ idOperacion: operacionId, proveedorNombre: null, nroFactura: null, anuladaPorEmail: null });
      expect(datos?.anuladaEn).not.toBeNull();
      expect(datos?.items).toHaveLength(1);
      const serializado = JSON.stringify(datos);
      for (const secreto of [PROVEEDOR, FACTURA, CUIT, "admin@test.com", "frigorifico.test"]) expect(serializado).not.toContain(secreto);
    });

    it("con conDatosComerciales: true devuelve proveedor, factura y email", async () => {
      const datos = await obtenerOperacionPorId(sucursalId, operacionId, prisma, { conDatosComerciales: true });
      expect(datos).toMatchObject({ proveedorNombre: PROVEEDOR, nroFactura: FACTURA, anuladaPorEmail: "admin@test.com" });
    });
  });
});
