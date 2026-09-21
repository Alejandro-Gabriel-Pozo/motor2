import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { anularCompra, corregirCompra } from "../../src/server/actions/movimientos/compras";
import { MENSAJE_FACTURA_DUPLICADA } from "../../src/core/movimientos/factura-unica";

/** K1b: corregir la cabecera (proveedor, N.º de factura, detalle) de una compra confirmada. Postgres real, sin mocks de base. */
describe("corregirCompra", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let adminId: string;
  let operadorId: string;
  let harinaId: string;
  let molinoId: string;
  let otroProveedorId: string;

  async function compra(opciones: { proveedorId?: string | null; nroFactura?: string | null; detalleLibre?: string | null } = {}) {
    const op = await prisma.operacion.create({
      data: {
        sucursalId,
        proceso: "COMPRA",
        fecha: new Date("2026-08-10T12:00:00Z"),
        usuarioId: adminId,
        proveedorId: opciones.proveedorId ?? null,
        nroFactura: opciones.nroFactura ?? null,
        detalleLibre: opciones.detalleLibre ?? null,
      },
    });
    await prisma.movimientoStock.create({
      data: { operacionId: op.id, productoId: harinaId, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: 1000, precioPorUnidadStock: 100 },
    });
    return op;
  }

  /** Lo que hoy está guardado de la cabecera, tal como lo vio la persona al abrir el formulario. */
  const vista = (op: { proveedorId: string | null; nroFactura: string | null; detalleLibre: string | null }) => ({ proveedorId: op.proveedorId, nroFactura: op.nroFactura, detalleLibre: op.detalleLibre });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
    harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } })).id;
    molinoId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
    otroProveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Distribuidora Sur" } })).id;
  });

  it("completa una compra cargada «Sin proveedor», y su Kardex queda EXACTAMENTE igual", async () => {
    const op = await compra({ nroFactura: "A-0001" });
    const antes = await prisma.movimientoStock.findMany({ where: { operacionId: op.id }, orderBy: { id: "asc" } });

    const r = await corregirCompra(op.id, { proveedorId: molinoId, nroFactura: "A-0001", detalleLibre: "" }, vista(op));

    expect(r.ok, r.mensaje).toBe(true);
    expect(r.mensaje).toContain("proveedor");
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).proveedorId).toBe(molinoId);
    // Append-only: ni una línea del Kardex cambió (precio, cantidad, lote, fecha de creación).
    const despues = await prisma.movimientoStock.findMany({ where: { operacionId: op.id }, orderBy: { id: "asc" } });
    expect(despues).toEqual(antes);
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } }), "no se escribe ningún contra-asiento").toBe(0);
  });

  it("corrige el N.º de factura y el detalle, y deja una fila de auditoría POR CAMPO que cambió (ninguna por los que no)", async () => {
    const op = await compra({ proveedorId: molinoId, nroFactura: "A-0001", detalleLibre: "tipeo mal" });

    const r = await corregirCompra(op.id, { proveedorId: molinoId, nroFactura: "A-0002", detalleLibre: "compra de la semana" }, vista(op));

    expect(r.ok, r.mensaje).toBe(true);
    const filas = await prisma.registroAuditoria.findMany({ where: { entidad: "Operacion", entidadId: op.id }, orderBy: { campo: "asc" } });
    expect(filas.map((f) => f.campo)).toEqual(["detalleLibre", "nroFactura"]); // el proveedor no cambió: sin fila
    const factura = filas.find((f) => f.campo === "nroFactura")!;
    expect(factura).toMatchObject({ valorAnterior: "A-0001", valorNuevo: "A-0002", actorId: adminId, sucursalId });
    expect(factura.descripcion).toContain("2026-08-10");
    expect(factura.descripcion).toContain("N.º de factura");
  });

  it("el proveedor se audita con su NOMBRE (no su id), tanto el anterior como el nuevo", async () => {
    const op = await compra({ proveedorId: molinoId });
    await corregirCompra(op.id, { proveedorId: otroProveedorId, nroFactura: "", detalleLibre: "" }, vista(op));

    const fila = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "Operacion", entidadId: op.id, campo: "proveedorId" } });
    expect(fila.valorAnterior).toBe("Molino SA");
    expect(fila.valorNuevo).toBe("Distribuidora Sur");
  });

  it("se puede borrar el N.º de factura (dejarlo vacío)", async () => {
    const op = await compra({ proveedorId: molinoId, nroFactura: "A-0001" });
    const r = await corregirCompra(op.id, { proveedorId: molinoId, nroFactura: "   ", detalleLibre: "" }, vista(op));
    expect(r.ok, r.mensaje).toBe(true);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).nroFactura).toBeNull();
  });

  describe("factura repetida", () => {
    it("se rechaza si OTRA compra vigente del mismo proveedor ya usa ese número, y no cambia nada", async () => {
      await compra({ proveedorId: molinoId, nroFactura: "A-0001" });
      const otra = await compra({ proveedorId: molinoId, nroFactura: "A-0009" });

      const r = await corregirCompra(otra.id, { proveedorId: molinoId, nroFactura: "A-0001", detalleLibre: "" }, vista(otra));

      expect(r.ok).toBe(false);
      expect(r.mensaje).toBe(MENSAJE_FACTURA_DUPLICADA);
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: otra.id } })).nroFactura).toBe("A-0009");
      expect(await prisma.registroAuditoria.count({ where: { entidad: "Operacion" } })).toBe(0);
    });

    it("el MISMO número con OTRO proveedor no es un choque", async () => {
      await compra({ proveedorId: molinoId, nroFactura: "A-0001" });
      const otra = await compra({ proveedorId: otroProveedorId, nroFactura: "B-0001" });
      const r = await corregirCompra(otra.id, { proveedorId: otroProveedorId, nroFactura: "A-0001", detalleLibre: "" }, vista(otra));
      expect(r.ok, r.mensaje).toBe(true);
    });

    it("cambiar el PROVEEDOR de una compra a uno que ya tiene ese número también choca", async () => {
      await compra({ proveedorId: otroProveedorId, nroFactura: "A-0001" });
      const op = await compra({ proveedorId: molinoId, nroFactura: "A-0001" });
      const r = await corregirCompra(op.id, { proveedorId: otroProveedorId, nroFactura: "A-0001", detalleLibre: "" }, vista(op));
      expect(r.ok).toBe(false);
      expect(r.mensaje).toBe(MENSAJE_FACTURA_DUPLICADA);
    });

    it("el número de una compra ANULADA queda libre: se puede usar en otra", async () => {
      const vieja = await compra({ proveedorId: molinoId, nroFactura: "A-0001" });
      expect((await anularCompra(vieja.id)).ok).toBe(true);
      const otra = await compra({ proveedorId: molinoId, nroFactura: "A-0009" });

      const r = await corregirCompra(otra.id, { proveedorId: molinoId, nroFactura: "A-0001", detalleLibre: "" }, vista(otra));
      expect(r.ok, r.mensaje).toBe(true);
    });

    it("una compra sin proveedor no se compara con nada (como en la carga): dos «sin proveedor» con el mismo número conviven", async () => {
      await compra({ nroFactura: "S-1" });
      const otra = await compra({ nroFactura: "S-2" });
      const r = await corregirCompra(otra.id, { proveedorId: null, nroFactura: "S-1", detalleLibre: "" }, vista(otra));
      expect(r.ok, r.mensaje).toBe(true);
    });

    it("la corrección ocupa el número: después no se puede cargar otra compra con ese proveedor y factura", async () => {
      const op = await compra({ proveedorId: molinoId });
      expect((await corregirCompra(op.id, { proveedorId: molinoId, nroFactura: "N-77", detalleLibre: "" }, vista(op))).ok).toBe(true);

      const carga = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, proveedorId: molinoId, nroFactura: "N-77", items: [{ productoId: harinaId, cantidad: 1, precioTotal: 10 }] });
      expect(carga.ok).toBe(false);
      expect(carga.mensaje).toBe(MENSAJE_FACTURA_DUPLICADA);
    });
  });

  describe("guardas", () => {
    it("una compra ANULADA no se corrige", async () => {
      const op = await compra({ proveedorId: molinoId, nroFactura: "A-0001" });
      await anularCompra(op.id);
      const anulada = await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } });

      const r = await corregirCompra(op.id, { proveedorId: molinoId, nroFactura: "A-0002", detalleLibre: "" }, vista(anulada));
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("anulada");
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).nroFactura).toBe("A-0001");
    });

    it("guarda optimista: si la compra cambió mientras se editaba, no se pisa y se avisa", async () => {
      const op = await compra({ proveedorId: molinoId, nroFactura: "A-0001" });
      const vistaVieja = vista(op);
      // Otra persona la corrige primero.
      expect((await corregirCompra(op.id, { proveedorId: molinoId, nroFactura: "A-0002", detalleLibre: "" }, vistaVieja)).ok).toBe(true);

      // La primera persona, con lo que veía antes, intenta otra cosa.
      const r = await corregirCompra(op.id, { proveedorId: otroProveedorId, nroFactura: "A-0001", detalleLibre: "" }, vistaVieja);

      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("cambió mientras la editabas");
      const guardada = await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } });
      expect(guardada.nroFactura).toBe("A-0002");
      expect(guardada.proveedorId).toBe(molinoId);
    });

    it("es idempotente: reenviar la misma corrección (se perdió la respuesta) no falla ni duplica la auditoría", async () => {
      const op = await compra({ proveedorId: molinoId, nroFactura: "A-0001" });
      const vistaOriginal = vista(op);
      const pedido = { proveedorId: molinoId, nroFactura: "A-0002", detalleLibre: "" };

      expect((await corregirCompra(op.id, pedido, vistaOriginal)).ok).toBe(true);
      const reenvio = await corregirCompra(op.id, pedido, vistaOriginal);

      expect(reenvio.ok, reenvio.mensaje).toBe(true);
      expect(reenvio.mensaje).toContain("nada que corregir");
      expect(await prisma.registroAuditoria.count({ where: { entidad: "Operacion", entidadId: op.id } })).toBe(1);
    });

    it("sin ningún cambio no escribe nada", async () => {
      const op = await compra({ proveedorId: molinoId, nroFactura: "A-0001", detalleLibre: "nota" });
      const r = await corregirCompra(op.id, { proveedorId: molinoId, nroFactura: "A-0001", detalleLibre: "nota" }, vista(op));
      expect(r.ok).toBe(true);
      expect(r.mensaje).toContain("nada que corregir");
      expect(await prisma.registroAuditoria.count()).toBe(0);
    });

    it("un proveedor inactivo o inexistente se rechaza", async () => {
      const op = await compra({ proveedorId: molinoId });
      const inactivo = await prisma.proveedor.create({ data: { codigo: "PRV_3", nombre: "Ya no existe SA", activo: false } });

      const a = await corregirCompra(op.id, { proveedorId: inactivo.id, nroFactura: "", detalleLibre: "" }, vista(op));
      expect(a.ok).toBe(false);
      expect(a.mensaje).toContain("inactivo");

      const b = await corregirCompra(op.id, { proveedorId: "no-existe", nroFactura: "", detalleLibre: "" }, vista(op));
      expect(b.ok).toBe(false);
      expect(b.mensaje).toContain("no existe");
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).proveedorId).toBe(molinoId);
    });

    it("un proveedor que ya estaba en la compra y hoy está inactivo no traba corregir OTRO campo", async () => {
      const op = await compra({ proveedorId: molinoId, nroFactura: "A-0001" });
      await prisma.proveedor.update({ where: { id: molinoId }, data: { activo: false } });
      const r = await corregirCompra(op.id, { proveedorId: molinoId, nroFactura: "A-0002", detalleLibre: "" }, vista(op));
      expect(r.ok, r.mensaje).toBe(true);
    });

    it("un N.º de factura de más de 60 caracteres se rechaza; un detalle viejo largo que no se toca no traba la corrección", async () => {
      const larga = "x".repeat(300);
      const op = await compra({ proveedorId: molinoId, nroFactura: "A-0001", detalleLibre: larga });

      const a = await corregirCompra(op.id, { proveedorId: molinoId, nroFactura: "y".repeat(61), detalleLibre: larga }, vista(op));
      expect(a.ok).toBe(false);
      expect(a.mensaje).toContain("60 caracteres");

      const b = await corregirCompra(op.id, { proveedorId: molinoId, nroFactura: "A-0002", detalleLibre: larga }, vista(op));
      expect(b.ok, b.mensaje).toBe(true);
    });

    it("una compra de OTRA sucursal no se puede corregir solo conociendo su id", async () => {
      const otra = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
      const ajena = await prisma.operacion.create({ data: { sucursalId: otra.id, proceso: "COMPRA", fecha: new Date(), usuarioId: adminId, nroFactura: "AJENA-1" } });

      const r = await corregirCompra(ajena.id, { proveedorId: molinoId, nroFactura: "HACKEADA", detalleLibre: "" }, vista(ajena));
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("No se encontró");
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: ajena.id } })).nroFactura).toBe("AJENA-1");
    });

    it("una operación que no es una Compra no se corrige con esta acción", async () => {
      const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: adminId } });
      const r = await corregirCompra(venta.id, { proveedorId: molinoId, nroFactura: "X", detalleLibre: "" }, vista(venta));
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("no es una Compra");
    });

    it("sin el permiso corregir_compra (el operador arranca sin él) no se puede, y no se escribe nada", async () => {
      const op = await compra({ proveedorId: molinoId, nroFactura: "A-0001" });
      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });

      const r = await corregirCompra(op.id, { proveedorId: molinoId, nroFactura: "A-0002", detalleLibre: "" }, vista(op));

      expect(r.ok).toBe(false);
      expect((await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).nroFactura).toBe("A-0001");
      expect(await prisma.registroAuditoria.count()).toBe(0);
    });
  });

  describe("concurrencia", () => {
    it("dos correcciones simultáneas que dejarían el MISMO par proveedor + N.º de factura en dos compras distintas: exactamente una gana, ninguna llamada rechaza", async () => {
      for (let i = 0; i < 5; i++) {
        const a = await compra({ proveedorId: molinoId });
        const b = await compra({ proveedorId: molinoId });
        const factura = `CONC-${i}`;

        const settled = await Promise.allSettled([
          corregirCompra(a.id, { proveedorId: molinoId, nroFactura: factura, detalleLibre: "" }, vista(a)),
          corregirCompra(b.id, { proveedorId: molinoId, nroFactura: factura, detalleLibre: "" }, vista(b)),
        ]);

        expect(settled.every((s) => s.status === "fulfilled"), `iteración ${i}: ninguna llamada debe rechazar: ${JSON.stringify(settled)}`).toBe(true);
        const resultados = settled.map((s) => (s.status === "fulfilled" ? s.value : { ok: false, mensaje: "rejected" }));
        expect(resultados.filter((r) => r.ok), `iteración ${i}: exactamente una corrección exitosa`).toHaveLength(1);
        expect(resultados.find((r) => !r.ok)?.mensaje).toBe(MENSAJE_FACTURA_DUPLICADA);
        expect(await prisma.operacion.count({ where: { proveedorId: molinoId, nroFactura: factura, anuladaEn: null } }), `iteración ${i}: una sola con ese número`).toBe(1);
      }
    });
  });
});
