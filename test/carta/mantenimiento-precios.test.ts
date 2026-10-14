import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actorDePrueba } from "../setup/opciones-de-venta";
import type { AjusteDePrecio } from "../../src/core/carta/ajuste-de-precios";
import { MENSAJE_SUCURSAL_CAMBIADA } from "../../src/core/features/catalogo/opciones-por-sucursal.guard";
import { ajustarPreciosDeLaCartaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/ajustar-precios-de-la-carta";
import { ajustarPreciosDeLaEmpresaCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/ajustar-precios-de-la-empresa";
import { ajustarPreciosDeLaCarta, ajustarPreciosDeLaEmpresa } from "../../src/server/actions/carta/precios";
import { avisoDelPrecioDeLaEmpresa } from "../../src/server/lecturas/carta/aviso-de-precio-de-empresa";

/**
 * CARTA-MANT F4 (fila O.485 de docs/pureza-integracion.md): «Precios» de la carta contra Postgres real como `motor2_app` con el alcance de la sucursal activa. Por defecto ajusta el PRECIO LOCAL de la
 * sucursal activa; «En toda la empresa», el precio de lista, con la confirmación y la clave fina. Todo o nada, contra el precio que mostró la vista previa, en decimal exacto y con su auditoría.
 */
const ITERACIONES = 10;
const subir = (valor: string, modo: AjusteDePrecio["modo"] = "porcentaje"): AjusteDePrecio => ({ direccion: "subir", modo, valor, redondeo: 0 });

describe("«Precios» de la carta (CARTA-MANT F4)", () => {
  let sucursalA: string;
  let sucursalB: string;
  let usuarioId: string;
  let unidadId: string;
  let n = 0;
  const actor = () => ({ ...actorDePrueba(usuarioId, sucursalA), sucursalNombre: "Central" });
  const pv = async (nombre: string, precioVenta: number | string = 1000) =>
    (await sembrarProductoDisponible({ codigo: `PV_PRECIO_${n++}`, nombre, tipo: "PV", unidadStockId: unidadId, precioVenta }, sucursalA)).id;
  const local = async (productoId: string, sucursalId = sucursalA) => {
    const fila = await prisma.precioLocalProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } });
    return fila ? `${fila.precio.toFixed(2)}${fila.habilitado ? "" : " (apagado)"}` : null;
  };
  const deLista = async (id: string) => (await prisma.producto.findUniqueOrThrow({ where: { id } })).precioVenta.toFixed(2);
  const auditoriasLocales = (sucursalId = sucursalA) => prisma.registroAuditoria.count({ where: { entidad: "PrecioLocalProducto", campo: "precio", sucursalId } });
  const auditoriasDeLista = (productoId: string) => prisma.registroAuditoria.count({ where: { entidad: "Producto", entidadId: productoId, campo: "precioVenta" } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalA = base.sucursal.id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: sucursalA, rolId: base.admin.id })).id;
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
  });

  describe("en esta sucursal (el precio local, por defecto)", () => {
    it("sube una sección un 7 %, al centavo y en decimal exacto, con una auditoría por producto; el precio de lista de la empresa y el de Norte no cambian", async () => {
      const [a, b] = [await pv("Milanesa", "1000.10"), await pv("Flan", 6200)];
      await prisma.precioLocalProducto.create({ data: { sucursalId: sucursalB, productoId: a, precio: 5000, habilitado: true } });
      const r = await ajustarPreciosDeLaCartaCasoDeUso(actor(), { ajuste: subir("7"), items: [{ productoId: a, precioVisto: "1000.10" }, { productoId: b, precioVisto: "6200.00" }] });
      expect(r).toMatchObject({ ok: true, datos: { cambiados: 2 }, mensaje: "2 precios nuevos en «Central»." });
      expect([await local(a), await local(b)]).toEqual(["1070.11", "6634.00"]);
      expect([await deLista(a), await deLista(b), await local(a, sucursalB)]).toEqual(["1000.10", "6200.00", "5000.00"]);
      expect(await auditoriasLocales()).toBe(2);
      expect(await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "PrecioLocalProducto", campo: "precio", descripcion: 'Precio local de "Milanesa"' } })).toMatchObject({
        valorAnterior: null,
        valorNuevo: "1070.11",
        actorId: usuarioId,
        sucursalId: sucursalA,
      });
    });

    it("IDEMPOTENTE por el precio visto: repetir el mismo pedido no lo aplica dos veces (PRECIO_DESACTUALIZADO) y no escribe ni audita", async () => {
      const a = await pv("Tabla", 14900);
      const pedido = { ajuste: subir("12.5"), items: [{ productoId: a, precioVisto: "14900.00" }] };
      expect(await ajustarPreciosDeLaCartaCasoDeUso(actor(), pedido)).toMatchObject({ ok: true, datos: { cambiados: 1 } });
      const otra = await ajustarPreciosDeLaCartaCasoDeUso(actor(), pedido);
      expect(otra).toMatchObject({ ok: false, codigo: "PRECIO_DESACTUALIZADO" });
      expect(otra.mensaje).toContain("ahora es $16762,50");
      expect(await local(a)).toBe("16762.50");
      expect(await auditoriasLocales()).toBe(1);
    });

    it("TODO O NADA: si el precio de uno cambió desde la vista previa, o uno no es de venta, no cambia NINGUNO", async () => {
      const [a, b] = [await pv("A", 1000), await pv("B", 2000)];
      const mp = (await sembrarProductoDisponible({ codigo: "MP_X", nombre: "Harina", tipo: "MP", unidadStockId: unidadId }, sucursalA)).id;
      expect(await ajustarPreciosDeLaCartaCasoDeUso(actor(), { ajuste: subir("10"), items: [{ productoId: a, precioVisto: "1000.00" }, { productoId: b, precioVisto: "1999.99" }] })).toMatchObject({
        ok: false,
        codigo: "PRECIO_DESACTUALIZADO",
      });
      expect(await ajustarPreciosDeLaCartaCasoDeUso(actor(), { ajuste: subir("10"), items: [{ productoId: a, precioVisto: "1000.00" }, { productoId: mp, precioVisto: "0.00" }] })).toMatchObject({
        ok: false,
        codigo: "NO_ES_PV",
      });
      expect([await local(a), await local(b), await auditoriasLocales()]).toEqual([null, null, 0]);
    });

    it("un precio que queda igual no se escribe (no se crea un precio local igual al de lista); «Cambiar precio» de uno guarda el precio tal cual", async () => {
      const a = await pv("A", 1000);
      expect(await ajustarPreciosDeLaCartaCasoDeUso(actor(), { ajuste: subir("1000", "precio"), items: [{ productoId: a, precioVisto: "1000.00" }] })).toMatchObject({ ok: true, datos: { cambiados: 0 } });
      expect(await local(a)).toBeNull();
      expect(await ajustarPreciosDeLaCartaCasoDeUso(actor(), { ajuste: subir("1234.56", "precio"), items: [{ productoId: a, precioVisto: "1000.00" }] })).toMatchObject({ ok: true, datos: { cambiados: 1 } });
      expect(await local(a)).toBe("1234.56");
    });

    it("parte del precio que rige ACÁ: con un precio local apagado, el de lista; con uno prendido, ese", async () => {
      const [a, b] = [await pv("A", 1000), await pv("B", 1000)];
      await prisma.precioLocalProducto.create({ data: { sucursalId: sucursalA, productoId: a, precio: 1500, habilitado: true } });
      await prisma.precioLocalProducto.create({ data: { sucursalId: sucursalA, productoId: b, precio: 9999, habilitado: false } });
      expect(await ajustarPreciosDeLaCartaCasoDeUso(actor(), { ajuste: subir("100", "monto"), items: [{ productoId: a, precioVisto: "1500.00" }, { productoId: b, precioVisto: "1000.00" }] })).toMatchObject({ ok: true });
      expect([await local(a), await local(b)]).toEqual(["1600.00", "1100.00"]);
    });

    it("con el precio local APAGADO en la sucursal (capacidad), PRECIO_LOCAL_APAGADO y no escribe", async () => {
      const a = await pv("A", 1000);
      await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId: sucursalA, habilitado: false } });
      expect(await ajustarPreciosDeLaCartaCasoDeUso(actor(), { ajuste: subir("10"), items: [{ productoId: a, precioVisto: "1000.00" }] })).toMatchObject({ ok: false, codigo: "PRECIO_LOCAL_APAGADO" });
      expect(await local(a)).toBeNull();
    });

    it(`concurrencia real (${ITERACIONES} vueltas, Promise.allSettled): el mismo ajuste dos veces a la vez se aplica UNA sola vez, con una sola auditoría por producto`, async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        const ids = [await pv(`X${i}`, 1000), await pv(`Y${i}`, 2000)];
        const pedido = () => ajustarPreciosDeLaCartaCasoDeUso(actor(), { ajuste: subir("10"), items: [{ productoId: ids[0]!, precioVisto: "1000.00" }, { productoId: ids[1]!, precioVisto: "2000.00" }] });
        const res = await Promise.allSettled([pedido(), pedido()]);
        const resumen = res.map((r) => (r.status === "fulfilled" ? (r.value.ok ? `ok:${r.value.datos.cambiados}` : r.value.codigo) : `error:${String(r.reason)}`)).sort();
        expect(resumen, `vuelta ${i}`).toEqual(["PRECIO_DESACTUALIZADO", "ok:2"]);
        expect([await local(ids[0]!), await local(ids[1]!)], `vuelta ${i}`).toEqual(["1100.00", "2200.00"]);
      }
      expect(await auditoriasLocales()).toBe(2 * ITERACIONES);
    });
  });

  describe("en toda la empresa (el precio de lista)", () => {
    it("sin la clave fina o sin confirmar, no cambia nada; con las dos, cambia el precio de lista, con auditoría que dice en qué sucursales rige", async () => {
      const a = await pv("Bife", 15000);
      const pedido = { ajuste: subir("10"), items: [{ productoId: a, precioVisto: "15000.00" }] };
      expect(await ajustarPreciosDeLaEmpresaCasoDeUso(actor(), { ...pedido, confirmado: true, puedeEditarCamposSensibles: false })).toMatchObject({ ok: false, codigo: "SIN_PERMISO_CAMPOS_SENSIBLES" });
      expect(await ajustarPreciosDeLaEmpresaCasoDeUso(actor(), { ...pedido, confirmado: false, puedeEditarCamposSensibles: true })).toMatchObject({ ok: false, codigo: "FALTA_CONFIRMAR" });
      expect([await deLista(a), await auditoriasDeLista(a)]).toEqual(["15000.00", 0]);

      expect(await ajustarPreciosDeLaEmpresaCasoDeUso(actor(), { ...pedido, confirmado: true, puedeEditarCamposSensibles: true })).toMatchObject({ ok: true, datos: { cambiados: 1 } });
      expect(await deLista(a)).toBe("16500.00");
      const fila = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "Producto", entidadId: a, campo: "precioVenta" } });
      expect(fila).toMatchObject({ valorAnterior: "15000", valorNuevo: "16500", actorId: usuarioId });
      expect(fila.descripcion).toContain("«Central», «Norte»");
      // Repetir el mismo pedido: el precio visto ya no es el de lista.
      expect(await ajustarPreciosDeLaEmpresaCasoDeUso(actor(), { ...pedido, confirmado: true, puedeEditarCamposSensibles: true })).toMatchObject({ ok: false, codigo: "PRECIO_DESACTUALIZADO" });
      expect([await deLista(a), await auditoriasDeLista(a)]).toEqual(["16500.00", 1]);
    });

    it("compara contra el precio de LISTA (no el local de esta sucursal) y no toca ningún precio local", async () => {
      const a = await pv("Bife", 15000);
      await prisma.precioLocalProducto.create({ data: { sucursalId: sucursalA, productoId: a, precio: 18000, habilitado: true } });
      expect(await ajustarPreciosDeLaEmpresaCasoDeUso(actor(), { ajuste: subir("1000", "monto"), items: [{ productoId: a, precioVisto: "18000.00" }], confirmado: true, puedeEditarCamposSensibles: true })).toMatchObject({
        ok: false,
        codigo: "PRECIO_DESACTUALIZADO",
      });
      expect(await ajustarPreciosDeLaEmpresaCasoDeUso(actor(), { ajuste: subir("1000", "monto"), items: [{ productoId: a, precioVisto: "15000.00" }], confirmado: true, puedeEditarCamposSensibles: true })).toMatchObject({ ok: true });
      expect([await deLista(a), await local(a)]).toEqual(["16000.00", "18000.00"]);
    });

    it(`concurrencia real (${ITERACIONES} vueltas): dos «toda la empresa» iguales a la vez se aplican UNA vez`, async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        const a = await pv(`E${i}`, 1000);
        const pedido = () => ajustarPreciosDeLaEmpresaCasoDeUso(actor(), { ajuste: subir("5"), items: [{ productoId: a, precioVisto: "1000.00" }], confirmado: true, puedeEditarCamposSensibles: true });
        const res = await Promise.allSettled([pedido(), pedido()]);
        const resumen = res.map((r) => (r.status === "fulfilled" ? (r.value.ok ? `ok:${r.value.datos.cambiados}` : r.value.codigo) : `error:${String(r.reason)}`)).sort();
        expect(resumen, `vuelta ${i}`).toEqual(["PRECIO_DESACTUALIZADO", "ok:1"]);
        expect([await deLista(a), await auditoriasDeLista(a)], `vuelta ${i}`).toEqual(["1050.00", 1]);
      }
    });
  });

  describe("el aviso «ESTE PRECIO SE MODIFICARÁ EN»", () => {
    it("por sucursal nombrada: cuántos lo ven, cuántos tienen precio local propio y cuántos no se venden ahí; las demás activas solo se cuentan", async () => {
      const [a, b] = [await pv("A", 1000), await pv("B", 1000)];
      await prisma.disponibilidadProducto.createMany({ data: [{ sucursalId: sucursalB, productoId: a, disponible: true }] });
      await prisma.precioLocalProducto.create({ data: { sucursalId: sucursalA, productoId: b, precio: 1200, habilitado: true } });
      await prisma.sucursal.create({ data: { nombre: "Sur" } });
      const db = baseDeTest({ lectura: [sucursalA, sucursalB], escritura: [sucursalA] }).db;
      const aviso = await avisoDelPrecioDeLaEmpresa(db, [{ id: sucursalA, nombre: "Central" }, { id: sucursalB, nombre: "Norte" }], [a, b]);
      expect(aviso).toEqual({
        sucursales: [
          { nombre: "Central", loVen: 1, conPrecioLocal: 1, noLoVenden: 0 },
          { nombre: "Norte", loVen: 1, conPrecioLocal: 0, noLoVenden: 1 },
        ],
        otras: 1,
      });
    });

    it("una sucursal fuera del alcance de la base no muestra filas (la RLS) y su nombre no sale de la consulta", async () => {
      const a = await pv("A", 1000);
      await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalB, productoId: a, disponible: true } });
      const db = baseDeTest({ lectura: [sucursalA], escritura: [sucursalA] }).db;
      const aviso = await avisoDelPrecioDeLaEmpresa(db, [{ id: sucursalB, nombre: "(la que llegó)" }], [a]);
      expect(aviso.sucursales).toEqual([{ nombre: "(la que llegó)", loVen: 0, conPrecioLocal: 0, noLoVenden: 1 }]);
      expect(JSON.stringify(aviso)).not.toContain("Norte");
    });
  });

  describe("las Server Actions", () => {
    it("esta sucursal: sin `precio_local` no escribe; con el eco de otra sucursal tampoco; un ajuste inválido se rechaza; con la clave escribe", async () => {
      const a = await pv("Flan", 1000);
      const mozo = await prisma.rol.create({ data: { nombre: "mozo", clave: "mozo" } });
      const mozoId = (await crearUsuarioConMembresia({ email: "mozo@test.com", sucursalId: sucursalA, rolId: mozo.id })).id;
      const items = [{ productoId: a, precioVisto: "1000.00" }];
      await mockearUsuarioActual({ id: mozoId, email: "mozo@test.com", nombre: null });
      expect((await ajustarPreciosDeLaCarta({ sucursalId: sucursalA, ajuste: subir("10"), items })).ok).toBe(false);

      await mockearUsuarioActual({ id: usuarioId, email: "admin@test.com", nombre: null });
      expect(await ajustarPreciosDeLaCarta({ sucursalId: sucursalB, ajuste: subir("10"), items })).toMatchObject({ ok: false, mensaje: MENSAJE_SUCURSAL_CAMBIADA });
      expect((await ajustarPreciosDeLaCarta({ sucursalId: sucursalA, ajuste: { ...subir("10"), redondeo: 7 }, items })).ok).toBe(false);
      expect((await ajustarPreciosDeLaCarta({ sucursalId: sucursalA, ajuste: subir("10"), items: [...items, ...items] })).ok).toBe(false);
      expect((await ajustarPreciosDeLaCarta({ sucursalId: sucursalA, ajuste: subir("10"), items: [{ productoId: a, precioVisto: 1000 }] })).ok).toBe(false);
      expect(await local(a)).toBeNull();

      expect(await ajustarPreciosDeLaCarta({ sucursalId: sucursalA, ajuste: subir("10"), items })).toMatchObject({ ok: true, mensaje: "«Flan»: precio nuevo $1.100 en «Central»." });
      expect(await local(a)).toBe("1100.00");
    });

    it("toda la empresa: sin `producto_editar` no escribe; sin confirmar (o con algo que no es `true`) tampoco; con las dos claves y la confirmación escribe", async () => {
      const a = await pv("Bife", 1000);
      const items = [{ productoId: a, precioVisto: "1000.00" }];
      const mozo = await prisma.rol.create({ data: { nombre: "mozo", clave: "mozo" } });
      const mozoId = (await crearUsuarioConMembresia({ email: "mozo@test.com", sucursalId: sucursalA, rolId: mozo.id })).id;
      await mockearUsuarioActual({ id: mozoId, email: "mozo@test.com", nombre: null });
      expect((await ajustarPreciosDeLaEmpresa({ ajuste: subir("10"), items, confirmado: true })).ok).toBe(false);

      await mockearUsuarioActual({ id: usuarioId, email: "admin@test.com", nombre: null });
      expect((await ajustarPreciosDeLaEmpresa({ ajuste: subir("10"), items, confirmado: false })).ok).toBe(false);
      expect((await ajustarPreciosDeLaEmpresa({ ajuste: subir("10"), items, confirmado: "true" })).ok).toBe(false);
      expect(await deLista(a)).toBe("1000.00");
      expect(await ajustarPreciosDeLaEmpresa({ ajuste: subir("10"), items, confirmado: true })).toMatchObject({ ok: true, mensaje: "«Bife»: precio nuevo en toda la empresa." });
      expect(await deLista(a)).toBe("1100.00");
    });
  });
});
