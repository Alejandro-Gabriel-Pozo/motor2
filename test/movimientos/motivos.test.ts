import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import {
  crearMotivoMerma,
  crearDestinoConsumo,
  actualizarActivoMotivoMerma,
  actualizarActivoDestinoConsumo,
  listarMotivosMermaActivos,
  listarDestinosConsumoActivos,
  listarMotivosMermaParaPanel,
  listarDestinosConsumoParaPanel,
} from "../../src/server/actions/movimientos/motivos";

/** Plan "motivos de Consumo/Merma como catálogo administrable" (2026-09-23), P6/P7 — pantalla de administración. */
describe("Motivo de Merma / Destino de Consumo (catálogo administrable)", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  describe("Motivo de Merma", () => {
    it("crea un motivo (con y sin descripción) y lo lista entre los activos", async () => {
      const sinDescripcion = await crearMotivoMerma("Vencido");
      expect(sinDescripcion.ok, sinDescripcion.mensaje).toBe(true);
      const conDescripcion = await crearMotivoMerma("Devolución de cliente (no revendible)", "Descuenta stock de verdad.");
      expect(conDescripcion.ok, conDescripcion.mensaje).toBe(true);

      const activos = await listarMotivosMermaActivos();
      expect(activos.map((m) => m.nombre)).toEqual(expect.arrayContaining(["Vencido", "Devolución de cliente (no revendible)"]));
      expect(activos.find((m) => m.nombre === "Devolución de cliente (no revendible)")?.descripcion).toBe("Descuenta stock de verdad.");
    });

    it("rechaza un nombre duplicado, ignorando mayúsculas/espacios", async () => {
      await crearMotivoMerma("Roto o caído");
      const resultado = await crearMotivoMerma("  roto o caído  ");
      expect(resultado.ok).toBe(false);
    });

    it("rechaza un nombre vacío o con caracteres fuera del charset de catálogo", async () => {
      expect((await crearMotivoMerma("")).ok).toBe(false);
      expect((await crearMotivoMerma("<script>"))?.ok).toBe(false);
    });

    it("rechaza una descripción de más de 300 caracteres", async () => {
      const resultado = await crearMotivoMerma("Otro", "x".repeat(301));
      expect(resultado.ok).toBe(false);
    });

    it("desactivar un motivo lo saca de listarMotivosMermaActivos, sin borrarlo (sigue en listarMotivosMermaParaPanel)", async () => {
      const creado = await crearMotivoMerma("Robo o faltante");
      expect(creado.ok).toBe(true);
      if (!creado.ok) return;

      const resultado = await actualizarActivoMotivoMerma(creado.id, false);
      expect(resultado.ok, resultado.mensaje).toBe(true);

      const activos = await listarMotivosMermaActivos();
      expect(activos.map((m) => m.nombre)).not.toContain("Robo o faltante");

      const panel = await listarMotivosMermaParaPanel();
      const fila = panel.find((m) => m.id === creado.id);
      expect(fila?.activo).toBe(false);
    });

    it("reactivar un motivo desactivado lo vuelve a listarMotivosMermaActivos", async () => {
      const creado = await crearMotivoMerma("Otro");
      if (!creado.ok) return;
      await actualizarActivoMotivoMerma(creado.id, false);

      await actualizarActivoMotivoMerma(creado.id, true);
      const activos = await listarMotivosMermaActivos();
      expect(activos.map((m) => m.nombre)).toContain("Otro");
    });

    it("un motivo ya usado por una Operacion no se puede borrar (ON DELETE RESTRICT) — solo desactivar", async () => {
      const creado = await crearMotivoMerma("Mal preparado / quemado");
      if (!creado.ok) return;
      const sucursal = await prisma.sucursal.create({ data: { nombre: "Otra" } });
      const usuario = await prisma.user.findFirstOrThrow();
      const operacion = await prisma.operacion.create({
        data: { sucursalId: sucursal.id, proceso: "MERMA", fecha: new Date(), usuarioId: usuario.id, motivoId: creado.id },
      });

      await expect(prisma.motivoMerma.delete({ where: { id: creado.id } })).rejects.toThrow();

      // Desactivarlo sí es posible, y la Operacion vieja sigue referenciándolo.
      await actualizarActivoMotivoMerma(creado.id, false);
      const op = await prisma.operacion.findUniqueOrThrow({ where: { id: operacion.id } });
      expect(op.motivoId).toBe(creado.id);
    });
  });

  describe("Destino de Consumo", () => {
    it("crea un destino y lo lista entre los activos", async () => {
      const resultado = await crearDestinoConsumo("Personal");
      expect(resultado.ok, resultado.mensaje).toBe(true);

      const activos = await listarDestinosConsumoActivos();
      expect(activos.map((d) => d.nombre)).toContain("Personal");
    });

    it("rechaza un nombre duplicado, ignorando mayúsculas/espacios", async () => {
      await crearDestinoConsumo("Evento");
      const resultado = await crearDestinoConsumo("EVENTO");
      expect(resultado.ok).toBe(false);
    });

    it("desactivar un destino lo saca de listarDestinosConsumoActivos, sin borrarlo", async () => {
      const creado = await crearDestinoConsumo("Elaboración interna");
      if (!creado.ok) return;

      await actualizarActivoDestinoConsumo(creado.id, false);
      const activos = await listarDestinosConsumoActivos();
      expect(activos.map((d) => d.nombre)).not.toContain("Elaboración interna");

      const panel = await listarDestinosConsumoParaPanel();
      expect(panel.find((d) => d.id === creado.id)?.activo).toBe(false);
    });
  });

  describe("un rol sin 'motivos_merma' ni 'motivos_destino_consumo' no puede administrar el catálogo", () => {
    it("crearMotivoMerma se rechaza con el mensaje de permiso", async () => {
      const sucursal = await prisma.sucursal.create({ data: { nombre: "Otra" } });
      const rolSinPermisos = await prisma.rol.create({ data: { nombre: "sin-permisos" } });
      const usuario = await crearUsuarioConMembresia({ email: "operador2@test.com", sucursalId: sucursal.id, rolId: rolSinPermisos.id });
      await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

      const resultado = await crearMotivoMerma("Vencido");
      expect(resultado.ok).toBe(false);
      expect(resultado.mensaje).toMatch(/permiso/i);
    });
  });
});
