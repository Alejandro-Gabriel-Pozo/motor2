import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { altaProveedor, actualizarActivaProveedor, actualizarProveedor } from "../../src/server/actions/catalogo/proveedores";

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

  it("el alta guarda el CUIT canónico (11 dígitos) aunque se escriba con guiones o espacios", async () => {
    const resultado = await altaProveedor({ nombre: "Con CUIT", cuit: " 30-70308853-4 " });
    expect(resultado.ok, resultado.mensaje).toBe(true);
    if (!resultado.ok) return;
    expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: resultado.id } })).cuit).toBe("30703088534");
  });

  it("el alta rechaza un CUIT con el dígito verificador mal y no crea el proveedor", async () => {
    const resultado = await altaProveedor({ nombre: "CUIT inválido", cuit: "20-12345678-9" });
    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toContain("dígito verificador");
    expect(await prisma.proveedor.count({ where: { nombre: "CUIT inválido" } })).toBe(0);
  });

  it("sin CUIT el proveedor se crea con cuit null", async () => {
    const resultado = await altaProveedor({ nombre: "Sin CUIT", cuit: "  " });
    expect(resultado.ok, resultado.mensaje).toBe(true);
    if (!resultado.ok) return;
    expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: resultado.id } })).cuit).toBeNull();
  });

  it("actualizarProveedor rechaza un CUIT inválido y deja el dato anterior", async () => {
    const creado = await altaProveedor({ nombre: "Edita CUIT", cuit: "30703088534" });
    if (!creado.ok) throw new Error("esperaba ok");
    const resultado = await actualizarProveedor(creado.id, { cuit: "30-70308853-5" });
    expect(resultado.ok).toBe(false);
    expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: creado.id } })).cuit).toBe("30703088534");
  });

  it("el alta rechaza un CUIT que ya tiene otro proveedor de la empresa, aunque se escriba con guiones, y nombra al otro", async () => {
    const primero = await altaProveedor({ nombre: "Primero", cuit: "30703088534" });
    expect(primero.ok, primero.mensaje).toBe(true);
    const resultado = await altaProveedor({ nombre: "Segundo", cuit: "30-70308853-4" });
    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toContain("Ya existe un proveedor con ese CUIT");
    expect(resultado.mensaje).toContain("Primero");
    expect(await prisma.proveedor.count({ where: { nombre: "Segundo" } })).toBe(0);
  });

  it("varios proveedores sin CUIT conviven", async () => {
    expect((await altaProveedor({ nombre: "Uno" })).ok).toBe(true);
    expect((await altaProveedor({ nombre: "Dos", cuit: "" })).ok).toBe(true);
  });

  it("actualizarProveedor rechaza el CUIT de otro proveedor, pero deja guardar el propio sin cambios", async () => {
    const a = await altaProveedor({ nombre: "A", cuit: "30703088534" });
    const b = await altaProveedor({ nombre: "B" });
    if (!a.ok || !b.ok) throw new Error("esperaba ok");
    const choque = await actualizarProveedor(b.id, { cuit: "30-70308853-4" });
    expect(choque.ok).toBe(false);
    expect(choque.mensaje).toContain("Ya existe un proveedor con ese CUIT");
    expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: b.id } })).cuit).toBeNull();
    const propio = await actualizarProveedor(a.id, { cuit: "30-70308853-4", contacto: "Ana" });
    expect(propio.ok, propio.mensaje).toBe(true);
  });

  it("el alta persiste condicionesPago y notas (F4: el form nuevo los manda, el inline viejo no)", async () => {
    const resultado = await altaProveedor({
      nombre: "Distribuidora Sur",
      condicionesPago: "30 días",
      notas: "Entrega los martes",
    });
    expect(resultado.ok, resultado.mensaje).toBe(true);
    if (!resultado.ok) return;
    const proveedor = await prisma.proveedor.findUniqueOrThrow({ where: { id: resultado.id } });
    expect(proveedor.condicionesPago).toBe("30 días");
    expect(proveedor.notas).toBe("Entrega los martes");
  });

  describe("actualizarProveedor (hallazgo: solo se podía dar de alta y Activar/Desactivar, nunca corregir los datos de contacto)", () => {
    it("actualiza contacto/teléfono/email/CUIT/condiciones de pago de un proveedor existente", async () => {
      const creado = await altaProveedor({ nombre: "Distribuidora Sur", contacto: "Juan" });
      if (!creado.ok) throw new Error("esperaba ok");

      const resultado = await actualizarProveedor(creado.id, {
        contacto: "María",
        telefono: "11-5555-5555",
        email: "maria@sur.com",
        cuit: "20-12345678-6",
        condicionesPago: "30 días",
      });
      expect(resultado.ok, resultado.mensaje).toBe(true);

      const actualizado = await prisma.proveedor.findUniqueOrThrow({ where: { id: creado.id } });
      expect(actualizado.contacto).toBe("María");
      expect(actualizado.telefono).toBe("11-5555-5555");
      expect(actualizado.email).toBe("maria@sur.com");
      expect(actualizado.cuit).toBe("20123456786"); // se guarda canónico (11 dígitos)
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
