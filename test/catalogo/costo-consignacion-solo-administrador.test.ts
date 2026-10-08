import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarProducto, darDeAltaProducto, type DatosProducto } from "../../src/server/actions/catalogo/productos";
import FichaProductoPage from "../../src/app/(app)/catalogo/productos/[id]/page";
import EditarProductoPage from "../../src/app/(app)/catalogo/productos/[id]/editar/page";
import NuevoProductoPage from "../../src/app/(app)/catalogo/productos/nuevo/page";
import { ProductoForm } from "../../src/app/(app)/catalogo/productos/producto-form";

/**
 * S-12 (plan de endurecimiento de seguridad, tanda T2; B-A1 del informe B; decisión D8 del dueño). El costo de consignación (`precioConsignacion` y el proveedor de
 * consignación) es lo que la empresa le paga a su proveedor por cada unidad vendida: dinero de la relación con el proveedor. Lo veía y lo editaba cualquier rol con
 * `producto_ver_catalogo` o `producto_editar` (piso operario): la ficha lo imprimía ("$X por unidad vendida"), la edición lo mandaba como prop a un componente de cliente
 * (viaja en el payload de la respuesta), y `actualizarProducto` lo cambiaba. D8: ver y editar ese costo exige `pagar_consignante` (piso administrador) en la sucursal
 * activa, la pantalla donde ese precio se vuelve deuda. Se decide en el servidor: la consulta no lo devuelve, la pantalla no se lo arma al formulario, y la acción
 * trata «el campo no viene» como «no cambia» y «viene distinto» como `SIN_PERMISO_COSTO`. La misma regla en el alta (crear un producto en consignación es fijar su costo).
 */
describe("S-12: el costo de consignación es de quien tiene pagar_consignante", () => {
  const PRECIO = 1234.56;
  let sucursalId: string;
  let adminId: string;
  let operadorId: string;
  let kgId: string;
  let proveedorAId: string;
  let proveedorBId: string;
  let quesoId: string;

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
      const props = "props" in nodo ? (nodo as ReactElement<Record<string, unknown>>).props : (nodo as Record<string, unknown>);
      for (const valor of Object.values(props)) textosDe(valor, salida);
    }
    return salida;
  }

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

  async function datos(cambios: Partial<DatosProducto> = {}): Promise<DatosProducto> {
    const p = await prisma.producto.findUniqueOrThrow({ where: { id: quesoId } });
    return {
      nombre: p.nombre,
      tipo: p.tipo,
      unidadStockId: p.unidadStockId,
      factorConversion: Number(p.factorConversion),
      precioVenta: Number(p.precioVenta),
      esConsignacion: p.esConsignacion,
      proveedorConsignacionId: p.proveedorConsignacionId,
      precioConsignacion: Number(p.precioConsignacion ?? 0),
      ...cambios,
    };
  }
  const costoGuardado = async () => {
    const p = await prisma.producto.findUniqueOrThrow({ where: { id: quesoId } });
    return { esConsignacion: p.esConsignacion, proveedorConsignacionId: p.proveedorConsignacionId, precioConsignacion: Number(p.precioConsignacion) };
  };
  const CONSIGNACION_ORIGINAL = () => ({ esConsignacion: true, proveedorConsignacionId: proveedorAId, precioConsignacion: PRECIO });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
    proveedorAId = (await prisma.proveedor.create({ data: { codigo: "PROV_A", nombre: "Lácteos Reservados SA" } })).id;
    proveedorBId = (await prisma.proveedor.create({ data: { codigo: "PROV_B", nombre: "Otro Proveedor" } })).id;
    quesoId = (
      await sembrarProductoDisponible(
        { codigo: "MP_QUESO", nombre: "Queso", tipo: "MP", unidadStockId: kgId, esConsignacion: true, proveedorConsignacionId: proveedorAId, precioConsignacion: PRECIO },
        sucursalId,
      )
    ).id;
    await como(operadorId, "operador@test.com");
  });

  describe("la ficha del producto (solo lectura)", () => {
    const ficha = () => FichaProductoPage({ params: Promise.resolve({ id: quesoId }), searchParams: Promise.resolve({}) });

    it("EL ATAQUE: un rol con producto_ver_catalogo y sin pagar_consignante no recibe el importe ni el consignante (antes: «$1.234,56 por unidad vendida» y el nombre del proveedor)", async () => {
      const textos = textosDe(await ficha()).join(" | ");
      expect(textos).toContain("Queso");
      expect(textos).not.toContain("por unidad vendida");
      expect(textos).not.toMatch(/1\.?234/);
      expect(textos).not.toContain("Lácteos Reservados SA");
    });

    it("sigue diciendo que el producto es de consignación (el dato no es el costo)", async () => {
      expect(textosDe(await ficha())).toContain("Sí");
    });

    it("control: el administrador (que tiene pagar_consignante) lo ve completo", async () => {
      await como(adminId, "admin@test.com");
      const textos = textosDe(await ficha()).join(" | ");
      expect(textos).toContain("Lácteos Reservados SA");
      expect(textos).toContain("por unidad vendida");
    });
  });

  describe("el formulario de edición (los props viajan al navegador)", () => {
    const edicion = async () => propsDe(await EditarProductoPage({ params: Promise.resolve({ id: quesoId }) }), ProductoForm)[0]!;

    it("EL ATAQUE: sin pagar_consignante el formulario no recibe el precio ni el consignante (antes: ambos como prop del componente de cliente)", async () => {
      const props = await edicion();
      const serializado = JSON.stringify(props);
      expect(serializado).not.toMatch(/1234/);
      expect(serializado).not.toContain(proveedorAId);
      expect(serializado).not.toContain("Lácteos Reservados SA");
      expect(props.puedeGestionarConsignacion).toBe(false);
    });

    it("control: el administrador recibe el formulario completo", async () => {
      await como(adminId, "admin@test.com");
      const props = await edicion();
      expect(props.puedeGestionarConsignacion).toBe(true);
      expect((props.productoExistente as DatosProducto).precioConsignacion).toBe(PRECIO);
      expect((props.productoExistente as DatosProducto).proveedorConsignacionId).toBe(proveedorAId);
    });

    it("el formulario del alta tampoco ofrece la consignación sin la clave", async () => {
      const sin = propsDe(await NuevoProductoPage(), ProductoForm)[0]!;
      expect(sin.puedeGestionarConsignacion).toBe(false);
      expect(JSON.stringify(sin.proveedoresIniciales)).toBe("[]");
      await como(adminId, "admin@test.com");
      const con = propsDe(await NuevoProductoPage(), ProductoForm)[0]!;
      expect(con.puedeGestionarConsignacion).toBe(true);
    });
  });

  describe("actualizarProducto (la barrera es del servidor, no de la pantalla)", () => {
    it("EL ATAQUE: el operador manda un precio de consignación distinto → SIN_PERMISO_COSTO y nada cambia", async () => {
      const r = await actualizarProducto(quesoId, await datos({ precioConsignacion: 1 }));
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("consignación");
      expect(await costoGuardado()).toEqual(CONSIGNACION_ORIGINAL());
    });

    it("el operador tampoco cambia el consignante ni el «es consignación»", async () => {
      expect((await actualizarProducto(quesoId, await datos({ proveedorConsignacionId: proveedorBId }))).ok).toBe(false);
      expect((await actualizarProducto(quesoId, await datos({ esConsignacion: false, proveedorConsignacionId: null }))).ok).toBe(false);
      expect(await costoGuardado()).toEqual(CONSIGNACION_ORIGINAL());
      expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "Producto", entidadId: quesoId } })).toBe(0);
    });

    it("«el campo no viene» es «no cambia»: el operador edita el nombre sin mandar la consignación y el costo queda como estaba", async () => {
      const { esConsignacion, proveedorConsignacionId, precioConsignacion, ...sinConsignacion } = await datos({ nombre: "Queso cremoso" });
      void esConsignacion;
      void proveedorConsignacionId;
      void precioConsignacion;
      const r = await actualizarProducto(quesoId, sinConsignacion);
      expect(r.ok).toBe(true);
      expect((await prisma.producto.findUniqueOrThrow({ where: { id: quesoId } })).nombre).toBe("Queso cremoso");
      expect(await costoGuardado()).toEqual(CONSIGNACION_ORIGINAL());
    });

    it("mandar los MISMOS valores que ya tiene no es un cambio (un cliente viejo que reenvía todo)", async () => {
      expect((await actualizarProducto(quesoId, await datos({ nombre: "Queso cremoso" }))).ok).toBe(true);
      expect(await costoGuardado()).toEqual(CONSIGNACION_ORIGINAL());
    });

    it("control: el administrador sí cambia el costo, y queda auditado", async () => {
      await como(adminId, "admin@test.com");
      expect((await actualizarProducto(quesoId, await datos({ precioConsignacion: 2000, proveedorConsignacionId: proveedorBId }))).ok).toBe(true);
      expect(await costoGuardado()).toEqual({ esConsignacion: true, proveedorConsignacionId: proveedorBId, precioConsignacion: 2000 });
      expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "Producto", entidadId: quesoId, campo: "precioConsignacion" } })).toBe(1);
    });
  });

  describe("darDeAltaProducto (crear un producto en consignación es fijar su costo)", () => {
    const nuevo = (extra: Partial<DatosProducto> = {}): DatosProducto => ({ nombre: "Vino", tipo: "MP", unidadStockId: kgId, factorConversion: 1, ...extra });

    it("EL ATAQUE: el operador da de alta un producto en consignación con costo → rechazado y no se crea nada", async () => {
      const r = await actualizarOAlta(nuevo({ esConsignacion: true, proveedorConsignacionId: proveedorAId, precioConsignacion: 50 }));
      expect(r.ok).toBe(false);
      expect(await prisma.producto.count({ where: { nombre: "Vino" } })).toBe(0);
    });

    it("el operador tampoco fija un precio de consignación suelto", async () => {
      expect((await actualizarOAlta(nuevo({ precioConsignacion: 50 }))).ok).toBe(false);
      expect(await prisma.producto.count({ where: { nombre: "Vino" } })).toBe(0);
    });

    it("control: sin consignación el operador da de alta como siempre (con el costo en cero o sin mandarlo)", async () => {
      expect((await actualizarOAlta(nuevo({ precioConsignacion: 0, esConsignacion: false, proveedorConsignacionId: null }))).ok).toBe(true);
      expect((await actualizarOAlta(nuevo({ nombre: "Vino tinto" }))).ok).toBe(true);
    });

    it("control: el administrador da de alta un producto en consignación", async () => {
      await como(adminId, "admin@test.com");
      expect((await actualizarOAlta(nuevo({ esConsignacion: true, proveedorConsignacionId: proveedorAId, precioConsignacion: 50 }))).ok).toBe(true);
      expect(Number((await prisma.producto.findFirstOrThrow({ where: { nombre: "Vino" } })).precioConsignacion)).toBe(50);
    });

    async function actualizarOAlta(d: DatosProducto) {
      return darDeAltaProducto(d);
    }
  });
});
