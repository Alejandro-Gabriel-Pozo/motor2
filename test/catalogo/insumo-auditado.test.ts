import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * Interruptor para romper la auditoría A MITAD DE CAMINO (mismo molde que `catalogo-auditoria-atomica.test.ts`): `fallarEnLlamada = N` hace que la N-ésima llamada
 * a `registrarCambioAuditado` tire, DESPUÉS de que el caso de uso ya escribió. El resto delega en la implementación real.
 */
const interruptor = vi.hoisted(() => ({ fallarEnLlamada: null as number | null, llamadas: 0 }));

vi.mock("../../src/server/auditoria/registrar-cambio-auditado", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/auditoria/registrar-cambio-auditado")>();
  return {
    ...real,
    registrarCambioAuditado: async (...args: Parameters<typeof real.registrarCambioAuditado>) => {
      interruptor.llamadas++;
      if (interruptor.fallarEnLlamada !== null && interruptor.llamadas === interruptor.fallarEnLlamada) {
        throw new Error("auditoría caída (simulada)");
      }
      return real.registrarCambioAuditado(...args);
    },
  };
});

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { renombrarOFusionarInsumo } from "../../src/server/actions/catalogo/insumos";

/**
 * D-9 (decisión del dueño, 2026-10-07; Hito 4, bloque 4.3, paso H4C-10 — CAMBIA COMPORTAMIENTO, commit aparte): renombrar o fusionar un insumo deja su rastro en
 * la auditoría administrativa, en la MISMA transacción que el cambio.
 *  - Renombre: UNA fila (`entidad: "Insumo"`, `entidadId` el insumo, `campo: "nombre"`, del nombre anterior al nuevo); el renombre pasa a ir en una transacción
 *    SIMPLE con su fila. Renombrar al mismo nombre no deja fila (no cambió nada).
 *  - Fusión: UNA fila sobre el insumo que DESAPARECE (`campo: "fusion"`, del nombre de origen al de destino), con la cantidad de productos reasignados en la
 *    descripción, en la transacción de la fusión.
 *  - Un rechazo (nombre, insumo inexistente, choque de unidades, sin confirmar) no deja fila.
 * Rojo contra el código de H4C-9 (`537af50f`), que no auditaba nada y renombraba sin transacción. Los demás tests de la acción (`insumos.test.ts`,
 * `renombrar-o-fusionar-insumo-mensajes.test.ts`) no miran la auditoría y siguen idénticos.
 */
describe("D-9: renombrar o fusionar un insumo se audita", () => {
  let adminId: string;
  let kgId: string;
  let harinaId: string;
  let sucursalId: string;

  beforeEach(async () => {
    interruptor.fallarEnLlamada = null;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    harinaId = catalogo.insumo.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    interruptor.llamadas = 0;
  });

  const filas = () =>
    prismaAdmin.registroAuditoria.findMany({
      orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
      select: { entidad: true, entidadId: true, campo: true, descripcion: true, valorAnterior: true, valorNuevo: true, actorId: true, sucursalId: true },
    });

  /** Dos productos de harina en kg (uno disponible y uno no) y el insumo de destino con otro producto en kg. */
  const sembrarFusion = async () => {
    const premium = await prisma.insumo.create({ data: { nombre: "Harina premium" } });
    await sembrarProductoDisponible({ codigo: "MP_HARINA_A", nombre: "Harina A", tipo: "MP", unidadStockId: kgId, insumoId: harinaId }, sucursalId);
    await prisma.producto.create({ data: { codigo: "MP_HARINA_B", nombre: "Harina B", tipo: "MP", unidadStockId: kgId, factorConversion: 1, insumoId: harinaId } });
    await sembrarProductoDisponible({ codigo: "MP_PREMIUM", nombre: "Premium", tipo: "MP", unidadStockId: kgId, insumoId: premium.id }, sucursalId);
    return premium;
  };

  it("renombre: una fila del nombre anterior al nuevo", async () => {
    expect(await renombrarOFusionarInsumo(harinaId, "  Harina 0000 ")).toEqual({ ok: true, mensaje: 'Insumo renombrado a "Harina 0000".' });
    expect(await filas()).toEqual([
      {
        entidad: "Insumo",
        entidadId: harinaId,
        campo: "nombre",
        descripcion: 'Insumo "Harina": nombre',
        valorAnterior: "Harina",
        valorNuevo: "Harina 0000",
        actorId: adminId,
        sucursalId: null,
      },
    ]);
  });

  it("renombre al mismo nombre: no deja fila", async () => {
    expect((await renombrarOFusionarInsumo(harinaId, "Harina")).ok).toBe(true);
    expect(await filas()).toEqual([]);
  });

  it("fusión: una fila sobre el insumo que desaparece, con los productos reasignados", async () => {
    const premium = await sembrarFusion();
    expect(await renombrarOFusionarInsumo(harinaId, "harina premium", true)).toEqual({ ok: true, mensaje: '"Harina" se fusionó con el insumo existente "Harina premium".' });
    expect(await prisma.producto.count({ where: { insumoId: premium.id } })).toBe(3);
    expect(await filas()).toEqual([
      {
        entidad: "Insumo",
        entidadId: harinaId,
        campo: "fusion",
        descripcion: 'Insumo "Harina" fusionado con "Harina premium" (2 productos reasignados)',
        valorAnterior: "Harina",
        valorNuevo: "Harina premium",
        actorId: adminId,
        sucursalId: null,
      },
    ]);
  });

  it("fusión de un insumo sin productos: la fila dice 0 productos reasignados", async () => {
    await prisma.insumo.create({ data: { nombre: "Harina premium" } });
    expect((await renombrarOFusionarInsumo(harinaId, "Harina premium", true)).ok).toBe(true);
    expect((await filas()).map((f) => f.descripcion)).toEqual(['Insumo "Harina" fusionado con "Harina premium" (0 productos reasignados)']);
  });

  it("los rechazos no dejan fila", async () => {
    await sembrarFusion();
    expect((await renombrarOFusionarInsumo(harinaId, "   ")).ok).toBe(false);
    expect((await renombrarOFusionarInsumo("no-existe", "Otro")).ok).toBe(false);
    expect((await renombrarOFusionarInsumo(harinaId, "Harina premium")).ok).toBe(false);
    expect(await filas()).toEqual([]);
  });

  it("renombre atómico: si falla la auditoría, el nombre no cambia", async () => {
    interruptor.fallarEnLlamada = 1;
    await expect(renombrarOFusionarInsumo(harinaId, "Harina 0000")).rejects.toThrow("auditoría caída");
    expect((await prisma.insumo.findUniqueOrThrow({ where: { id: harinaId } })).nombre).toBe("Harina");
    expect(await filas()).toEqual([]);
  });

  it("fusión atómica: si falla la auditoría, no se mueve ningún producto ni se borra el insumo", async () => {
    const premium = await sembrarFusion();
    interruptor.fallarEnLlamada = 1;
    await expect(renombrarOFusionarInsumo(harinaId, "Harina premium", true)).rejects.toThrow("auditoría caída");
    expect(await prisma.insumo.findUnique({ where: { id: harinaId } })).not.toBeNull();
    expect(await prisma.producto.count({ where: { insumoId: harinaId } })).toBe(2);
    expect(await prisma.producto.count({ where: { insumoId: premium.id } })).toBe(1);
    expect(await filas()).toEqual([]);
  });
});
