import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma, sembrarProductoDisponible } from "../setup/test-db";
import { crearMozo, crearUsuarioConRol, entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { abrirCuenta, corregirComensales, liberarMesa } from "../../src/server/actions/pos/cuenta-apertura";
import { agregarItems, enviarACocina, quitarItemSinEnviar } from "../../src/server/actions/pos/cuenta-pedido";
import { obtenerMapaDeMesas } from "../../src/core/pos/mesas";
import { resolverMenuCarta } from "../../src/core/carta/menu-consulta";

/** Toma de pedido (src/server/actions/pos/cuenta.ts, docs/plan-tomar-pedido-2026-09-25.md paso 4): abrir, agregar, quitar, enviar, liberar. */
describe("tomar pedido (server actions)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  const itemsDe = (cuentaId: string) => prisma.cuentaItem.findMany({ where: { cuentaId }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
  const cuentaAbiertaDe = (mesaId: string) => prisma.cuenta.findFirst({ where: { mesaId, cerradaEn: null } });

  describe("abrirCuenta", () => {
    it("abre la cuenta de una mesa libre, a nombre de quien la abre, con los comensales dados", async () => {
      expect(await abrirCuenta(s.mesa.id, 3)).toEqual({ ok: true, mensaje: "Cuenta de la mesa 4 abierta." });
      const cuenta = await cuentaAbiertaDe(s.mesa.id);
      expect(cuenta?.abiertaPorId).toBe(s.admin.id);
      expect(cuenta?.comensales).toBe(3);
    });

    it("si la mesa ya tenía una cuenta abierta, avisa sin error y no crea otra (el índice único parcial arbitra)", async () => {
      await abrirCuenta(s.mesa.id, 2);
      expect(await abrirCuenta(s.mesa.id, 5)).toEqual({ ok: true, mensaje: "La mesa 4 ya tenía una cuenta abierta." });
      expect(await prisma.cuenta.count({ where: { mesaId: s.mesa.id } })).toBe(1);
    });

    it("idempotencia: reabrir la MISMA mesa conserva los comensales de la primera apertura, aun con otro valor (o inválido) en la segunda", async () => {
      await abrirCuenta(s.mesa.id, 4);
      expect((await abrirCuenta(s.mesa.id, 99)).ok).toBe(true);
      expect((await cuentaAbiertaDe(s.mesa.id))?.comensales).toBe(4);
      // Un valor inválido en la segunda llamada tampoco falla: la idempotencia se resuelve ANTES de validar.
      expect((await abrirCuenta(s.mesa.id, 0)).ok).toBe(true);
      expect((await cuentaAbiertaDe(s.mesa.id))?.comensales).toBe(4);
    });

    it("una mesa de otra sucursal no se puede abrir", async () => {
      const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      const ajena = await prisma.mesa.create({ data: { sucursalId: norte.id, numero: 1 } });
      expect(await abrirCuenta(ajena.id, 2)).toEqual({ ok: false, mensaje: "No se encontró esa mesa en esta sucursal." });
      expect(await prisma.cuenta.count()).toBe(0);
    });

    it("comensales inválidos rechazan sin crear la cuenta (0, negativo, decimal, NaN, 100, string)", async () => {
      for (const invalido of [0, -1, 1.5, Number.NaN, 100, "2" as unknown as number]) {
        const r = await abrirCuenta(s.mesa.id, invalido);
        expect(r.ok, `comensales ${JSON.stringify(invalido)}`).toBe(false);
        expect(r.mensaje).toMatch(/comensales/);
      }
      expect(await prisma.cuenta.count()).toBe(0);
    });

    it("con la sucursal en el límite de mesas abiertas, no deja abrir otra (bloqueo en seco)", async () => {
      await prisma.sucursal.update({ where: { id: s.sucursalId }, data: { maxMesasAbiertas: 1 } });
      expect((await abrirCuenta(s.mesa.id, 2)).ok).toBe(true);
      const otraMesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
      expect(await abrirCuenta(otraMesa.id, 2)).toEqual({
        ok: false,
        mensaje: 'Se alcanzó el máximo de 1 mesas abiertas en «Central». Cerrá o liberá una antes de abrir otra.',
      });
      expect(await prisma.cuenta.count({ where: { mesaId: otraMesa.id } })).toBe(0);
    });

    it("bajar el límite por debajo de las mesas ya abiertas no cierra ninguna, solo bloquea aperturas nuevas", async () => {
      const otraMesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
      expect((await abrirCuenta(s.mesa.id, 2)).ok).toBe(true);
      expect((await abrirCuenta(otraMesa.id, 2)).ok).toBe(true);
      await prisma.sucursal.update({ where: { id: s.sucursalId }, data: { maxMesasAbiertas: 1 } });
      expect(await prisma.cuenta.count({ where: { cerradaEn: null } })).toBe(2); // ninguna se cerró sola

      const terceraMesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 6 } });
      expect((await abrirCuenta(terceraMesa.id, 2)).ok).toBe(false);
      // La MISMA mesa ya abierta reabre igual (idempotente), aunque el límite ya esté superado.
      expect((await abrirCuenta(s.mesa.id, 2)).ok).toBe(true);
    });

    it("sin límite (null, default), se puede abrir cualquier cantidad de mesas", async () => {
      expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: s.sucursalId } })).maxMesasAbiertas).toBeNull();
      for (let i = 0; i < 5; i++) {
        const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 300 + i } });
        expect((await abrirCuenta(mesa.id, 2)).ok).toBe(true);
      }
    });
  });

  describe("corregirComensales", () => {
    it("corrige los comensales de una cuenta abierta", async () => {
      await abrirCuenta(s.mesa.id, 2);
      const cuenta = (await cuentaAbiertaDe(s.mesa.id))!;
      expect(await corregirComensales(cuenta.id, 5)).toEqual({ ok: true, mensaje: "Comensales de la mesa 4 actualizados a 5." });
      expect((await cuentaAbiertaDe(s.mesa.id))?.comensales).toBe(5);
    });

    it("rechaza un valor inválido, sin tocar el valor vigente", async () => {
      await abrirCuenta(s.mesa.id, 2);
      const cuenta = (await cuentaAbiertaDe(s.mesa.id))!;
      expect((await corregirComensales(cuenta.id, 0)).ok).toBe(false);
      expect((await cuentaAbiertaDe(s.mesa.id))?.comensales).toBe(2);
    });

    it("una cuenta ya cerrada no se corrige: el dato queda congelado", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 }]);
      await prisma.cuenta.update({ where: { id: cuenta.id }, data: { cerradaEn: new Date(), comensales: 2 } });
      expect(await corregirComensales(cuenta.id, 5)).toEqual({ ok: false, mensaje: "La cuenta de la mesa 4 ya está cerrada." });
      expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).comensales).toBe(2);
    });
  });

  describe("agregarItems", () => {
    it("agrega ítems sin enviar, con quién los cargó y el precio CONGELADO (Precio Local), aunque el precio cambie después", async () => {
      await prisma.precioLocalProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.milanesa.id, precio: 9500, habilitado: true } });
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);

      const r = await agregarItems(cuenta.id, [{ productoId: s.milanesa.id, cantidad: 2 }, { productoId: s.flan.id, cantidad: 1 }]);
      expect(r).toEqual({ ok: true, mensaje: "Se agregaron 2 ítems a la mesa 4." });

      await prisma.precioLocalProducto.update({ where: { sucursalId_productoId: { sucursalId: s.sucursalId, productoId: s.milanesa.id } }, data: { precio: 11000 } });
      await prisma.producto.update({ where: { id: s.flan.id }, data: { precioVenta: 4000 } });

      const items = await itemsDe(cuenta.id);
      expect(items.map((i) => [i.productoId, Number(i.cantidad), Number(i.precioUnitario), i.numeroEnvio, i.creadoPorId])).toEqual([
        [s.milanesa.id, 2, 9500, null, s.admin.id],
        [s.flan.id, 1, 3000, null, s.admin.id],
      ]);
    });

    it("un solo ítem: mensaje en singular", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
      expect(await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1 }])).toEqual({ ok: true, mensaje: "Se agregó 1 ítem a la mesa 4." });
    });

    it("todo o nada: una materia prima (no PV) o un producto no disponible en la sucursal rechazan el lote entero", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
      const mp = await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1 }, { productoId: s.muzzarella.id, cantidad: 1 }]);
      expect(mp).toEqual({ ok: false, mensaje: "«Muzzarella» no se puede pedir: solo se piden productos de venta (PV)." });

      const noDisponible = await prisma.producto.create({ data: { codigo: "PV_OTRA", nombre: "Solo en Norte", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: 10 } });
      const r = await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1 }, { productoId: noDisponible.id, cantidad: 1 }]);
      expect(r).toEqual({ ok: false, mensaje: "«Solo en Norte» no está disponible en «Central»." });

      expect(await agregarItems(cuenta.id, [{ productoId: "no-existe", cantidad: 1 }])).toEqual({ ok: false, mensaje: "El producto no existe." });
      expect(await itemsDe(cuenta.id)).toEqual([]);
    });

    it("cantidades inválidas se rechazan; una válida se redondea a los decimales de la unidad", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
      for (const cantidad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1000, 0.2]) {
        const r = await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad }]);
        expect(r.ok, `cantidad ${cantidad}`).toBe(false);
        expect(r.mensaje).toMatch(/^«Flan»: La cantidad/);
      }
      expect(await itemsDe(cuenta.id)).toEqual([]);

      await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1.4 }]);
      expect((await itemsDe(cuenta.id)).map((i) => Number(i.cantidad))).toEqual([1]);
    });

    it("sin ítems o con más de 50 de una vez, rechaza", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
      expect(await agregarItems(cuenta.id, [])).toEqual({ ok: false, mensaje: "Elegí al menos un producto." });
      const muchos = Array.from({ length: 51 }, () => ({ productoId: s.flan.id, cantidad: 1 }));
      expect(await agregarItems(cuenta.id, muchos)).toEqual({ ok: false, mensaje: "No se pueden agregar más de 50 ítems de una vez." });
    });

    it("una cuenta de otra sucursal o ya cerrada no admite ítems", async () => {
      const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      const mesaNorte = await prisma.mesa.create({ data: { sucursalId: norte.id, numero: 1 } });
      const ajena = await sembrarCuenta(mesaNorte.id, s.admin.id);
      expect(await agregarItems(ajena.id, [{ productoId: s.flan.id, cantidad: 1 }])).toEqual({ ok: false, mensaje: "No se encontró esa cuenta en esta sucursal." });

      const cerrada = await prisma.cuenta.create({ data: { mesaId: s.mesa.id, abiertaPorId: s.admin.id, cerradaEn: new Date() } });
      expect(await agregarItems(cerrada.id, [{ productoId: s.flan.id, cantidad: 1 }])).toEqual({ ok: false, mensaje: "La cuenta de la mesa 4 ya está cerrada." });
      expect(await prisma.cuentaItem.count()).toBe(0);
    });

    describe("con un ítem agrupado de la carta (docs/plan-selector-carta-pos-2026-09-25.md)", () => {
      async function sembrarGaseosa() {
        const bebidas = await prisma.seccionCarta.create({ data: { nombre: "Bebidas", orden: 1 } });
        const coca = await sembrarProductoDisponible({ codigo: "PV_COCA", nombre: "Coca-Cola 500cc", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: 5000 }, s.sucursalId);
        const sprite = await sembrarProductoDisponible({ codigo: "PV_SPRITE", nombre: "Sprite 500cc", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: 5000 }, s.sucursalId);
        const gaseosa = await prisma.itemAgrupadoCarta.create({ data: { nombre: "Gaseosa 500cc", seccionCartaId: bebidas.id } });
        await prisma.opcionItemAgrupadoCarta.createMany({ data: [coca, sprite].map((p, orden) => ({ itemAgrupadoCartaId: gaseosa.id, productoId: p.id, orden })) });
        return { coca, sprite, gaseosa };
      }

      it("el id de un ítem agrupado no es un producto: se rechaza y no se escribe nada", async () => {
        const { gaseosa } = await sembrarGaseosa();
        const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
        expect(await agregarItems(cuenta.id, [{ productoId: gaseosa.id, cantidad: 1 }])).toEqual({ ok: false, mensaje: "El producto no existe." });
        expect(await itemsDe(cuenta.id)).toEqual([]);
      });

      it("una opción del grupo congela SU precio (con su Precio Local), aunque la carta muestre el mayor", async () => {
        const { coca, sprite, gaseosa } = await sembrarGaseosa();
        await prisma.precioLocalProducto.create({ data: { sucursalId: s.sucursalId, productoId: sprite.id, precio: 5500, habilitado: true } });
        const carta = await resolverMenuCarta(s.sucursalId);
        expect(carta?.secciones[0].items.find((i) => i.productoId === gaseosa.id)?.precio).toBe(5500);

        const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
        expect(await agregarItems(cuenta.id, [{ productoId: coca.id, cantidad: 2 }, { productoId: sprite.id, cantidad: 1 }])).toEqual({ ok: true, mensaje: "Se agregaron 2 ítems a la mesa 4." });
        expect((await itemsDe(cuenta.id)).map((i) => [i.productoId, Number(i.cantidad), Number(i.precioUnitario)])).toEqual([
          [coca.id, 2, 5000],
          [sprite.id, 1, 5500],
        ]);
      });
    });
  });

  describe("quitarItemSinEnviar", () => {
    it("un ítem sin enviar se borra de verdad, sin motivo", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 }]);
      expect(await quitarItemSinEnviar(cuenta.items[0].id)).toEqual({ ok: true, mensaje: "Se quitó «Flan» de la mesa 4." });
      expect(await itemsDe(cuenta.id)).toEqual([]);
      expect(await prisma.registroAuditoria.count()).toBe(0);
    });

    it("quitar un ítem ya enviado a cocina se rechaza: hay que anularlo con motivo", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
      expect(await quitarItemSinEnviar(cuenta.items[0].id)).toEqual({ ok: false, mensaje: "Ese ítem ya salió a cocina: anulalo con motivo." });
      expect(await itemsDe(cuenta.id)).toHaveLength(1);
    });

    it("un ítem de otra sucursal, inexistente o de una cuenta cerrada no se quita", async () => {
      expect(await quitarItemSinEnviar("no-existe")).toEqual({ ok: false, mensaje: "No se encontró ese ítem en esta sucursal." });
      const cerrada = await prisma.cuenta.create({ data: { mesaId: s.mesa.id, abiertaPorId: s.admin.id, cerradaEn: new Date(), items: { create: [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 }] } }, include: { items: true } });
      expect(await quitarItemSinEnviar(cerrada.items[0].id)).toEqual({ ok: false, mensaje: "La cuenta de la mesa 4 ya está cerrada." });
      expect(await prisma.cuentaItem.count()).toBe(1);
    });
  });

  describe("enviarACocina", () => {
    it("envía SOLO los ids dados; repetir no crea otro envío; una segunda ronda es el envío 2", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
        { productoId: s.milanesa.id, cantidad: 2, precioUnitario: 9000 },
        { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 },
      ]);
      const [mila, flan] = cuenta.items;

      expect(await enviarACocina(cuenta.id, [mila.id])).toEqual({ ok: true, mensaje: "Envío 1 a cocina: 1 ítem de la mesa 4.", numeroEnvio: 1, envioNuevo: true });
      // Repetir informa el envío en el que ya salieron, pero no como nuevo: la pantalla no vuelve a imprimirlo.
      expect(await enviarACocina(cuenta.id, [mila.id])).toEqual({ ok: true, mensaje: "Esos ítems ya estaban enviados.", numeroEnvio: 1, envioNuevo: false });
      expect((await itemsDe(cuenta.id)).map((i) => i.numeroEnvio)).toEqual([1, null]);

      await agregarItems(cuenta.id, [{ productoId: s.milanesa.id, cantidad: 1 }]);
      const nuevo = (await itemsDe(cuenta.id)).find((i) => i.numeroEnvio === null && i.id !== flan.id)!;
      expect(await enviarACocina(cuenta.id, [flan.id, nuevo.id])).toEqual({ ok: true, mensaje: "Envío 2 a cocina: 2 ítems de la mesa 4.", numeroEnvio: 2, envioNuevo: true });
      expect((await itemsDe(cuenta.id)).map((i) => i.numeroEnvio)).toEqual([1, 2, 2]);

      const [m] = (await obtenerMapaDeMesas(s.sucursalId, prisma)).mesas;
      expect(m).toMatchObject({ estado: "ocupada", pedidosEnviados: 2, productosSinEnviar: 0 });
    });

    it("ids de otra cuenta no se envían; sin ids, rechaza", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 }]);
      const otraMesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
      const otra = await sembrarCuenta(otraMesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 }]);
      expect(await enviarACocina(cuenta.id, [otra.items[0].id])).toEqual({ ok: true, mensaje: "Esos ítems ya estaban enviados.", numeroEnvio: null, envioNuevo: false });
      expect((await itemsDe(otra.id))[0].numeroEnvio).toBeNull();
      expect(await enviarACocina(cuenta.id, [])).toEqual({ ok: false, mensaje: "No hay ítems para enviar." });
    });
  });

  describe("liberarMesa", () => {
    it("una cuenta sin ningún ítem se cierra sin venta y la mesa vuelve a libre", async () => {
      await abrirCuenta(s.mesa.id, 2);
      const cuenta = (await cuentaAbiertaDe(s.mesa.id))!;
      expect(await liberarMesa(cuenta.id)).toEqual({ ok: true, mensaje: "Mesa 4 liberada." });
      const cerrada = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } });
      expect(cerrada.cerradaEn).not.toBeNull();
      expect(cerrada.cerradaPorId).toBe(s.admin.id);
      expect(await prisma.operacion.count()).toBe(0);
      expect((await obtenerMapaDeMesas(s.sucursalId, prisma)).mesas[0].estado).toBe("libre");
      expect(await liberarMesa(cuenta.id)).toEqual({ ok: false, mensaje: "La cuenta de la mesa 4 ya está cerrada." });
    });

    it("con cualquier ítem (aunque sea sin enviar) no se libera: hay que cerrar la cuenta", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 }]);
      expect(await liberarMesa(cuenta.id)).toEqual({ ok: false, mensaje: "La cuenta de la mesa 4 tiene ítems cargados: cerrá la cuenta en vez de liberar la mesa." });
      expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaEn).toBeNull();
    });
  });

  describe("permisos", () => {
    it("un rol sin pos_tomar_pedido (el operador de fábrica) no puede abrir, agregar, quitar, enviar ni liberar", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 }]);
      const operador = await prisma.user.create({ data: { email: "operador@test.com" } });
      await prisma.usuarioSucursal.create({ data: { usuarioId: operador.id, sucursalId: s.sucursalId, rolId: s.operador.id, activo: true } });
      await entrarComo(operador);
      for (const r of [
        await abrirCuenta(s.mesa.id, 2),
        await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1 }]),
        await quitarItemSinEnviar(cuenta.items[0].id),
        await enviarACocina(cuenta.id, [cuenta.items[0].id]),
        await liberarMesa(cuenta.id),
      ]) {
        expect(r.ok).toBe(false);
        expect(r.mensaje).toMatch(/No tenés permiso/);
      }
      expect(await itemsDe(cuenta.id)).toHaveLength(1);
      expect((await itemsDe(cuenta.id))[0].numeroEnvio).toBeNull();
    });

    it("con Ver pero sin Editar de pos_tomar_pedido, tampoco", async () => {
      const soloVe = await crearUsuarioConRol(s.sucursalId, "solo-ve", [
        { clave: "pos_mesas", ver: true, editar: false },
        { clave: "pos_tomar_pedido", ver: true, editar: false },
      ]);
      await entrarComo(soloVe);
      const r = await abrirCuenta(s.mesa.id, 2);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
      expect(await prisma.cuenta.count()).toBe(0);
    });

    it("si la Central deshabilitó pos_tomar_pedido para la sucursal, ni el admin puede", async () => {
      await prisma.capacidadSucursal.create({ data: { accionClave: "pos_tomar_pedido", sucursalId: s.sucursalId, habilitado: false } });
      const r = await abrirCuenta(s.mesa.id, 2);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/no habilitó "pos_tomar_pedido"/);
    });

    it("un «mozo» armado desde la matriz (pos_mesas Ver + pos_tomar_pedido Editar) hace todo el circuito", async () => {
      const mozo = await crearMozo(s.sucursalId);
      await entrarComo(mozo);
      expect((await abrirCuenta(s.mesa.id, 2)).ok).toBe(true);
      const cuenta = (await cuentaAbiertaDe(s.mesa.id))!;
      expect((await agregarItems(cuenta.id, [{ productoId: s.milanesa.id, cantidad: 1 }, { productoId: s.flan.id, cantidad: 2 }])).ok).toBe(true);
      const [mila, flan] = await itemsDe(cuenta.id);
      expect((await quitarItemSinEnviar(flan.id)).ok).toBe(true);
      expect((await enviarACocina(cuenta.id, [mila.id])).ok).toBe(true);
      expect((await itemsDe(cuenta.id)).map((i) => [i.numeroEnvio, i.creadoPorId])).toEqual([[1, mozo.id]]);

      const otraMesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
      expect((await abrirCuenta(otraMesa.id, 2)).ok).toBe(true);
      expect((await liberarMesa((await cuentaAbiertaDe(otraMesa.id))!.id)).ok).toBe(true);
    });
  });
});
