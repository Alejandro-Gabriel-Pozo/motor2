import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { sembrarSalon } from "../pos/salon-fixture";
import { sembrarCatalogoPrecioYCarta, type CatalogoPrecioYCarta } from "../setup/siembra-precio-y-carta";
import { actualizarProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/actualizar-producto";
import { guardComandoDatosDeProducto } from "../../src/core/features/catalogo/productos.guard";
import type { EntradaEdicionProducto } from "../../src/core/features/catalogo/productos.schema";
import { MENSAJE_FALTA_PRECIO_FINAL } from "../../src/core/opciones/public";

/**
 * Fase 4 de la ola «precio y carta», C4 (ADR-035): «¿Cómo se vende?» en la edición del producto (`actualizar-producto.ts`), contra Postgres, sobre el catálogo de referencia de producción
 * (`siembra-precio-y-carta.ts`: Pizzas y Milanesas con su grupo de medida en ABSOLUTO, Café, Bife con incluida y adicionales, Gaseosa y Wok sin opciones).
 *
 * Fija: pasar a base con un grupo de precio (una fila de auditoría por columna; repetir no escribe ni audita); los rechazos con su mensaje y sin escribir nada (sin grupo de precio —«Falta el precio
 * final de cada opción»—, con una opción del grupo sin precio, con porcentajes, MP, se produce, consignación, ancla, ítem agrupado, un modo inventado); el precio BLOQUEADO de una base (rechazo y
 * guardado intacto; que no venga es «como estaba»); volver a directo (con un precio nuevo en el mismo envío); y que sin `producto_campos_sensibles` no se cambia el modo.
 */
describe("C4: el modo de venta en la edición del producto", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let cat: CatalogoPrecioYCarta;

  const actor = () => ({ usuarioId: s.admin.id, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: s.sucursalId, ahora: new Date(), ...baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }) });

  /** Lo que manda el formulario para dejar el producto como está, con los cambios encima (como el real: sin precio si es base, con el precio visto si es directo). */
  async function datos(productoId: string, cambios: Partial<EntradaEdicionProducto> = {}): Promise<EntradaEdicionProducto> {
    const p = await prisma.producto.findUniqueOrThrow({ where: { id: productoId } });
    const base = p.modoDeVenta === "BASE_CONFIGURABLE";
    return {
      nombre: p.nombre,
      tipo: p.tipo,
      unidadStockId: p.unidadStockId,
      unidadCompraId: p.unidadCompraId,
      factorConversion: Number(p.factorConversion),
      ...(base ? {} : { precioVenta: Number(p.precioVenta), precioVentaVisto: Number(p.precioVenta) }),
      seProduce: p.seProduce,
      esConsignacion: p.esConsignacion,
      proveedorConsignacionId: p.proveedorConsignacionId,
      precioConsignacion: Number(p.precioConsignacion ?? 0),
      ...cambios,
    };
  }
  async function editar(productoId: string, cambios: Partial<EntradaEdicionProducto> = {}, opciones: { sensibles?: boolean } = {}) {
    const d = await datos(productoId, cambios);
    return actualizarProductoCasoDeUso(actor(), { productoId, datos: d, puerta: guardComandoDatosDeProducto({ datos: d }), puedeGestionarConsignacion: true, puedeEditarCamposSensibles: opciones.sensibles ?? true });
  }
  const fila = (id: string) => prismaAdmin.producto.findUniqueOrThrow({ where: { id }, select: { nombre: true, modoDeVenta: true, precioVenta: true, seProduce: true, esConsignacion: true } }).then((p) => ({ ...p, precioVenta: Number(p.precioVenta) }));
  const auditorias = (id: string, campo?: string) =>
    prismaAdmin.registroAuditoria.findMany({ where: { entidad: "Producto", entidadId: id, ...(campo ? { campo } : {}) }, select: { campo: true, valorAnterior: true, valorNuevo: true }, orderBy: { creadoEn: "asc" } });

  /** Pide pasar a base y espera el rechazo: código, mensaje, y que NADA cambió (fila y auditoría). */
  async function rechazaPasarABase(productoId: string, codigo: string, mensaje: string | RegExp, cambios: Partial<EntradaEdicionProducto> = {}) {
    const antes = await fila(productoId);
    const auditadas = (await auditorias(productoId)).length;
    const r = await editar(productoId, { modoDeVenta: "BASE_CONFIGURABLE", ...cambios });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.codigo).toBe(codigo);
    if (typeof mensaje === "string") expect(r.mensaje).toBe(mensaje);
    else expect(r.mensaje).toMatch(mensaje);
    expect(await fila(productoId), "no se escribió nada").toEqual(antes);
    expect((await auditorias(productoId)).length, "ni se auditó").toBe(auditadas);
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    cat = await sembrarCatalogoPrecioYCarta(s);
  });

  it("Pizzas pasa a «por opción»: el precio guardado se conserva, queda una fila de auditoría del modo, y repetir el mismo guardado no cambia ni audita", async () => {
    const r = await editar(cat.producto.pizzas!, { modoDeVenta: "BASE_CONFIGURABLE" });
    expect(r).toMatchObject({ ok: true });
    expect(await fila(cat.producto.pizzas!)).toMatchObject({ modoDeVenta: "BASE_CONFIGURABLE", precioVenta: 18000 });
    expect(await auditorias(cat.producto.pizzas!)).toEqual([{ campo: "modoDeVenta", valorAnterior: "DIRECTO", valorNuevo: "BASE_CONFIGURABLE" }]);
    // Idempotencia: el formulario de una base no manda el precio; repetir el pedido no escribe ni audita de nuevo.
    expect(await editar(cat.producto.pizzas!, { modoDeVenta: "BASE_CONFIGURABLE" })).toMatchObject({ ok: true });
    expect(await auditorias(cat.producto.pizzas!)).toHaveLength(1);
    // Milanesas también (medida en ABSOLUTO + variante sin costo).
    expect(await editar(cat.producto.milanesas!, { modoDeVenta: "BASE_CONFIGURABLE" })).toMatchObject({ ok: true });
  });

  it("sin grupo de precio: «Falta el precio final de cada opción…» (Gaseosa, sin opciones; Bife, con incluida y adicionales pero sin medida)", async () => {
    await rechazaPasarABase(cat.producto.gaseosa!, "BASE_INVALIDA", MENSAJE_FALTA_PRECIO_FINAL);
    await rechazaPasarABase(cat.producto.bife!, "BASE_INVALIDA", MENSAJE_FALTA_PRECIO_FINAL);
  });

  it("con el grupo de precio quitado del producto, o archivado, tampoco", async () => {
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: cat.producto.pizzas! }, data: { activo: false } });
    await rechazaPasarABase(cat.producto.pizzas!, "BASE_INVALIDA", MENSAJE_FALTA_PRECIO_FINAL);
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: cat.producto.pizzas! }, data: { activo: true } });
    const grupo = await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: cat.producto.pizzas! }, select: { grupoId: true } });
    await prisma.grupoDeOpciones.update({ where: { id: grupo.grupoId }, data: { activo: false } });
    await rechazaPasarABase(cat.producto.pizzas!, "BASE_INVALIDA", MENSAJE_FALTA_PRECIO_FINAL);
  });

  it("una opción ofrecida del grupo de precio SIN precio propio: dice cuál falta", async () => {
    const grupo = await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: cat.producto.pizzas! }, select: { grupoId: true } });
    const nueva = await prisma.opcionDeGrupo.create({ data: { grupoId: grupo.grupoId, nombre: "Pizza especial", orden: 9 } });
    await prisma.versionDeOpcion.create({ data: { opcionId: nueva.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: 0, creadoPorId: s.admin.id } });
    await prisma.productoAdmiteOpcion.create({ data: { productoId: cat.producto.pizzas!, opcionId: nueva.id, cantidadMaxima: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: 0 } });
    await rechazaPasarABase(cat.producto.pizzas!, "BASE_INVALIDA", "Falta el precio final de cada opción: «Pizza especial» de «Tipos de Pizza» no tiene precio propio.");
  });

  it("una diferencia en PORCENTAJE (de la versión o del producto) se rechaza: se calcula sobre el precio guardado", async () => {
    // El café: «Tamaño del Café» en ABSOLUTO y «Preparación del café» con montos: pasa. Con un porcentaje en «Con leche», no.
    const conLeche = await prisma.productoAdmiteOpcion.findFirstOrThrow({ where: { productoId: cat.producto.cafe!, opcionId: cat.opcion.conLeche! }, select: { id: true } });
    await prisma.productoAdmiteOpcion.update({ where: { id: conLeche.id }, data: { tipoDeDiferencia: "PORCENTAJE", porcentaje: 10, diferenciaPrecio: null } });
    await rechazaPasarABase(cat.producto.cafe!, "BASE_INVALIDA", /^«Con leche» de «Preparación del café» tiene una diferencia en porcentaje/);
    // Sin la del producto, rige la de la versión: una versión 2 en porcentaje, también.
    await prisma.productoAdmiteOpcion.update({ where: { id: conLeche.id }, data: { tipoDeDiferencia: null, porcentaje: null, diferenciaPrecio: null } });
    await prisma.versionDeOpcion.create({ data: { opcionId: cat.opcion.conLeche!, numero: 2, tipoDeDiferencia: "PORCENTAJE", porcentaje: 7.5, creadoPorId: s.admin.id } });
    await rechazaPasarABase(cat.producto.cafe!, "BASE_INVALIDA", /^«Con leche» de «Preparación del café» tiene una diferencia en porcentaje/);
    await prisma.versionDeOpcion.create({ data: { opcionId: cat.opcion.conLeche!, numero: 3, tipoDeDiferencia: "MONTO", diferenciaPrecio: 300, creadoPorId: s.admin.id } });
    expect(await editar(cat.producto.cafe!, { modoDeVenta: "BASE_CONFIGURABLE" })).toMatchObject({ ok: true });
  });

  it("no puede ser base: una MP, un PV que se produce, uno de consignación, el respaldo de un adicional ni uno que está en un ítem agrupado de la carta", async () => {
    await rechazaPasarABase(s.muzzarella.id, "BASE_INVALIDA", "«Muzzarella» no es un producto de venta: solo un producto de venta se vende por opción.");
    await rechazaPasarABase(cat.producto.pizzas!, "BASE_INVALIDA", /^«Pizzas» se vende por opción y un producto así no se produce/, { seProduce: true });
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PROV_C", nombre: "Consignante" } });
    await prismaAdmin.producto.update({ where: { id: cat.producto.pizzas! }, data: { esConsignacion: true, proveedorConsignacionId: proveedor.id, precioConsignacion: 9000 } });
    await rechazaPasarABase(cat.producto.pizzas!, "BASE_INVALIDA", /^«Pizzas» se vende por opción y un producto así no puede ser de consignación/);
    await prismaAdmin.producto.update({ where: { id: cat.producto.pizzas! }, data: { esConsignacion: false, proveedorConsignacionId: null, precioConsignacion: 0 } });
    const ancla = await prisma.opcionDeGrupo.findFirstOrThrow({ where: { productoId: { not: null } }, select: { productoId: true, producto: { select: { nombre: true } } } });
    await rechazaPasarABase(ancla.productoId!, "BASE_INVALIDA", `«${ancla.producto!.nombre}» es el producto de respaldo de un adicional: no se vende por opción.`);
    const seccion = await prisma.seccionCarta.findFirstOrThrow({ select: { id: true } });
    const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: s.sucursalId, nombre: "Pizzas y empanadas", seccionCartaId: seccion.id } });
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: s.sucursalId, itemAgrupadoCartaId: item.id, productoId: cat.producto.pizzas! } });
    await rechazaPasarABase(cat.producto.pizzas!, "BASE_INVALIDA", "«Pizzas» está en el ítem agrupado «Pizzas y empanadas» de la carta, que usa su precio guardado: sacalo de ahí antes de venderlo por opción.");
  });

  it("un modo que no es de la lista se rechaza sin escribir", async () => {
    await rechazaPasarABase(cat.producto.pizzas!, "BASE_INVALIDA", "«¿Cómo se vende?» no tiene un valor válido: recargá la pantalla y volvé a elegirlo.", { modoDeVenta: "BASE" as never });
  });

  it("el precio de una base está BLOQUEADO: otro precio se rechaza y el guardado queda intacto; sin el precio (el formulario de una base) se guarda lo demás", async () => {
    expect(await editar(cat.producto.pizzas!, { modoDeVenta: "BASE_CONFIGURABLE" })).toMatchObject({ ok: true });
    const r = await editar(cat.producto.pizzas!, { precioVenta: 19000, precioVentaVisto: 18000 });
    expect(r).toMatchObject({ ok: false, codigo: "PRECIO_BLOQUEADO_EN_BASE" });
    expect(!r.ok && r.mensaje).toMatch(/^El precio de «Pizzas» no se cambia: se vende por opción/);
    expect(await fila(cat.producto.pizzas!)).toMatchObject({ modoDeVenta: "BASE_CONFIGURABLE", precioVenta: 18000 });
    expect(await auditorias(cat.producto.pizzas!, "precioVenta")).toEqual([]);
    // El mismo precio que el guardado no es un cambio; sin precio, «como estaba».
    expect(await editar(cat.producto.pizzas!, { nombre: "Pizzas a la piedra", precioVenta: 18000 })).toMatchObject({ ok: true });
    expect(await editar(cat.producto.pizzas!, { nombre: "Pizzas" })).toMatchObject({ ok: true });
    expect(await fila(cat.producto.pizzas!)).toMatchObject({ nombre: "Pizzas", precioVenta: 18000 });
    // Siendo base, tampoco se tilda «se produce» (el CHECK de la base lo repite).
    expect(await editar(cat.producto.pizzas!, { seProduce: true })).toMatchObject({ ok: false, codigo: "BASE_INVALIDA" });
  });

  it("volver a «Directo» se puede siempre, y en el mismo envío el precio nuevo se acepta (con el precio visto); cada cambio queda auditado", async () => {
    expect(await editar(cat.producto.pizzas!, { modoDeVenta: "BASE_CONFIGURABLE" })).toMatchObject({ ok: true });
    // Aunque ya no cumpla la regla (le archivaron el grupo de precio: D-4, falla cerrado), volver a directo no se bloquea.
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: cat.producto.pizzas! }, data: { activo: false } });
    expect(await editar(cat.producto.pizzas!, { modoDeVenta: "DIRECTO", precioVenta: 19000, precioVentaVisto: 18000 })).toMatchObject({ ok: true });
    expect(await fila(cat.producto.pizzas!)).toMatchObject({ modoDeVenta: "DIRECTO", precioVenta: 19000 });
    expect((await auditorias(cat.producto.pizzas!)).map((a) => [a.campo, a.valorAnterior, a.valorNuevo])).toEqual([
      ["modoDeVenta", "DIRECTO", "BASE_CONFIGURABLE"],
      ["precioVenta", "18000", "19000"],
      ["modoDeVenta", "BASE_CONFIGURABLE", "DIRECTO"],
    ]);
  });

  it("sin producto_campos_sensibles el modo no se cambia (SIN_PERMISO_CAMPOS_SENSIBLES, nada escrito); lo demás de una base sí se edita", async () => {
    const antes = await fila(cat.producto.pizzas!);
    const r = await editar(cat.producto.pizzas!, { modoDeVenta: "BASE_CONFIGURABLE" }, { sensibles: false });
    expect(r).toMatchObject({ ok: false, codigo: "SIN_PERMISO_CAMPOS_SENSIBLES" });
    expect(await fila(cat.producto.pizzas!)).toEqual(antes);
    expect(await editar(cat.producto.pizzas!, { modoDeVenta: "BASE_CONFIGURABLE" })).toMatchObject({ ok: true });
    // El formulario de quien no tiene la clave no manda ni el precio ni el modo: el nombre se guarda y el modo queda.
    const d = await datos(cat.producto.pizzas!, { nombre: "Pizzas al molde" });
    delete (d as Record<string, unknown>).factorConversion;
    delete (d as Record<string, unknown>).unidadStockId;
    delete (d as Record<string, unknown>).unidadCompraId;
    expect(await actualizarProductoCasoDeUso(actor(), { productoId: cat.producto.pizzas!, datos: d, puerta: guardComandoDatosDeProducto({ datos: d }), puedeGestionarConsignacion: true, puedeEditarCamposSensibles: false })).toMatchObject({ ok: true });
    expect(await fila(cat.producto.pizzas!)).toMatchObject({ nombre: "Pizzas al molde", modoDeVenta: "BASE_CONFIGURABLE", precioVenta: 18000 });
    // Y volver a directo sin la clave, tampoco.
    expect(await editar(cat.producto.pizzas!, { modoDeVenta: "DIRECTO" }, { sensibles: false })).toMatchObject({ ok: false, codigo: "SIN_PERMISO_CAMPOS_SENSIBLES" });
  });
});
