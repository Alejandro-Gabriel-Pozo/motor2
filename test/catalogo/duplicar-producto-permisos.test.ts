import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES } from "../../src/core/features/catalogo/productos.guard";
import { duplicarProducto } from "../../src/server/actions/catalogo/duplicar-producto";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { nuevoDuplicadoId, sembrarElBife, type EscenarioDelBife } from "../setup/duplicar-producto";

/**
 * Los permisos de «Duplicar producto» (E4): los resuelve el SERVIDOR, nunca el pedido. `alta_producto` para crear; `guardar_receta` si se pide copiar la receta; `producto_opciones_admitidas` si se piden las opciones;
 * `producto_campos_sensibles` para el precio (sin ella el producto nace en $0 y sin disponibilidad, como el alta). Si falta cualquiera de las que se necesitan se rechaza el pedido ENTERO antes de escribir (no se copia «lo
 * que se pueda»). El rol `admin` del escenario tiene la matriz completa; cada test le saca claves a esa matriz (`PermisoRol`), que es como el dueño reparte los permisos.
 */
const CLAVES = ["alta_producto", "guardar_receta", "producto_opciones_admitidas", "producto_campos_sensibles"] as const;
type Clave = (typeof CLAVES)[number];

describe("duplicarProducto: permisos", () => {
  let e: EscenarioDelBife;

  /** Deja al administrador con SOLO estas claves de las cuatro (las demás de la matriz no se tocan). */
  async function conClaves(...tiene: Clave[]) {
    for (const clave of CLAVES) {
      const si = tiene.includes(clave);
      await prismaAdmin.permisoRol.updateMany({ where: { rolId: e.rolAdminId, accionClave: clave }, data: { puedeVer: si, puedeEditar: si } });
    }
  }
  const duplicar = (extra: Record<string, unknown> = {}) =>
    duplicarProducto({ duplicadoId: nuevoDuplicadoId(), origenId: e.bifeId, nombre: "Bife con chimichurri", copiarReceta: true, copiarOpciones: true, sucursalDeLaRecetaId: null, ...extra });
  const CONTEOS = ["producto", "disponibilidadProducto", "recetaVersion", "productoAdmiteGrupo", "productoAdmiteOpcion", "registroAuditoria"] as const;
  const foto = async () => Object.fromEntries(await Promise.all(CONTEOS.map(async (t) => [t, await (prismaAdmin[t] as unknown as { count: () => Promise<number> }).count()])));

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarElBife();
    await mockearUsuarioActual({ id: e.adminId, email: "admin@test.com", nombre: null });
  });

  it("sin alta_producto no se puede duplicar nada, aunque se tengan las demás claves: rechazo antes de escribir", async () => {
    await conClaves("guardar_receta", "producto_opciones_admitidas", "producto_campos_sensibles");
    const antes = await foto();
    const r = await duplicar();
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/alta_producto/);
    expect(await foto()).toEqual(antes);
  });

  it("copiar la receta exige guardar_receta: sin ella se rechaza el pedido ENTERO (tampoco se copian las opciones), y sin pedir la receta no hace falta", async () => {
    await conClaves("alta_producto", "producto_opciones_admitidas", "producto_campos_sensibles");
    const antes = await foto();
    const r = await duplicar();
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/guardar_receta/);
    expect(await foto()).toEqual(antes);
    const soloOpciones = await duplicar({ nombre: "Sin receta", copiarReceta: false });
    expect(soloOpciones.ok, soloOpciones.mensaje).toBe(true);
  });

  it("copiar las opciones exige producto_opciones_admitidas: sin ella se rechaza el pedido ENTERO (tampoco se copia la receta), y sin pedir las opciones no hace falta", async () => {
    await conClaves("alta_producto", "guardar_receta", "producto_campos_sensibles");
    const antes = await foto();
    const r = await duplicar();
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/producto_opciones_admitidas/);
    expect(await foto()).toEqual(antes);
    const soloReceta = await duplicar({ nombre: "Sin opciones", copiarOpciones: false });
    expect(soloReceta.ok, soloReceta.mensaje).toBe(true);
  });

  it("con solo alta_producto se duplica la ficha (sin receta ni opciones): el nivel de quien arma un producto nuevo", async () => {
    await conClaves("alta_producto");
    const r = await duplicar({ copiarReceta: false, copiarOpciones: false });
    expect(r.ok, r.mensaje).toBe(true);
    expect(await prisma.recetaVersion.count({ where: { productoId: (r as { id: string }).id } })).toBe(0);
  });

  it("sin producto_campos_sensibles el producto nace con precio $0, factor 1, sin unidad de compra y SIN disponibilidad (regla del alta), y el mensaje lo dice", async () => {
    const caja = await prisma.unidad.create({ data: { nombre: "caja", magnitud: "CANTIDAD", decimales: 0 } });
    await prisma.producto.update({ where: { id: e.bifeId }, data: { unidadCompraId: caja.id, factorConversion: "12.0000" } });
    await conClaves("alta_producto", "guardar_receta", "producto_opciones_admitidas");
    const r = await duplicar();
    expect(r.ok, r.mensaje).toBe(true);
    const id = (r as { id: string }).id;
    const nuevo = await prisma.producto.findUniqueOrThrow({ where: { id } });
    expect([Number(nuevo.precioVenta), Number(nuevo.factorConversion), nuevo.unidadCompraId]).toEqual([0, 1, null]);
    const disponibilidad = await prisma.disponibilidadProducto.findMany({ where: { productoId: id } });
    expect(disponibilidad).toHaveLength(2);
    expect(disponibilidad.every((d) => d.disponible === false)).toBe(true);
    expect(r.mensaje).toContain("precio $0 y sin disponibilidad");
    expect(r.mensaje).toContain("producto_campos_sensibles");
    // La receta y las opciones sí se copiaron (tiene esas dos claves).
    expect(await prisma.recetaVersion.count({ where: { productoId: id } })).toBe(1);
    expect(await prisma.productoAdmiteGrupo.count({ where: { productoId: id } })).toBe(2);
    // Sin precio en la auditoría (no hay dinero que registrar), pero sí de dónde salió.
    expect(await prisma.registroAuditoria.count({ where: { entidadId: id, campo: "precioVenta" } })).toBe(0);
    expect(await prisma.registroAuditoria.count({ where: { entidadId: id, campo: "duplicadoDe" } })).toBe(1);
  });

  it("con producto_campos_sensibles el precio, el factor y la unidad de compra se copian y el producto nace disponible", async () => {
    const caja = await prisma.unidad.create({ data: { nombre: "caja", magnitud: "CANTIDAD", decimales: 0 } });
    await prisma.producto.update({ where: { id: e.bifeId }, data: { unidadCompraId: caja.id, factorConversion: "12.0000" } });
    const r = await duplicar();
    expect(r.ok, r.mensaje).toBe(true);
    const id = (r as { id: string }).id;
    const nuevo = await prisma.producto.findUniqueOrThrow({ where: { id } });
    expect([Number(nuevo.precioVenta), Number(nuevo.factorConversion), nuevo.unidadCompraId]).toEqual([5000, 12, caja.id]);
    expect((await prisma.disponibilidadProducto.findMany({ where: { productoId: id } })).every((d) => d.disponible)).toBe(true);
  });

  it("sin producto_campos_sensibles, un precio distinto de 0 en el pedido se rechaza (no se puede fijar lo que protege la clave); en 0 se acepta", async () => {
    await conClaves("alta_producto", "guardar_receta", "producto_opciones_admitidas");
    const antes = await foto();
    const r = await duplicar({ precioVenta: "999" });
    expect(r).toEqual({ ok: false, mensaje: MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES });
    expect(await foto()).toEqual(antes);
    expect((await duplicar({ nombre: "En cero", precioVenta: "0" })).ok).toBe(true);
  });

  it("cambio de permisos entre pedidos: el que se saca entre uno y otro rige en el segundo (el permiso se mira en el servidor en cada pedido)", async () => {
    expect((await duplicar({ nombre: "Primero" })).ok).toBe(true);
    await conClaves("alta_producto", "producto_opciones_admitidas", "producto_campos_sensibles");
    const antes = await foto();
    const r = await duplicar({ nombre: "Segundo" });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/guardar_receta/);
    expect(await foto()).toEqual(antes);
  });

  it("un original que se vende por opción exige producto_campos_sensibles (el modo de venta es un campo sensible)", async () => {
    // El original pasa a «por opción»: un grupo de medida con el precio final de cada opción (como lo exige la regla de la base).
    const medida = await prisma.grupoDeOpciones.create({ data: { nombre: "Tamaño", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 } });
    const chico = await prisma.opcionDeGrupo.create({ data: { grupoId: medida.id, nombre: "Chico", orden: 1 } });
    await prisma.versionDeOpcion.create({ data: { opcionId: chico.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", factorEscala: "1.0000", creadoPorId: e.adminId } });
    await prisma.productoAdmiteGrupo.create({ data: { productoId: e.bifeId, grupoId: medida.id, orden: 0, cantidadMinima: 1, cantidadMaxima: 1, modoPrecio: "ABSOLUTO" } });
    await prisma.productoAdmiteOpcion.create({ data: { productoId: e.bifeId, opcionId: chico.id, cantidadMaxima: 1, precioAbsoluto: "4800.00" } });
    await prisma.producto.update({ where: { id: e.bifeId }, data: { modoDeVenta: "BASE_CONFIGURABLE" } });

    await conClaves("alta_producto", "guardar_receta", "producto_opciones_admitidas");
    const antes = await foto();
    const sinClave = await duplicar({ copiarReceta: false });
    expect(sinClave.ok).toBe(false);
    expect(sinClave.mensaje).toContain("se vende por opción");
    expect(await foto()).toEqual(antes);

    await conClaves("alta_producto", "guardar_receta", "producto_opciones_admitidas", "producto_campos_sensibles");
    expect((await duplicar({ nombre: "Con precio", precioVenta: "10", copiarReceta: false })).mensaje).toContain("se vende por opción");
    expect((await duplicar({ nombre: "Sin opciones", copiarOpciones: false, copiarReceta: false })).mensaje).toContain("hay que copiar también sus opciones");
    const r = await duplicar({ nombre: "Bife por opción", copiarReceta: false });
    expect(r.ok, r.mensaje).toBe(true);
    const id = (r as { id: string }).id;
    const nuevo = await prisma.producto.findUniqueOrThrow({ where: { id } });
    expect({ modo: nuevo.modoDeVenta, precio: Number(nuevo.precioVenta) }).toEqual({ modo: "BASE_CONFIGURABLE", precio: 0 });
    const copiada = await prisma.productoAdmiteOpcion.findFirstOrThrow({ where: { productoId: id, opcionId: chico.id } });
    expect(Number(copiada.precioAbsoluto)).toBe(4800);
    expect(await prisma.registroAuditoria.count({ where: { entidadId: id, campo: "modoDeVenta" } })).toBe(1);
  });
});
