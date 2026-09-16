import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { altaProveedor, actualizarActivaProveedor, actualizarProveedor } from "../../src/server/actions/proveedores";

describe("Proveedores", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("da de alta un proveedor con código autogenerado", async () => {
    const resultado = await altaProveedor({ nombre: "Distribuidora Norte" });
    expect(resultado.ok, resultado.mensaje).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.id).toBeTruthy();
  });

  describe("actualizarProveedor (hallazgo: solo se podía dar de alta y Activar/Desactivar, nunca corregir los datos de contacto)", () => {
    it("actualiza contacto/teléfono/email/CUIT/condiciones de pago de un proveedor existente", async () => {
      const creado = await altaProveedor({ nombre: "Distribuidora Sur", contacto: "Juan" });
      if (!creado.ok) throw new Error("esperaba ok");

      const resultado = await actualizarProveedor(creado.id, {
        contacto: "María",
        telefono: "11-5555-5555",
        email: "maria@sur.com",
        cuit: "20-12345678-9",
        condicionesPago: "30 días",
      });
      expect(resultado.ok, resultado.mensaje).toBe(true);

      const actualizado = await prisma.proveedor.findUniqueOrThrow({ where: { id: creado.id } });
      expect(actualizado.contacto).toBe("María");
      expect(actualizado.telefono).toBe("11-5555-5555");
      expect(actualizado.email).toBe("maria@sur.com");
      expect(actualizado.cuit).toBe("20-12345678-9");
      expect(actualizado.condicionesPago).toBe("30 días");
      expect(actualizado.nombre).toBe("Distribuidora Sur"); // el nombre no se toca acá
    });

    it("un campo vacío borra el dato existente (guarda null, no una cadena vacía)", async () => {
      const creado = await altaProveedor({ nombre: "Distribuidora Este", contacto: "Alguien", telefono: "111" });
      if (!creado.ok) throw new Error("esperaba ok");

      await actualizarProveedor(creado.id, { contacto: "", telefono: "" });
      const actualizado = await prisma.proveedor.findUniqueOrThrow({ where: { id: creado.id } });
      expect(actualizado.contacto).toBeNull();
      expect(actualizado.telefono).toBeNull();
    });

    it("rechaza un proveedor inexistente", async () => {
      const resultado = await actualizarProveedor("no-existe", { contacto: "X" });
      expect(resultado.ok).toBe(false);
    });
  });

  describe("actualizarActivaProveedor", () => {
    it("desactiva y reactiva un proveedor", async () => {
      const creado = await altaProveedor({ nombre: "Distribuidora Oeste" });
      if (!creado.ok) throw new Error("esperaba ok");

      await actualizarActivaProveedor(creado.id, false);
      expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: creado.id } })).activo).toBe(false);

      await actualizarActivaProveedor(creado.id, true);
      expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: creado.id } })).activo).toBe(true);
    });
  });
});
