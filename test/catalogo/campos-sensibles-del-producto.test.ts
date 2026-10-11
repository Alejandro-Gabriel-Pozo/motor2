import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { actualizarProducto, type DatosProducto } from "../../src/server/actions/catalogo/productos";
import { actualizarProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/actualizar-producto";
import { guardComandoDatosDeProducto } from "../../src/core/features/catalogo/productos.guard";

/**
 * M.2 (P2) — la clave fina `producto_campos_sensibles` en la EDICIÓN de un producto. Hasta acá cualquiera con `producto_editar` (piso operario) cambiaba el precio de venta,
 * el factor de conversión y las unidades de stock y de compra: lo que da significado a las cantidades y al dinero. Ahora cambiar uno de esos cuatro campos exige además la clave
 * fina; el resto de la edición (el nombre, la categoría, las observaciones…) sigue siendo de `producto_editar` solo.
 *
 * Se decide en el servidor, contra la fila leída DENTRO de la transacción y con los valores NORMALIZADOS (los que se escribirían): mandar el mismo valor no es un cambio, y un campo
 * AUSENTE no es «ponelo en cero / borralo» sino «queda como estaba» (el formulario arma un FormData y un input deshabilitado no viaja).
 */
describe("M.2: precio, factor y unidades de un producto son de quien tiene producto_campos_sensibles", () => {
  const PRECIO = 500;
  const MENSAJE = "No tenés permiso para cambiar el precio de venta, el factor de conversión ni las unidades del producto.";
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let operadorId: string;
  let soloEditarId: string;
  let conClaveId: string;
  let kgId: string;
  let gId: string;
  let quesoId: string;

  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const comoOperador = () => como(operadorId, "operador@test.com");
  const comoSoloEditar = () => como(soloEditarId, "editor@test.com");

  /** Los datos que el formulario manda para dejar el producto TAL COMO ESTÁ, con los cambios pedidos encima. */
  async function datos(cambios: Partial<DatosProducto> = {}): Promise<DatosProducto> {
    const p = await prisma.producto.findUniqueOrThrow({ where: { id: quesoId } });
    return {
      nombre: p.nombre,
      tipo: p.tipo,
      unidadStockId: p.unidadStockId,
      unidadCompraId: p.unidadCompraId,
      factorConversion: Number(p.factorConversion),
      precioVenta: Number(p.precioVenta),
      ...cambios,
    };
  }
  /** Los datos SIN las claves pedidas (un FormData con el input deshabilitado: el campo no viaja). */
  async function datosSin(...campos: (keyof DatosProducto)[]): Promise<DatosProducto> {
    const d = (await datos({ nombre: "Queso cremoso" })) as unknown as Record<string, unknown>;
    for (const c of campos) delete d[c];
    return d as unknown as DatosProducto;
  }
  const guardado = async () => {
    const p = await prisma.producto.findUniqueOrThrow({ where: { id: quesoId } });
    return { nombre: p.nombre, precioVenta: Number(p.precioVenta), factorConversion: Number(p.factorConversion), unidadStockId: p.unidadStockId, unidadCompraId: p.unidadCompraId };
  };
  const ORIGINAL = () => ({ nombre: "Queso", precioVenta: PRECIO, factorConversion: 25, unidadStockId: kgId, unidadCompraId: gId });
  const auditorias = (campo?: string) => prismaAdmin.registroAuditoria.count({ where: { entidad: "Producto", entidadId: quesoId, ...(campo ? { campo } : {}) } });

  const actor = (usuarioId: string) => ({ usuarioId, sucursalId, ahora: new Date(), ...baseDeTest });
  const comando = (datosDelFormulario: DatosProducto, opciones: { sensibles: boolean; consignacion?: boolean }) => ({
    productoId: quesoId,
    datos: datosDelFormulario,
    puerta: guardComandoDatosDeProducto({ datos: datosDelFormulario }),
    puedeGestionarConsignacion: opciones.consignacion ?? true,
    puedeEditarCamposSensibles: opciones.sensibles,
  });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    gId = catalogo.g.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
    // Un rol propio con SOLO producto_editar (sin la clave fina) y otro que además la tiene (la delegó el gerente por configuración).
    const editor = await prisma.rol.create({ data: { nombre: "Editor" } });
    await prisma.permisoRol.create({ data: { rolId: editor.id, accionClave: "producto_editar", puedeVer: true, puedeEditar: true } });
    soloEditarId = (await crearUsuarioConMembresia({ email: "editor@test.com", sucursalId, rolId: editor.id })).id;
    const precios = await prisma.rol.create({ data: { nombre: "Precios" } });
    for (const accionClave of ["producto_editar", "producto_campos_sensibles"]) {
      await prisma.permisoRol.create({ data: { rolId: precios.id, accionClave, puedeVer: true, puedeEditar: true } });
    }
    conClaveId = (await crearUsuarioConMembresia({ email: "precios@test.com", sucursalId, rolId: precios.id })).id;
    quesoId = (
      await sembrarProductoDisponible({ codigo: "MP_QUESO", nombre: "Queso", tipo: "MP", unidadStockId: kgId, unidadCompraId: gId, factorConversion: 25, precioVenta: PRECIO }, sucursalId)
    ).id;
    await comoOperador();
  });

  describe("EL ATAQUE: sin la clave, cambiar uno de los cuatro campos se rechaza y no escribe nada", () => {
    const ATAQUES: [string, () => Promise<Partial<DatosProducto>>][] = [
      ["el precio de venta", async () => ({ precioVenta: 1 })],
      ["el factor de conversión", async () => ({ factorConversion: 20 })],
      ["la unidad de compra", async () => ({ unidadCompraId: kgId })],
      ["la unidad de compra (borrarla)", async () => ({ unidadCompraId: null })],
      ["la unidad de stock (el producto no tiene historia)", async () => ({ unidadStockId: gId })],
    ];
    const ACTORES: [string, () => Promise<void>][] = [
      ["el operador de fábrica", comoOperador],
      ["un rol propio con solo producto_editar", comoSoloEditar],
    ];

    for (const [quien, actuar] of ACTORES) {
      it.each(ATAQUES)(`${quien} cambia %s → rechazo, fila intacta y sin auditoría nueva`, async (_campo, cambios) => {
        await actuar();
        const r = await actualizarProducto(quesoId, await datos({ nombre: "Queso cremoso", ...(await cambios()) }));
        expect(r.ok).toBe(false);
        expect(r.mensaje).toContain(MENSAJE);
        expect(r.mensaje).toContain("recargá la página");
        expect(await guardado()).toEqual(ORIGINAL());
        expect(await auditorias()).toBe(0);
      });
    }

    it("el caso de uso responde con el código SIN_PERMISO_CAMPOS_SENSIBLES", async () => {
      const r = await actualizarProductoCasoDeUso(actor(operadorId), comando(await datos({ precioVenta: 1 }), { sensibles: false }));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.codigo).toBe("SIN_PERMISO_CAMPOS_SENSIBLES");
      expect(await guardado()).toEqual(ORIGINAL());
    });

    it("el rechazo le gana a UNIDAD_CON_HISTORIA: con un movimiento, cambiar la unidad de stock dice que falta la clave, no que hay historia", async () => {
      const op = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: adminId } });
      await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId: quesoId, seccionId, proceso: "COMPRA", cantidad: 2, detalle: "x", precioTotal: 10, precioPorUnidadStock: 5 } });
      const r = await actualizarProductoCasoDeUso(actor(operadorId), comando(await datos({ unidadStockId: gId }), { sensibles: false }));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.codigo).toBe("SIN_PERMISO_CAMPOS_SENSIBLES");
      // Con la clave, la historia sí frena (la regla de siempre sigue en pie para quien la tiene).
      const conClave = await actualizarProductoCasoDeUso(actor(adminId), comando(await datos({ unidadStockId: gId }), { sensibles: true }));
      expect(conClave.ok).toBe(false);
      if (!conClave.ok) expect(conClave.codigo).toBe("UNIDAD_CON_HISTORIA");
    });

    it("el rechazo le gana a CONSIGNANTE_CON_HISTORIA: cambiar el consignante y además el precio, sin la clave fina, dice que falta la clave", async () => {
      const proveedorA = (await prisma.proveedor.create({ data: { codigo: "PROV_A", nombre: "A" } })).id;
      const proveedorB = (await prisma.proveedor.create({ data: { codigo: "PROV_B", nombre: "B" } })).id;
      await prisma.producto.update({ where: { id: quesoId }, data: { esConsignacion: true, proveedorConsignacionId: proveedorA, precioConsignacion: 30 } });
      const op = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: adminId } });
      await prisma.movimientoStock.create({
        data: { operacionId: op.id, productoId: quesoId, seccionId, proceso: "LIQUIDACION_CONSIGNACION", cantidad: 0, detalle: "x", precioTotal: 30, precioPorUnidadStock: 30 },
      });
      const base = await datos();
      const cambios = { ...base, esConsignacion: true, precioConsignacion: 30, proveedorConsignacionId: proveedorB, precioVenta: 1 };
      const sinClave = await actualizarProductoCasoDeUso(actor(operadorId), comando(cambios, { sensibles: false, consignacion: true }));
      expect(sinClave.ok).toBe(false);
      if (!sinClave.ok) expect(sinClave.codigo).toBe("SIN_PERMISO_CAMPOS_SENSIBLES");
      const conClave = await actualizarProductoCasoDeUso(actor(adminId), comando(cambios, { sensibles: true, consignacion: true }));
      expect(conClave.ok).toBe(false);
      if (!conClave.ok) expect(conClave.codigo).toBe("CONSIGNANTE_CON_HISTORIA");
    });
  });

  describe("un campo AUSENTE no es «cero» ni «borrar»: sin la clave queda como estaba", () => {
    it("el precio de venta ausente NO se convierte en 0 (antes: precioVenta ?? 0)", async () => {
      const r = await actualizarProducto(quesoId, await datosSin("precioVenta"));
      expect(r.ok).toBe(true);
      expect(await guardado()).toEqual({ ...ORIGINAL(), nombre: "Queso cremoso" });
      expect(await auditorias("precioVenta")).toBe(0);
    });

    it("la unidad de compra ausente NO se borra (antes: unidadCompraId || null)", async () => {
      const r = await actualizarProducto(quesoId, await datosSin("unidadCompraId"));
      expect(r.ok).toBe(true);
      expect(await guardado()).toEqual({ ...ORIGINAL(), nombre: "Queso cremoso" });
      expect(await auditorias("unidadCompraId")).toBe(0);
    });

    it("el factor y la unidad de stock ausentes toman los guardados", async () => {
      const r = await actualizarProducto(quesoId, await datosSin("factorConversion", "unidadStockId"));
      expect(r.ok).toBe(true);
      expect(await guardado()).toEqual({ ...ORIGINAL(), nombre: "Queso cremoso" });
    });

    it("los cuatro ausentes a la vez, desde un rol propio con solo producto_editar", async () => {
      await comoSoloEditar();
      const r = await actualizarProducto(quesoId, await datosSin("precioVenta", "unidadCompraId", "factorConversion", "unidadStockId"));
      expect(r.ok).toBe(true);
      expect(await guardado()).toEqual({ ...ORIGINAL(), nombre: "Queso cremoso" });
    });
  });

  describe("controles: lo que sigue andando sin la clave", () => {
    it("cambiar solo el nombre", async () => {
      const r = await actualizarProducto(quesoId, await datos({ nombre: "Queso cremoso" }));
      expect(r.ok).toBe(true);
      expect(await guardado()).toEqual({ ...ORIGINAL(), nombre: "Queso cremoso" });
    });

    it("mandar los MISMOS valores no es un cambio (un cliente que reenvía todo el formulario)", async () => {
      expect((await actualizarProducto(quesoId, await datos())).ok).toBe(true);
      expect(await guardado()).toEqual(ORIGINAL());
      expect(await auditorias()).toBe(0);
    });

    it("mandar el mismo precio escrito de otra forma (500.00) tampoco es un cambio: se compara lo normalizado", async () => {
      expect((await actualizarProducto(quesoId, await datos({ precioVenta: 500.0, nombre: "Queso cremoso" }))).ok).toBe(true);
      expect((await guardado()).precioVenta).toBe(PRECIO);
    });
  });

  describe("controles: quien tiene la clave", () => {
    it("el administrador cambia el precio, el factor y la unidad de compra, y queda auditado", async () => {
      await como(adminId, "admin@test.com");
      const r = await actualizarProducto(quesoId, await datos({ precioVenta: 600, factorConversion: 20, unidadCompraId: kgId }));
      expect(r.ok).toBe(true);
      expect(await guardado()).toEqual({ ...ORIGINAL(), precioVenta: 600, factorConversion: 20, unidadCompraId: kgId });
      for (const campo of ["precioVenta", "factorConversion", "unidadCompraId"]) expect(await auditorias(campo), campo).toBe(1);
    });

    it("un rol propio CON la clave (delegada por configuración) también puede", async () => {
      await como(conClaveId, "precios@test.com");
      expect((await actualizarProducto(quesoId, await datos({ precioVenta: 700 }))).ok).toBe(true);
      expect((await guardado()).precioVenta).toBe(700);
      expect(await auditorias("precioVenta")).toBe(1);
    });

    it("un usuario con la clave en UNA sola de sus membresías (en la otra sucursal su rol no la tiene) la ejerce: es una clave de empresa", async () => {
      const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      const mixto = await crearUsuarioConMembresia({ email: "mixto@test.com", sucursalId, rolId: (await prisma.rol.findFirstOrThrow({ where: { nombre: "Editor" } })).id });
      await crearMembresia({ usuarioId: mixto.id, sucursalId: norte.id, rolId: (await prisma.rol.findFirstOrThrow({ where: { nombre: "Precios" } })).id });
      await como(mixto.id, "mixto@test.com");
      expect((await actualizarProducto(quesoId, await datos({ precioVenta: 800 }))).ok).toBe(true);
      expect((await guardado()).precioVenta).toBe(800);
    });

    it("la clave NO reemplaza a producto_editar: sin ella, ni siquiera quien tiene la clave fina edita", async () => {
      const soloClave = await prisma.rol.create({ data: { nombre: "SoloClave" } });
      await prisma.permisoRol.create({ data: { rolId: soloClave.id, accionClave: "producto_campos_sensibles", puedeVer: true, puedeEditar: true } });
      const u = await crearUsuarioConMembresia({ email: "soloclave@test.com", sucursalId, rolId: soloClave.id });
      await como(u.id, "soloclave@test.com");
      expect((await actualizarProducto(quesoId, await datos({ precioVenta: 700 }))).ok).toBe(false);
      expect(await guardado()).toEqual(ORIGINAL());
    });
  });

  /**
   * M.2-A4 (B), el caso INVERSO: el formulario abierto SIN la clave no manda precio, factor ni unidades; si mientras edita le dan la clave, el servidor (ya con la clave) tiene que completar lo que no viene con lo
   * guardado, igual que sin ella. Antes rechazaba «La unidad de stock es obligatoria.» y, peor, un precio ausente se escribía como 0 (`?? 0` de `validarDatosDeProducto`). «Ausente» (`undefined`) no es «presente
   * igual» ni «presente distinto»: el rechazo de un valor que VIENE distinto, sin la clave, no cambia.
   */
  describe("M.2-A4 (B): un campo ausente CON la clave también queda como estaba", () => {
    const CAMPOS = ["precioVenta", "unidadCompraId", "factorConversion", "unidadStockId"] as const;
    const CON_CLAVE: [string, () => Promise<void>][] = [
      ["el administrador", () => como(adminId, "admin@test.com")],
      ["un rol propio con la clave delegada", () => como(conClaveId, "precios@test.com")],
    ];

    for (const [quien, actuar] of CON_CLAVE) {
      it.each(CAMPOS)(`${quien}, con %s ausente: se guarda el resto y ese campo queda como estaba (sin auditoría)`, async (campo) => {
        await actuar();
        const r = await actualizarProducto(quesoId, await datosSin(campo));
        expect(r.ok, r.mensaje).toBe(true);
        expect(await guardado()).toEqual({ ...ORIGINAL(), nombre: "Queso cremoso" });
        expect(await auditorias(campo)).toBe(0);
      });
    }

    it("los cuatro ausentes a la vez (el formulario abierto sin la clave, guardado ya con ella): se guarda el nombre y nada más", async () => {
      await como(adminId, "admin@test.com");
      const r = await actualizarProducto(quesoId, await datosSin(...CAMPOS));
      expect(r.ok, r.mensaje).toBe(true);
      expect(await guardado()).toEqual({ ...ORIGINAL(), nombre: "Queso cremoso" });
      expect(await auditorias()).toBe(0);
    });

    it("el precio ausente NO se escribe como 0 aunque quien edita tenga la clave (antes: precioVenta ?? 0)", async () => {
      await como(adminId, "admin@test.com");
      expect((await actualizarProducto(quesoId, await datosSin("precioVenta"))).ok).toBe(true);
      expect((await guardado()).precioVenta).toBe(PRECIO);
    });

    it("lo ausente toma lo guardado AHORA, no lo que el formulario vio al abrirse: si otra persona cambió el precio, se conserva el nuevo", async () => {
      await prismaAdmin.producto.update({ where: { id: quesoId }, data: { precioVenta: 650 } });
      await como(adminId, "admin@test.com");
      expect((await actualizarProducto(quesoId, await datosSin("precioVenta"))).ok).toBe(true);
      expect((await guardado()).precioVenta).toBe(650);
    });

    it("ausente no es «presente»: `null` en la unidad de compra SIGUE siendo «sin unidad de compra» para quien tiene la clave (se borra y queda auditado)", async () => {
      await como(adminId, "admin@test.com");
      expect((await actualizarProducto(quesoId, await datos({ unidadCompraId: null }))).ok).toBe(true);
      expect((await guardado()).unidadCompraId).toBeNull();
      expect(await auditorias("unidadCompraId")).toBe(1);
    });

    it("un campo PRESENTE pero vacío sigue rechazándose como siempre: la unidad de stock en blanco no se completa", async () => {
      await como(adminId, "admin@test.com");
      const r = await actualizarProducto(quesoId, await datos({ unidadStockId: "" }));
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("La unidad de stock es obligatoria.");
      expect(await guardado()).toEqual(ORIGINAL());
    });

    it("sin la clave, el valor que VIENE distinto se rechaza igual que antes, aunque otros campos sensibles vengan ausentes", async () => {
      const r = await actualizarProducto(quesoId, { ...(await datosSin("unidadCompraId", "factorConversion")), precioVenta: 1 });
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain(MENSAJE);
      expect(await guardado()).toEqual(ORIGINAL());
    });

    it("la edición con la clave y los cuatro valores presentes no cambia (control)", async () => {
      await como(adminId, "admin@test.com");
      expect((await actualizarProducto(quesoId, await datos({ nombre: "Queso cremoso", precioVenta: 600 }))).ok).toBe(true);
      expect(await guardado()).toEqual({ ...ORIGINAL(), nombre: "Queso cremoso", precioVenta: 600 });
    });
  });
});
