import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarProducto, type DatosProducto } from "../../src/server/actions/catalogo/productos";
import { actualizarProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/actualizar-producto";
import { guardComandoDatosDeProducto } from "../../src/core/features/catalogo/productos.guard";
import { generarReporteConsignacion } from "../../src/server/consultas/reportes/consignacion";

/**
 * S-05 (plan de endurecimiento de seguridad, tanda T2; B-B3 del informe B; decisión CAT-1 del dueño). Un operador con `producto_editar` (piso operario) cambiaba el
 * FACTOR de conversión, la UNIDAD de stock, el consignante y el resto de lo que da significado a las cantidades y a la deuda SIN dejar rastro (la edición solo
 * auditaba el precio de venta, el de consignación y el paso de venta), y la deuda histórica de consignación pasaba al consignante nuevo (el reporte atribuye cada
 * liquidación al consignante ACTUAL del producto). Ahora:
 *  1. cada una de esas columnas deja su fila de auditoría (`factorConversion`, `unidadStockId`, `unidadCompraId`, `esConsignacion`, `proveedorConsignacionId`, `seProduce`);
 *  2. CAT-1: la unidad de stock es inmutable una vez que el producto tiene historia (movimientos, recetas, presentaciones, vínculo con un proveedor, y lo que
 *     guarda una cantidad en esa unidad: conteos, traspasos y líneas de cuenta), igual que el tipo; sin historia se puede seguir corrigiendo;
 *  3. el consignante (y el «es consignación») no se cambian si el producto ya tiene liquidaciones.
 */
describe("S-05: factor, unidad y consignante de un producto", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let operadorId: string;
  let sinClaveId: string;
  let kgId: string;
  let gId: string;
  let proveedorAId: string;
  let proveedorBId: string;
  let quesoId: string;

  const actor = (usuarioId: string) => ({ usuarioId, sucursalId, ahora: new Date(), ...baseDeTest });

  /** Los datos que el formulario manda para dejar el producto TAL COMO ESTÁ (un control: no cambia nada), con los cambios pedidos encima. */
  async function datos(cambios: Partial<DatosProducto> = {}): Promise<DatosProducto> {
    const p = await prisma.producto.findUniqueOrThrow({ where: { id: quesoId } });
    return {
      nombre: p.nombre,
      tipo: p.tipo,
      unidadStockId: p.unidadStockId,
      unidadCompraId: p.unidadCompraId,
      factorConversion: Number(p.factorConversion),
      precioVenta: Number(p.precioVenta),
      seProduce: p.seProduce,
      esConsignacion: p.esConsignacion,
      proveedorConsignacionId: p.proveedorConsignacionId,
      precioConsignacion: Number(p.precioConsignacion ?? 0),
      ...cambios,
    };
  }

  const comoOperador = () => mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
  // El costo de consignación (es consignación, proveedor y precio) es de quien tiene `pagar_consignante` (S-12): las pruebas que lo cambian actúan como administrador.
  const comoAdmin = () => mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
  // M.2: estas pruebas son de la auditoría y de la historia, no del permiso: el comando se arma con las claves finas concedidas (consignación y campos sensibles); el permiso de campos sensibles lo prueba `campos-sensibles-del-producto.test.ts`.
  const comando = (datosDelFormulario: DatosProducto) => ({
    productoId: quesoId,
    datos: datosDelFormulario,
    puerta: guardComandoDatosDeProducto({ datos: datosDelFormulario }),
    puedeGestionarConsignacion: true,
    puedeEditarCamposSensibles: true,
  });
  const filas = async (campo: string) => prismaAdmin.registroAuditoria.findMany({ where: { entidad: "Producto", entidadId: quesoId, campo } });
  const unidadDelProducto = async () => (await prisma.producto.findUniqueOrThrow({ where: { id: quesoId } })).unidadStockId;

  async function operacionConLinea(proceso: "COMPRA" | "VENTA", linea: { proceso?: "VENTA" | "LIQUIDACION_CONSIGNACION"; cantidad: number; precioTotal: number }) {
    const op = await prisma.operacion.create({ data: { sucursalId, proceso, fecha: new Date(), usuarioId: adminId } });
    await prisma.movimientoStock.create({
      data: {
        operacionId: op.id,
        productoId: quesoId,
        seccionId,
        proceso: linea.proceso ?? proceso,
        cantidad: linea.cantidad,
        detalle: "x",
        precioTotal: linea.precioTotal,
        precioPorUnidadStock: linea.precioTotal,
      },
    });
  }

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
    // M.2: cambiar el factor y las unidades exige `producto_campos_sensibles` (semilla solo admin). Estas pruebas son de la AUDITORÍA y de la HISTORIA de esos cambios, así que el rol «operador» de
    // este archivo actúa con la clave delegada por configuración (una fila de PermisoRol), como un encargado de precios. El ataque original («el operador de fábrica cambia el factor») ahora lo
    // frena la clave y se prueba en `campos-sensibles-del-producto.test.ts`; acá, `sinClaveId` (solo producto_editar) fija que ese rechazo le gana al de la historia.
    await prisma.permisoRol.update({ where: { rolId_accionClave: { rolId: base.operador.id, accionClave: "producto_campos_sensibles" } }, data: { puedeVer: true, puedeEditar: true } });
    const editor = await prisma.rol.create({ data: { nombre: "Editor" } });
    await prisma.permisoRol.create({ data: { rolId: editor.id, accionClave: "producto_editar", puedeVer: true, puedeEditar: true } });
    sinClaveId = (await crearUsuarioConMembresia({ email: "editor@test.com", sucursalId, rolId: editor.id })).id;
    proveedorAId = (await prisma.proveedor.create({ data: { codigo: "PROV_A", nombre: "Lácteos A" } })).id;
    proveedorBId = (await prisma.proveedor.create({ data: { codigo: "PROV_B", nombre: "Lácteos B" } })).id;
    quesoId = (
      await sembrarProductoDisponible(
        {
          codigo: "MP_QUESO",
          nombre: "Queso",
          tipo: "MP",
          unidadStockId: kgId,
          unidadCompraId: gId,
          factorConversion: 25,
          esConsignacion: true,
          proveedorConsignacionId: proveedorAId,
          precioConsignacion: 30,
        },
        sucursalId,
      )
    ).id;
    await comoOperador();
  });

  describe("auditoría por columna (antes: ninguna fila)", () => {
    it("EL ATAQUE: el operador cambia el factor de 25 a 20 y queda la fila con el anterior y el nuevo", async () => {
      expect((await actualizarProducto(quesoId, await datos({ factorConversion: 20 }))).ok).toBe(true);
      const f = await filas("factorConversion");
      expect(f).toHaveLength(1);
      expect(f[0]).toMatchObject({ valorAnterior: "25", valorNuevo: "20", actorId: operadorId, sucursalId: null });
    });

    type CasoDeColumna = [campo: string, cambios: () => Partial<DatosProducto>, anterior: () => string, nuevo: () => string, esDeConsignacion: boolean];
    const COLUMNAS: CasoDeColumna[] = [
      ["unidadStockId", () => ({ unidadStockId: gId }), () => kgId, () => gId, false],
      ["unidadCompraId", () => ({ unidadCompraId: kgId }), () => gId, () => kgId, false],
      ["seProduce", () => ({ seProduce: true }), () => "false", () => "true", false],
      ["proveedorConsignacionId", () => ({ proveedorConsignacionId: proveedorBId }), () => proveedorAId, () => proveedorBId, true],
      ["esConsignacion", () => ({ esConsignacion: false, proveedorConsignacionId: null }), () => "true", () => "false", true],
    ];
    it.each(COLUMNAS)("cambiar %s deja una fila con el anterior y el nuevo", async (campo, cambios, anterior, nuevo, esDeConsignacion) => {
      if (esDeConsignacion) await comoAdmin();
      expect((await actualizarProducto(quesoId, await datos(cambios()))).ok).toBe(true);
      const f = await filas(campo);
      expect(f).toHaveLength(1);
      expect(f[0]).toMatchObject({ valorAnterior: anterior(), valorNuevo: nuevo(), actorId: esDeConsignacion ? adminId : operadorId });
    });

    it("la descripción de la unidad dice los nombres (se lee en la pantalla de auditoría)", async () => {
      expect((await actualizarProducto(quesoId, await datos({ unidadStockId: gId }))).ok).toBe(true);
      const [fila] = await filas("unidadStockId");
      expect(fila!.descripcion).toContain("Queso");
      expect(fila!.descripcion).toContain("kg");
      expect(fila!.descripcion).toContain("g");
    });

    it("control: guardar sin tocar nada de eso no deja ninguna de esas filas", async () => {
      expect((await actualizarProducto(quesoId, await datos({ nombre: "Queso cremoso" }))).ok).toBe(true);
      for (const campo of ["factorConversion", "unidadStockId", "unidadCompraId", "seProduce", "proveedorConsignacionId", "esConsignacion"]) expect(await filas(campo), campo).toHaveLength(0);
    });
  });

  describe("CAT-1: la unidad de stock es inmutable con historia", () => {
    const FUENTES: [string, () => Promise<void>][] = [
      ["un movimiento de stock", () => operacionConLinea("COMPRA", { cantidad: 2, precioTotal: 10 })],
      ["una presentación de compra", async () => void (await prisma.presentacion.create({ data: { productoId: quesoId, unidadCompraId: kgId, factorConversion: 10 } }))],
      [
        "el vínculo con un proveedor",
        async () => void (await prisma.proveedorPorProducto.create({ data: { productoId: quesoId, proveedorId: proveedorAId, unidadCompraId: gId, precioUnitario: 1, precioPorUnidadStock: 1 } })),
      ],
      ["una versión de su receta", async () => void (await prisma.recetaVersion.create({ data: { productoId: quesoId, version: 1 } }))],
      [
        "ser ingrediente de la receta de otro producto",
        async () => {
          const plato = await prisma.producto.create({ data: { codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: kgId } });
          const version = await prisma.recetaVersion.create({ data: { productoId: plato.id, version: 1 } });
          await prisma.recetaIngrediente.create({ data: { recetaVersionId: version.id, insumoProductoId: quesoId, cantidad: 1, unidadId: kgId } });
        },
      ],
      ["la receta de una sucursal", async () => void (await prisma.recetaSucursal.create({ data: { sucursalId, productoId: quesoId } }))],
      [
        "un conteo físico",
        async () =>
          void (await prisma.conteoFisico.create({
            data: { sucursalId, fecha: new Date(), productoId: quesoId, seccionId, saldoSistema: 0, conteoReal: 0, diferencia: 0, accion: "DESCARTAR", estado: "DESCARTADO", usuarioId: adminId },
          })),
      ],
      [
        "un traspaso",
        async () => {
          const destino = await prisma.sucursal.create({ data: { nombre: "Sucursal 2" } });
          await prisma.traspasoSucursal.create({
            data: { origenSucursalId: sucursalId, destinoSucursalId: destino.id, productoId: quesoId, cantidad: 1, iniciadoPor: "ORIGEN", creadoPorId: adminId },
          });
        },
      ],
      [
        "una línea de cuenta",
        async () => {
          const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 1 } });
          const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: adminId } });
          await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: quesoId, cantidad: 1, precioUnitario: 100 } });
        },
      ],
      // M-4 (auditoría intermedia): un mínimo cargado cambia de significado con la unidad (5 kg pasarían a ser 5 g), aunque el producto no tenga ningún movimiento.
      ["un stock mínimo cargado", async () => void (await prisma.stockMinimoProducto.create({ data: { sucursalId, productoId: quesoId, minimo: 5 } }))],
    ];

    it.each(FUENTES)("con %s, cambiar la unidad de stock se rechaza (UNIDAD_CON_HISTORIA) y no escribe nada", async (_nombre, sembrar) => {
      await sembrar();
      const r = await actualizarProductoCasoDeUso(actor(operadorId), comando(await datos({ unidadStockId: gId })));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.codigo).toBe("UNIDAD_CON_HISTORIA");
      expect(r.mensaje).toContain("unidad de stock");
      expect(await unidadDelProducto()).toBe(kgId);
      expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "Producto", entidadId: quesoId } })).toBe(0);
      // Por la acción pública, el mismo rechazo (lo que ve el operador).
      expect((await actualizarProducto(quesoId, await datos({ unidadStockId: gId }))).ok).toBe(false);
      expect(await unidadDelProducto()).toBe(kgId);
      // M.2: quien NO tiene la clave fina recibe el rechazo de la clave y no el de la historia (la clave va antes: no se entera de si el producto tiene historia).
      await mockearUsuarioActual({ id: sinClaveId, email: "editor@test.com", nombre: null });
      const sinClave = await actualizarProducto(quesoId, await datos({ unidadStockId: gId }));
      expect(sinClave.ok).toBe(false);
      expect(sinClave.mensaje).toContain("No tenés permiso para cambiar el precio de venta");
      expect(sinClave.mensaje).not.toContain("historia");
      expect(await unidadDelProducto()).toBe(kgId);
      await comoOperador();
    });

    it.each(FUENTES)("control: con %s, guardar con la MISMA unidad (y cambiar el factor, que se audita) sigue andando", async (_nombre, sembrar) => {
      await sembrar();
      expect((await actualizarProducto(quesoId, await datos({ factorConversion: 20, nombre: "Queso cremoso" }))).ok).toBe(true);
      expect(await unidadDelProducto()).toBe(kgId);
      expect(await filas("factorConversion")).toHaveLength(1);
    });

    it("sin historia, corregir la unidad sigue andando (se creó con la unidad equivocada y nadie la usó)", async () => {
      expect((await actualizarProducto(quesoId, await datos({ unidadStockId: gId }))).ok).toBe(true);
      expect(await unidadDelProducto()).toBe(gId);
    });
  });

  describe("el consignante no se cambia con liquidaciones", () => {
    async function conLiquidacion() {
      await operacionConLinea("VENTA", { proceso: "LIQUIDACION_CONSIGNACION", cantidad: 0, precioTotal: 30 });
    }
    const consignanteDelProducto = async () => (await prisma.producto.findUniqueOrThrow({ where: { id: quesoId } })).proveedorConsignacionId;
    const debidoA = async () => (await generarReporteConsignacion(sucursalId, prisma)).debidoPorConsignante.map((d) => ({ proveedor: d.proveedor, liquidado: d.liquidado }));
    // Lo que se prueba acá es el bloqueo por HISTORIA, no el permiso: quien intenta cambiar el consignante es el administrador (S-12 ya frena al operador).
    beforeEach(comoAdmin);

    it("EL ATAQUE: con una liquidación, pasar el producto de A a B se rechaza (CONSIGNANTE_CON_HISTORIA) y la deuda sigue siendo de A", async () => {
      await conLiquidacion();
      expect(await debidoA()).toEqual([{ proveedor: "Lácteos A", liquidado: 30 }]);

      const r = await actualizarProductoCasoDeUso(actor(adminId), comando(await datos({ proveedorConsignacionId: proveedorBId })));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.codigo).toBe("CONSIGNANTE_CON_HISTORIA");
      expect((await actualizarProducto(quesoId, await datos({ proveedorConsignacionId: proveedorBId }))).ok).toBe(false);

      expect(await consignanteDelProducto()).toBe(proveedorAId);
      expect(await debidoA()).toEqual([{ proveedor: "Lácteos A", liquidado: 30 }]);
      expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "Producto", entidadId: quesoId } })).toBe(0);
    });

    it("con una liquidación, dejar de ser consignación también se rechaza (la deuda caería en «sin proveedor»)", async () => {
      await conLiquidacion();
      const r = await actualizarProductoCasoDeUso(actor(adminId), comando(await datos({ esConsignacion: false, proveedorConsignacionId: null })));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.codigo).toBe("CONSIGNANTE_CON_HISTORIA");
      expect((await prisma.producto.findUniqueOrThrow({ where: { id: quesoId } })).esConsignacion).toBe(true);
    });

    it("con una liquidación, lo demás (el precio de consignación, el nombre) sigue andando: solo el consignante está bloqueado", async () => {
      await conLiquidacion();
      expect((await actualizarProducto(quesoId, await datos({ precioConsignacion: 35, nombre: "Queso cremoso" }))).ok).toBe(true);
      expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id: quesoId } })).precioConsignacion)).toBe(35);
    });

    it("sin liquidaciones (solo stock o compras) el consignante se puede corregir, y queda auditado", async () => {
      await operacionConLinea("COMPRA", { cantidad: 2, precioTotal: 10 });
      expect((await actualizarProducto(quesoId, await datos({ proveedorConsignacionId: proveedorBId }))).ok).toBe(true);
      expect(await consignanteDelProducto()).toBe(proveedorBId);
      expect(await filas("proveedorConsignacionId")).toHaveLength(1);
    });
  });
});
