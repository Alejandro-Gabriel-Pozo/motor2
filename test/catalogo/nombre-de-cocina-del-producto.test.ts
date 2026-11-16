import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * Interruptor para romper la auditoría DEL NOMBRE DE COCINA después de que el caso de uso ya escribió el producto (mismo molde que `alicuota-iva-del-producto.test.ts`, pero por campo y no por número de llamada, así no
 * depende del orden de las demás filas). El resto delega en la implementación real.
 */
const interruptor = vi.hoisted(() => ({ fallarEnCampo: null as string | null }));

vi.mock("../../src/server/auditoria/registrar-cambio-auditado", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/auditoria/registrar-cambio-auditado")>();
  return {
    ...real,
    registrarCambioAuditado: async (...args: Parameters<typeof real.registrarCambioAuditado>) => {
      if (interruptor.fallarEnCampo !== null && args[1].campo === interruptor.fallarEnCampo) throw new Error("auditoría caída (simulada)");
      return real.registrarCambioAuditado(...args);
    },
  };
});

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { DATOS_EMPRESA_TESTIGO, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { actualizarProducto, darDeAltaProducto, type DatosProducto } from "../../src/server/actions/catalogo/productos";

/**
 * Nombre de cocina del producto (2026-11-15; `docs/diseno-nombre-de-cocina-como-pedernal-2026-11-15.md`, etapa (b)): el campo de la ficha, por las Server Actions públicas y contra la base. Oráculo del diseño, filas O7 a O9
 * y O14 a O16 (O13, Duplicar, está en `duplicar-producto.test.ts`): solo un PV lo lleva (O7), vacío o de espacios se guarda como «sin nombre de cocina» (O8), un valor fuera de la ficha se rechaza con el mensaje genérico y
 * no escribe nada (O9), guardar dos veces lo mismo no cambia ni audita de nuevo (O14), sin `producto_editar` no se puede cambiar (O16). Además: cada cambio deja su fila de auditoría en la MISMA transacción (I11), dos
 * ediciones simultáneas dejan una cadena de auditoría coherente (concurrencia) y el producto de otra empresa no se ve ni se toca (aislamiento).
 */
const ITERACIONES = 8;
const GENERICO = "Esta acción no está permitida";

describe("nombre de cocina del producto", () => {
  let sucursalId: string;
  let unidadId: string;
  let adminId: string;
  let sinEdicionId: string;
  let n = 0;

  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const comoAdmin = () => como(adminId, "admin@test.com");

  beforeEach(async () => {
    interruptor.fallarEnCampo = null;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    // Un rol que puede dar de alta productos pero NO editarlos (`producto_editar` ausente).
    const rol = await prisma.rol.create({ data: { nombre: "Solo alta" } });
    await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave: "alta_producto", puedeVer: true, puedeEditar: true } });
    sinEdicionId = (await crearUsuarioConMembresia({ email: "sin-edicion@test.com", sucursalId, rolId: rol.id })).id;
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    await comoAdmin();
  });

  afterEach(() => {
    interruptor.fallarEnCampo = null;
  });

  const pv = async (nombre: string, nombreDeCocina?: string) =>
    (await sembrarProductoDisponible({ codigo: `PV_NC_${n++}`, nombre, tipo: "PV", precioVenta: 1000, unidadStockId: unidadId, ...(nombreDeCocina !== undefined && { nombreDeCocina }) }, sucursalId)).id;
  const mp = async (nombre: string) => (await sembrarProductoDisponible({ codigo: `MP_NC_${n++}`, nombre, tipo: "MP", precioVenta: 0, unidadStockId: unidadId }, sucursalId)).id;
  const altaPV = (nombre: string, extra: Partial<DatosProducto> = {}): DatosProducto => ({ nombre, tipo: "PV", unidadStockId: unidadId, factorConversion: 1, precioVenta: 1000, ...extra });

  const cocina = async (id: string) => (await prisma.producto.findUniqueOrThrow({ where: { id } })).nombreDeCocina;
  const auditoria = (id: string) => prismaAdmin.registroAuditoria.findMany({ where: { entidad: "Producto", entidadId: id, campo: "nombreDeCocina" }, orderBy: { creadoEn: "asc" } });
  const resumen = (filas: Awaited<ReturnType<typeof auditoria>>) => filas.map((f) => `${f.valorAnterior} → ${f.valorNuevo}`);

  describe("el alta", () => {
    it("un PV con nombre de cocina lo guarda en su forma canónica (recortado y con los espacios colapsados); sin el campo, o vacío o de espacios (O8), queda en NULL", async () => {
      const a = await darDeAltaProducto(altaPV("Bife de chorizo", { nombreDeCocina: "  Medallón   de bife  " }));
      expect(a.ok, JSON.stringify(a)).toBe(true);
      const b = await darDeAltaProducto(altaPV("Nalga"));
      const c = await darDeAltaProducto(altaPV("Lomo", { nombreDeCocina: "" }));
      const d = await darDeAltaProducto(altaPV("Vacío", { nombreDeCocina: "   " }));
      for (const r of [b, c, d]) expect(r.ok, JSON.stringify(r)).toBe(true);
      const nombres = Object.fromEntries((await prisma.producto.findMany({ select: { nombre: true, nombreDeCocina: true } })).map((p) => [p.nombre, p.nombreDeCocina]));
      expect(nombres).toMatchObject({ "Bife de chorizo": "Medallón de bife", Nalga: null, Lomo: null, Vacío: null });
    });

    it("O7: una materia prima NO admite nombre de cocina: se rechaza con el mensaje genérico y no se crea nada; con el campo vacío sí se crea", async () => {
      const antes = await prisma.producto.count();
      expect(await darDeAltaProducto({ ...altaPV("Carne cruda", { nombreDeCocina: "Carne" }), tipo: "MP", precioVenta: 0 })).toMatchObject({ ok: false, mensaje: GENERICO });
      expect(await prisma.producto.count()).toBe(antes);
      expect((await darDeAltaProducto({ ...altaPV("Carne cruda", { nombreDeCocina: "  " }), tipo: "MP", precioVenta: 0 })).ok).toBe(true);
    });

    it.each([
      ["81 caracteres", "x".repeat(81)],
      ["con salto de línea", "Medallón\nde bife"],
      ["sin ninguna letra", "12 34"],
      ["con un signo solo de catálogo (¿ ¡ ? ! % $)", "¿Bife?"],
      ["con un carácter invisible", "Medallón​de bife"],
      ["con marcado", "<b>Bife</b>"],
      ["con una fórmula", "=SUM(1,2)"],
    ])("O9: %s → rechazado con el mensaje genérico, y no se crea el producto", async (_motivo, valor) => {
      const antes = await prisma.producto.count();
      expect(await darDeAltaProducto(altaPV("Bife de chorizo", { nombreDeCocina: valor }))).toMatchObject({ ok: false, mensaje: GENERICO });
      expect(await prisma.producto.count()).toBe(antes);
    });

    it("lo que no es texto (un número, un objeto) se rechaza (falla cerrado) y no se crea nada", async () => {
      const antes = await prisma.producto.count();
      for (const raro of [5, { a: 1 }, ["x"], true]) {
        expect(await darDeAltaProducto(altaPV("Bife", { nombreDeCocina: raro as unknown as string })), JSON.stringify(raro)).toMatchObject({ ok: false, mensaje: GENERICO });
      }
      expect(await prisma.producto.count()).toBe(antes);
    });
  });

  describe("la edición", () => {
    it("cargarlo, cambiarlo y borrarlo: cada cambio queda en el producto y deja UNA fila de auditoría (del anterior al nuevo); no toca lo demás", async () => {
      const id = await pv("Bife de chorizo");
      const antes = await prisma.producto.findUniqueOrThrow({ where: { id } });
      expect((await actualizarProducto(id, { nombreDeCocina: "Medallón de bife" })).ok).toBe(true);
      expect((await actualizarProducto(id, { nombreDeCocina: "Bife angosto" })).ok).toBe(true);
      expect((await actualizarProducto(id, { nombreDeCocina: null })).ok).toBe(true);
      expect(await cocina(id)).toBeNull();
      expect(resumen(await auditoria(id))).toEqual(["null → Medallón de bife", "Medallón de bife → Bife angosto", "Bife angosto → null"]);
      const despues = await prisma.producto.findUniqueOrThrow({ where: { id } });
      expect({ ...despues, nombreDeCocina: null }).toEqual({ ...antes, nombreDeCocina: null });
    });

    it("O8: vacío o solo espacios lo borra («sin nombre de cocina»), no lo deja en blanco", async () => {
      const id = await pv("Bife de chorizo", "Medallón de bife");
      expect((await actualizarProducto(id, { nombreDeCocina: "   " })).ok).toBe(true);
      expect(await cocina(id)).toBeNull();
    });

    it("el nombre que no viene (`undefined`) queda como estaba: editar otro dato no lo toca ni lo audita", async () => {
      const id = await pv("Bife de chorizo", "Medallón de bife");
      expect((await actualizarProducto(id, { nombre: "Bife de chorizo grande" })).ok).toBe(true);
      expect(await cocina(id)).toBe("Medallón de bife");
      expect(await auditoria(id)).toEqual([]);
    });

    it("renombrar el producto no cambia su nombre de cocina (son dos datos distintos)", async () => {
      const id = await pv("Bife de chorizo", "Medallón de bife");
      expect((await actualizarProducto(id, { nombre: "Bife angosto" })).ok).toBe(true);
      expect(await cocina(id)).toBe("Medallón de bife");
    });

    it.each([
      ["81 caracteres", "x".repeat(81)],
      ["con salto de línea", "Medallón\nde bife"],
      ["sin ninguna letra", "12 34"],
      ["con un signo solo de catálogo", "¿Bife?"],
      ["con un carácter invisible", "Medallón​de bife"],
      ["un número", 5 as unknown as string],
    ])("O9: %s → mensaje genérico; el producto y la auditoría quedan intactos", async (_motivo, valor) => {
      const id = await pv("Bife de chorizo", "Medallón de bife");
      expect(await actualizarProducto(id, { nombreDeCocina: valor })).toMatchObject({ ok: false, mensaje: GENERICO });
      expect(await cocina(id)).toBe("Medallón de bife");
      expect(await auditoria(id)).toEqual([]);
    });

    it("O7: una materia prima no admite nombre de cocina (se rechaza sin escribir); mandarlo vacío sí se acepta y no cambia nada", async () => {
      const id = await mp("Carne cruda");
      expect(await actualizarProducto(id, { nombreDeCocina: "Carne" })).toMatchObject({ ok: false, mensaje: GENERICO });
      expect(await cocina(id)).toBeNull();
      expect((await actualizarProducto(id, { nombreDeCocina: "" })).ok).toBe(true);
      expect(await auditoria(id)).toEqual([]);
    });

    it("O14 (idempotencia): guardar dos veces el mismo valor es «sin cambios»: las dos veces ok, una sola fila de auditoría", async () => {
      const id = await pv("Bife de chorizo");
      expect((await actualizarProducto(id, { nombreDeCocina: "Medallón de bife" })).ok).toBe(true);
      expect((await actualizarProducto(id, { nombreDeCocina: "Medallón de bife" })).ok).toBe(true);
      expect((await actualizarProducto(id, { nombreDeCocina: "  Medallón   de bife " })).ok, "el mismo valor con otra forma de espacios también").toBe(true);
      expect(await cocina(id)).toBe("Medallón de bife");
      expect(resumen(await auditoria(id))).toEqual(["null → Medallón de bife"]);
    });

    it("atomicidad (I11): si falla la fila de auditoría, no queda el nombre de cocina ni ninguna fila", async () => {
      const id = await pv("Bife de chorizo", "Medallón de bife");
      interruptor.fallarEnCampo = "nombreDeCocina";
      await expect(actualizarProducto(id, { nombreDeCocina: "Bife angosto" })).rejects.toThrow();
      interruptor.fallarEnCampo = null;
      expect(await cocina(id)).toBe("Medallón de bife");
      expect(await auditoria(id)).toEqual([]);
    });
  });

  describe("concurrencia", () => {
    it(`CARRERA (${ITERACIONES} vueltas): dos ediciones a la vez con valores distintos → las dos terminan, queda uno de los dos y la cadena de auditoría es coherente (cada fila parte de donde terminó la anterior)`, async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        const id = await pv(`Bife ${i}`);
        const res = await Promise.allSettled([actualizarProducto(id, { nombreDeCocina: "Medallón" }), actualizarProducto(id, { nombreDeCocina: "Angosto" })]);
        expect(res.map((r) => (r.status === "fulfilled" && r.value.ok ? "ok" : String(r.status === "rejected" ? r.reason : r.value.mensaje))), `vuelta ${i}`).toEqual(["ok", "ok"]);
        const final = await cocina(id);
        expect(["Medallón", "Angosto"], `vuelta ${i}`).toContain(final);
        const filas = await auditoria(id);
        expect(filas, `vuelta ${i}`).toHaveLength(2);
        expect(filas[0]!.valorAnterior, `vuelta ${i}`).toBeNull();
        expect(filas[1]!.valorAnterior, `vuelta ${i}: la segunda parte de donde dejó la primera`).toBe(filas[0]!.valorNuevo);
        expect(filas[1]!.valorNuevo, `vuelta ${i}: la última fila es lo que quedó`).toBe(final);
      }
    });

    it(`CARRERA (${ITERACIONES} vueltas): el MISMO guardado dos veces a la vez → dos ok y una sola fila de auditoría`, async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        const id = await pv(`Lomo ${i}`);
        const res = await Promise.allSettled([actualizarProducto(id, { nombreDeCocina: "Medallón" }), actualizarProducto(id, { nombreDeCocina: "Medallón" })]);
        expect(res.map((r) => r.status === "fulfilled" && r.value.ok), `vuelta ${i}`).toEqual([true, true]);
        expect(await cocina(id), `vuelta ${i}`).toBe("Medallón");
        expect(await auditoria(id), `vuelta ${i}`).toHaveLength(1);
      }
    });
  });

  describe("permisos y aislamiento", () => {
    it("O16: sin `producto_editar` no se puede cargar, cambiar ni borrar el nombre de cocina: se rechaza y el producto queda intacto, sin auditoría", async () => {
      const id = await pv("Bife de chorizo", "Medallón de bife");
      await como(sinEdicionId, "sin-edicion@test.com");
      for (const valor of ["Otro nombre", null]) {
        const r = await actualizarProducto(id, { nombreDeCocina: valor });
        expect(r.ok, JSON.stringify(valor)).toBe(false);
      }
      expect(await cocina(id)).toBe("Medallón de bife");
      expect(await auditoria(id)).toEqual([]);
    });

    it("el producto de OTRA empresa no se ve ni se toca: «No se encontró el producto.» y su nombre de cocina queda igual", async () => {
      await prismaAdmin.empresa.upsert({ where: { id: EMPRESA_TESTIGO_ID }, update: { estado: "ACTIVE" }, create: DATOS_EMPRESA_TESTIGO });
      try {
        const unidadAjena = await prismaAdmin.unidad.create({ data: { empresaId: EMPRESA_TESTIGO_ID, nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
        const ajeno = await prismaAdmin.producto.create({
          data: { empresaId: EMPRESA_TESTIGO_ID, codigo: "PV_AJENO", nombre: "Bife ajeno", tipo: "PV", unidadStockId: unidadAjena.id, precioVenta: 1000, nombreDeCocina: "Del testigo" },
        });
        expect(await actualizarProducto(ajeno.id, { nombreDeCocina: "Robado" })).toEqual({ ok: false, mensaje: "No se encontró el producto." });
        expect((await prismaAdmin.producto.findUniqueOrThrow({ where: { id: ajeno.id } })).nombreDeCocina).toBe("Del testigo");
        expect(await prismaAdmin.registroAuditoria.count({ where: { entidadId: ajeno.id } })).toBe(0);
      } finally {
        await prismaAdmin.producto.deleteMany({ where: { empresaId: EMPRESA_TESTIGO_ID } });
        await prismaAdmin.unidad.deleteMany({ where: { empresaId: EMPRESA_TESTIGO_ID } });
        await prismaAdmin.moduloEmpresa.deleteMany({ where: { empresaId: EMPRESA_TESTIGO_ID } });
        await prismaAdmin.empresa.deleteMany({ where: { id: EMPRESA_TESTIGO_ID } });
      }
    });
  });
});
