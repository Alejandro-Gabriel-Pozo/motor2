import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { activarTodosLosModulos, fijarModulosActivos, MODULOS_VENDIBLES } from "../setup/modulos";
import { __limpiarCookiesDeTest, __setCookieDeTestParaEmpresa, __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { modulosQueIncluyen } from "../../src/core/modulos/clausura";
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
 * activa (desde P20, en alguna sucursal de la empresa), la pantalla donde ese precio se vuelve deuda. Se decide en el servidor: la consulta no lo devuelve, la pantalla no se lo arma al formulario, y la acción
 * trata «el campo no viene» como «no cambia» y «viene distinto» como `SIN_PERMISO_COSTO`. La misma regla en el alta (crear un producto en consignación es fijar su costo).
 *
 * P20 (D23 del dueño, 2026-10-11): la clave se evalúa en TODA la empresa, no en la sucursal activa (el producto es de la empresa): si el usuario tiene `pagar_consignante` en alguna de sus
 * sucursales, puede, y el resultado no cambia según cuál esté activa. Lo prueba el `describe` «D23» del final; el nivel en sí, `test/permisos/nivel-en-alguna-sucursal.test.ts`.
 */
describe("S-12: el costo de consignación es de quien tiene pagar_consignante", () => {
  const PRECIO = 1234.56;
  let sucursalId: string;
  let adminId: string;
  let rolAdminId: string;
  let rolOperadorId: string;
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
    rolAdminId = base.admin.id;
    rolOperadorId = base.operador.id;
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
  /**
   * P20 (D23): la clave se mira en todas las sucursales del usuario en la empresa. Un administrador de Central que es operador en Norte cambia el costo estando parado en Norte (y en Central), y
   * un operador en las dos sigue rechazado. Fallo cerrado: la membresía de admin inactiva, la sucursal de admin inactiva y el módulo Consignación apagado no cuentan. Aislamiento: ser admin en
   * otra EMPRESA no abre nada en esta.
   */
  describe("D23 (P20): el costo de consignación se decide en toda la empresa, no en la sucursal activa", () => {
    let norteId: string;
    let n = 0;

    /** Un usuario con sus membresías (la primera es la más antigua); queda como el usuario de la sesión. */
    async function multi(membresias: { sucursalId: string; rolId: string; activo?: boolean }[]) {
      const email = `multi${++n}@test.com`;
      const [primera, ...resto] = membresias;
      const u = await crearUsuarioConMembresia({ email, ...primera });
      for (const m of resto) await crearMembresia({ usuarioId: u.id, ...m });
      await como(u.id, email);
      return u.id;
    }
    const parado = (id: string | undefined) => __setCookieDeTestParaSucursal(id);

    const ficha = () => FichaProductoPage({ params: Promise.resolve({ id: quesoId }), searchParams: Promise.resolve({}) });
    const edicion = async () => propsDe(await EditarProductoPage({ params: Promise.resolve({ id: quesoId }) }), ProductoForm)[0]!;

    beforeEach(async () => {
      __limpiarCookiesDeTest();
      norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    });
    afterEach(() => __limpiarCookiesDeTest());

    it.each([["Norte (donde es operador)"], ["Central (donde es admin)"]])("admin en Central y operador en Norte, parado en %s: cambia el costo y queda auditado", async (donde) => {
      await multi([
        { sucursalId, rolId: rolAdminId },
        { sucursalId: norteId, rolId: rolOperadorId },
      ]);
      parado(donde.startsWith("Norte") ? norteId : sucursalId);
      const r = await actualizarProducto(quesoId, await datos({ precioConsignacion: 2000, proveedorConsignacionId: proveedorBId }));
      expect(r.ok).toBe(true);
      expect(await costoGuardado()).toEqual({ esConsignacion: true, proveedorConsignacionId: proveedorBId, precioConsignacion: 2000 });
      expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "Producto", entidadId: quesoId, campo: "precioConsignacion" } })).toBe(1);
    });

    it.each([["Norte (donde es operador)"], ["Central (donde es admin)"]])("admin en Central y operador en Norte, parado en %s: el alta en consignación entra", async (donde) => {
      await multi([
        { sucursalId, rolId: rolAdminId },
        { sucursalId: norteId, rolId: rolOperadorId },
      ]);
      parado(donde.startsWith("Norte") ? norteId : sucursalId);
      const r = await darDeAltaProducto({ nombre: "Vino", tipo: "MP", unidadStockId: kgId, factorConversion: 1, esConsignacion: true, proveedorConsignacionId: proveedorAId, precioConsignacion: 50 });
      expect(r.ok).toBe(true);
      expect(Number((await prisma.producto.findFirstOrThrow({ where: { nombre: "Vino" } })).precioConsignacion)).toBe(50);
    });

    it("las tres pantallas, estando parado en Norte (operador), reciben el costo y el formulario completo", async () => {
      await multi([
        { sucursalId, rolId: rolAdminId },
        { sucursalId: norteId, rolId: rolOperadorId },
      ]);
      parado(norteId);
      const textos = textosDe(await ficha()).join(" | ");
      expect(textos).toContain("Lácteos Reservados SA");
      expect(textos).toContain("por unidad vendida");
      const props = await edicion();
      expect(props.puedeGestionarConsignacion).toBe(true);
      expect((props.productoExistente as DatosProducto).precioConsignacion).toBe(PRECIO);
      expect((props.productoExistente as DatosProducto).proveedorConsignacionId).toBe(proveedorAId);
      expect(propsDe(await NuevoProductoPage(), ProductoForm)[0]!.puedeGestionarConsignacion).toBe(true);
    });

    const altaConCosto = () => darDeAltaProducto({ nombre: "Vino", tipo: "MP", unidadStockId: kgId, factorConversion: 1, esConsignacion: true, proveedorConsignacionId: proveedorAId, precioConsignacion: 50 });

    it("EL RECHAZO sigue en pie: un operador en las dos sucursales recibe SIN_PERMISO_COSTO desde las dos, no ve el costo y no cambia nada", async () => {
      await multi([
        { sucursalId, rolId: rolOperadorId },
        { sucursalId: norteId, rolId: rolOperadorId },
      ]);
      for (const donde of [sucursalId, norteId]) {
        parado(donde);
        const r = await actualizarProducto(quesoId, await datos({ precioConsignacion: 1 }));
        expect(r.ok).toBe(false);
        expect(r.mensaje).toContain("consignación");
        expect((await altaConCosto()).ok).toBe(false);
        expect(await costoGuardado()).toEqual(CONSIGNACION_ORIGINAL());
        const textos = textosDe(await ficha()).join(" | ");
        expect(textos).not.toContain("por unidad vendida");
        expect(textos).not.toContain("Lácteos Reservados SA");
        expect((await edicion()).puedeGestionarConsignacion).toBe(false);
        expect(propsDe(await NuevoProductoPage(), ProductoForm)[0]!.puedeGestionarConsignacion).toBe(false);
      }
      expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "Producto", entidadId: quesoId } })).toBe(0);
      expect(await prisma.producto.count({ where: { nombre: "Vino" } })).toBe(0);
    });

    it("FALLO CERRADO: la membresía de admin INACTIVA no cuenta", async () => {
      await multi([
        { sucursalId, rolId: rolOperadorId },
        { sucursalId: norteId, rolId: rolAdminId, activo: false },
      ]);
      parado(sucursalId);
      expect((await actualizarProducto(quesoId, await datos({ precioConsignacion: 1 }))).ok).toBe(false);
      expect((await edicion()).puedeGestionarConsignacion).toBe(false);
      expect(await costoGuardado()).toEqual(CONSIGNACION_ORIGINAL());
    });

    it("FALLO CERRADO: la SUCURSAL de admin inactiva no cuenta", async () => {
      await multi([
        { sucursalId, rolId: rolOperadorId },
        { sucursalId: norteId, rolId: rolAdminId },
      ]);
      parado(sucursalId);
      await prismaAdmin.sucursal.update({ where: { id: norteId }, data: { activo: false } });
      expect((await actualizarProducto(quesoId, await datos({ precioConsignacion: 1 }))).ok).toBe(false);
      expect((await edicion()).puedeGestionarConsignacion).toBe(false);
      expect(await costoGuardado()).toEqual(CONSIGNACION_ORIGINAL());
    });

    it("FALLO CERRADO: con el módulo Consignación apagado el costo no se cambia ni se muestra, aunque sea admin en las dos", async () => {
      await multi([
        { sucursalId, rolId: rolAdminId },
        { sucursalId: norteId, rolId: rolAdminId },
      ]);
      parado(norteId);
      await fijarModulosActivos(
        EMPRESA_POR_DEFECTO_ID,
        MODULOS_VENDIBLES.filter((v) => modulosQueIncluyen("consignacion", [v]).length === 0),
      );
      expect((await actualizarProducto(quesoId, await datos({ precioConsignacion: 1 }))).ok).toBe(false);
      expect((await edicion()).puedeGestionarConsignacion).toBe(false);
      expect(await costoGuardado()).toEqual(CONSIGNACION_ORIGINAL());
      await activarTodosLosModulos(EMPRESA_POR_DEFECTO_ID);
    });

    it("AISLAMIENTO ENTRE EMPRESAS: admin en una sucursal de OTRA empresa y operador en esta, parado en esta: se rechaza", async () => {
      await prismaAdmin.empresa.create({ data: { id: "norte", nombre: "Empresa norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
      await activarTodosLosModulos("norte");
      const sucursalAjena = await prismaAdmin.sucursal.create({ data: { nombre: "Sucursal norte", empresaId: "norte" } });
      const rolAjeno = await prismaAdmin.rol.create({ data: { nombre: "admin", clave: "admin", empresaId: "norte" } });
      await prismaAdmin.permisoRol.create({ data: { empresaId: "norte", rolId: rolAjeno.id, accionClave: "pagar_consignante", puedeVer: true, puedeEditar: true } });
      await multi([
        { sucursalId, rolId: rolOperadorId },
        { sucursalId: sucursalAjena.id, rolId: rolAjeno.id },
      ]);
      __setCookieDeTestParaEmpresa(EMPRESA_POR_DEFECTO_ID);
      expect((await actualizarProducto(quesoId, await datos({ precioConsignacion: 1 }))).ok).toBe(false);
      expect((await edicion()).puedeGestionarConsignacion).toBe(false);
      expect(await costoGuardado()).toEqual(CONSIGNACION_ORIGINAL());
    });
  });
});
