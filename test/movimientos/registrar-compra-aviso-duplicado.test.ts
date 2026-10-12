import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, EMPRESA_POR_DEFECTO_ID, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarMotivosYDestinos, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { conEscrituraMasAnchaQue, deVerificacion, observarAlcances } from "../setup/alcances-observados";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import { ZONA_ARGENTINA, mediodiaDelDia } from "../../src/core/tiempo/zona-horaria";
import { cargarComprasParaAvisoDeDuplicado } from "../../src/server/persistencia/movimientos/cargar-validaciones-de-movimiento";

/**
 * Aviso C25 de posible factura repetida al REGISTRAR una compra: toda la empresa, ±7 días, mismo proveedor e importe; nombra la sucursal y NO bloquea. Postgres real; las compras se
 * cargan por el propio caso de uso (así el importe y el N.º salen del camino real). Las fechas son fijas y pasadas (la fecha de una compra de formulario es el mediodía argentino del día elegido: `mediodiaDelDia`, lo que manda el formulario).
 * La regla pura (ventana, importe, orden, texto) la cubre `test/core/compras-posible-duplicado.propiedades.test.ts`; acá se prueba el cableado: la lectura, el mensaje que se guarda
 * para la idempotencia y que la compra se escribe igual.
 *
 * P2 (decisión del dueño): el aviso VERIFICA sobre toda la empresa (la lectura de las compras candidatas corre con la base de verificación, antes de la transacción) pero NO muestra datos de otra sucursal:
 * el DÍA solo se nombra para las sucursales donde quien carga puede ver compras (`proceso_compra`); de las demás dice solo «en la sucursal X». Antes (P2) el mensaje daba el día de cualquier sucursal: los casos (1) y (2c)
 * cambiaron a propósito (el usuario de Norte no ve Central) y hay casos nuevos para quien sí la ve (`usuarioAmbas`), quien tiene la sucursal pero no el permiso, el alcance de una sola sucursal y la otra empresa.
 */
const AVISO = "Posible factura repetida";

describe("registrarMovimiento (Compra): aviso de posible factura repetida", () => {
  let sucursalCentral: string;
  let sucursalNorte: string;
  let seccionCentral: string;
  let seccionNorte: string;
  let usuarioCentral: string;
  let usuarioNorte: string;
  let usuarioAmbas: string;
  let usuarioSinCompras: string;
  let productoId: string;
  let proveedorId: string;
  let otroProveedorId: string;

  // Cada actor lleva el alcance que tiene en producción: SOLO su sucursal activa (ADR-028). Lo que el aviso C25 necesita leer de las OTRAS sucursales lo resuelve el código, no el actor del test.
  const actor = (usuarioId: string, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: string, sucursalNombre: string) => ({ usuarioId, sucursalId, sucursalNombre, ...baseDeTest({ lectura: [sucursalId], escritura: [sucursalId] }) });

  const comprarEnCentral = (fecha: string, precioTotal: number | undefined, extra: { nroFactura?: string; proveedor?: string; claveIdempotencia?: string } = {}) =>
    registrarMovimientoCasoDeUso(actor(usuarioCentral, sucursalCentral, "Central"), {
      proceso: "COMPRA",
      fecha: mediodiaDelDia(fecha, ZONA_ARGENTINA),
      seccionId: seccionCentral,
      proveedorId: extra.proveedor ?? proveedorId,
      nroFactura: extra.nroFactura,
      claveIdempotencia: extra.claveIdempotencia,
      items: [{ productoId, cantidad: 10, ...(precioTotal === undefined ? {} : { precioTotal }) }],
    });

  const comprarEnNorte = (fecha: string, precioTotal: number | undefined, extra: { nroFactura?: string; proveedor?: string; claveIdempotencia?: string } = {}) =>
    registrarMovimientoCasoDeUso(actor(usuarioNorte, sucursalNorte, "Norte"), {
      proceso: "COMPRA",
      fecha: mediodiaDelDia(fecha, ZONA_ARGENTINA),
      seccionId: seccionNorte,
      proveedorId: extra.proveedor ?? proveedorId,
      nroFactura: extra.nroFactura,
      claveIdempotencia: extra.claveIdempotencia,
      items: [{ productoId, cantidad: 10, ...(precioTotal === undefined ? {} : { precioTotal }) }],
    });

  /** Una compra de `usuarioId` actuando en la sucursal dada (para elegir quién carga y qué sucursales ve). */
  const comprarEn = (usuarioId: string, sucursalId: string, sucursalNombre: string, seccionId: string, fecha: string, precioTotal: number, extra: { nroFactura?: string } = {}) =>
    registrarMovimientoCasoDeUso(actor(usuarioId, sucursalId, sucursalNombre), {
      proceso: "COMPRA",
      fecha: mediodiaDelDia(fecha, ZONA_ARGENTINA),
      seccionId,
      proveedorId,
      nroFactura: extra.nroFactura,
      items: [{ productoId, cantidad: 10, precioTotal }],
    });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalCentral = base.sucursal.id;
    sucursalNorte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    const catalogo = await sembrarCatalogoBase();
    await sembrarMotivosYDestinos();
    seccionCentral = (await sembrarSeccion(sucursalCentral, "Depósito Central")).id;
    seccionNorte = (await sembrarSeccion(sucursalNorte, "Depósito Norte")).id;
    usuarioCentral = (await crearUsuarioConMembresia({ email: "central@test.com", sucursalId: sucursalCentral, rolId: base.admin.id })).id;
    usuarioNorte = (await crearUsuarioConMembresia({ email: "norte@test.com", sucursalId: sucursalNorte, rolId: base.admin.id })).id;
    // Quien carga en Norte y TAMBIÉN es administrador en Central: ve las compras de las dos.
    usuarioAmbas = (await crearUsuarioConMembresia({ email: "ambas@test.com", sucursalId: sucursalNorte, rolId: base.admin.id })).id;
    await crearMembresia({ usuarioId: usuarioAmbas, sucursalId: sucursalCentral, rolId: base.admin.id });
    // Quien carga en Norte y tiene membresía en Central con un rol que NO ve las compras de allá (sin ningún permiso): la membresía sola no alcanza.
    const rolSinCompras = await prisma.rol.create({ data: { nombre: "Sin compras" } });
    usuarioSinCompras = (await crearUsuarioConMembresia({ email: "sincompras@test.com", sucursalId: sucursalNorte, rolId: base.admin.id })).id;
    await crearMembresia({ usuarioId: usuarioSinCompras, sucursalId: sucursalCentral, rolId: rolSinCompras.id });
    const producto = await sembrarProductoDisponible({ codigo: "MP_ACEITE_C25", nombre: "Aceite", tipo: "MP", unidadStockId: catalogo.kg.id, unidadCompraId: catalogo.kg.id }, sucursalCentral);
    productoId = producto.id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalNorte, productoId, disponible: true } });
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_C25", nombre: "Proveedor C25" } })).id;
    otroProveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_C25_OTRO", nombre: "Otro proveedor C25" } })).id;
  });

  it("(1) otra sucursal de la empresa que quien carga NO ve, 3 días después y mismo importe: sale bien y el mensaje nombra SOLO la sucursal (sin el día), no el número de factura (P2: antes daba la fecha)", async () => {
    const primera = await comprarEnCentral("2026-09-10", 1500, { nroFactura: "1-1234" });
    expect(primera.ok).toBe(true);
    expect(primera.mensaje).not.toContain(AVISO);

    const segunda = await comprarEnNorte("2026-09-13", 1500, { nroFactura: "9-77" });
    expect(segunda.ok).toBe(true);
    expect(segunda.mensaje).toContain(AVISO);
    expect(segunda.mensaje).toContain("(±7 días): en la sucursal Central. Revisá que no la estés cargando dos veces.");
    expect(segunda.mensaje).not.toContain("10/09/2026"); // el día de una compra de otra sucursal no se muestra a quien no la ve
    expect(segunda.mensaje).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(segunda.mensaje).not.toContain("1234"); // el N.º de factura exige piso administrador: el aviso no lo filtra
    expect(segunda.mensaje).not.toContain("1500");
    expect(segunda.mensaje).toMatch(/^Se guardaron 1 movimiento\(s\)\./);
  });

  it("(1c) si quien carga SÍ ve las compras de la otra sucursal (administrador en las dos), el mensaje nombra la sucursal y el día", async () => {
    await comprarEnCentral("2026-09-10", 1500, { nroFactura: "1-1234" });
    const r = await comprarEn(usuarioAmbas, sucursalNorte, "Norte", seccionNorte, "2026-09-13", 1500, { nroFactura: "9-77" });
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain("(±7 días): en la sucursal Central el 10/09/2026. Revisá que no la estés cargando dos veces.");
    expect(r.mensaje).not.toContain("1234");
    expect(r.mensaje).not.toContain("1500");
  });

  it("(1d) tener membresía en la otra sucursal no alcanza: si su rol no ve las compras de allá, el día no se muestra", async () => {
    await comprarEnCentral("2026-09-10", 1500);
    const r = await comprarEn(usuarioSinCompras, sucursalNorte, "Norte", seccionNorte, "2026-09-13", 1500);
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain("en la sucursal Central. Revisá");
    expect(r.mensaje).not.toContain("10/09/2026");
  });

  it("(1e) con varias: se nombra el día solo de las sucursales que quien carga ve (la propia siempre), y las demás solo por nombre; el aviso cuenta a todas", async () => {
    // Quien carga en Norte ve Norte y Central, pero NO Sur (otra sucursal más de la empresa).
    const sucursalSur = (await prisma.sucursal.create({ data: { nombre: "Sur" } })).id;
    const seccionSur = (await sembrarSeccion(sucursalSur, "Depósito Sur")).id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalSur, productoId, disponible: true } });
    const usuarioSur = (await crearUsuarioConMembresia({ email: "sur@test.com", sucursalId: sucursalSur, rolId: (await prisma.rol.findFirstOrThrow({ where: { nombre: "admin" } })).id })).id;
    await comprarEnCentral("2026-09-10", 1500);
    await comprarEn(usuarioNorte, sucursalNorte, "Norte", seccionNorte, "2026-09-11", 1500);
    await comprarEn(usuarioSur, sucursalSur, "Sur", seccionSur, "2026-09-12", 1500);
    const r = await comprarEn(usuarioAmbas, sucursalNorte, "Norte", seccionNorte, "2026-09-13", 1500);
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain("ya hay 3 compras de este proveedor por el mismo importe (±7 días): en la sucursal Sur; en esta sucursal el 11/09/2026; en la sucursal Central el 10/09/2026.");
    expect(r.mensaje).not.toContain("12/09/2026"); // el día de Sur, que no ve
  });

  it("(1b) en la misma sucursal dice «en esta sucursal»", async () => {
    await comprarEnCentral("2026-09-10", 1500, { nroFactura: "A-1" });
    const segunda = await comprarEnCentral("2026-09-12", 1500, { nroFactura: "A-2" });
    expect(segunda.ok).toBe(true);
    expect(segunda.mensaje).toContain("en esta sucursal");
  });

  it("(2) a 8 días no avisa", async () => {
    await comprarEnCentral("2026-09-10", 1500);
    const r = await comprarEnNorte("2026-09-18", 1500);
    expect(r.ok).toBe(true);
    expect(r.mensaje).not.toContain(AVISO);
  });

  it("(2b) a 7 días justos avisa (el borde cuenta)", async () => {
    await comprarEnCentral("2026-09-10", 1500);
    const r = await comprarEnNorte("2026-09-17", 1500);
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain(AVISO);
  });

  it("(2c) el día de la compra anterior se cuenta en hora argentina: una de las 23:30 argentinas del 10/09 (ya es 11/09 en UTC) está a 7 días justos de la del 03/09, y el mensaje dice 10/09", async () => {
    // Instante fijo y pasado, escrito con su offset: 2026-09-10 23:30 (-03:00) = 2026-09-11T02:30Z. Entra por el caso de uso con ese instante exacto (lo que pondría una API o un script).
    const primera = await registrarMovimientoCasoDeUso(actor(usuarioCentral, sucursalCentral, "Central"), {
      proceso: "COMPRA",
      fecha: new Date("2026-09-10T23:30:00-03:00"),
      seccionId: seccionCentral,
      proveedorId,
      items: [{ productoId, cantidad: 10, precioTotal: 1500 }],
    });
    expect(primera.ok).toBe(true);

    const segunda = await comprarEn(usuarioAmbas, sucursalNorte, "Norte", seccionNorte, "2026-09-03", 1500); // 7 días antes en hora argentina; 8 si el día de la primera se leyera en UTC (11/09). Quien carga ve Central: el mensaje nombra el día.
    expect(segunda.ok).toBe(true);
    expect(segunda.mensaje).toContain(AVISO);
    expect(segunda.mensaje).toContain("el 10/09/2026");
  });

  it("(3) con otro importe no avisa, ni por un centavo", async () => {
    await comprarEnCentral("2026-09-10", 1500);
    const r = await comprarEnNorte("2026-09-12", 1500.01);
    expect(r.ok).toBe(true);
    expect(r.mensaje).not.toContain(AVISO);
  });

  it("(4) si la compra anterior está anulada, no avisa", async () => {
    await comprarEnCentral("2026-09-10", 1500, { nroFactura: "1-1234" });
    await prisma.operacion.updateMany({ where: { proceso: "COMPRA" }, data: { anuladaEn: new Date("2026-09-11T12:00:00Z"), anuladaPorId: usuarioCentral } });
    const r = await comprarEnNorte("2026-09-12", 1500);
    expect(r.ok).toBe(true);
    expect(r.mensaje).not.toContain(AVISO);
  });

  it("(5) con otro proveedor de la misma empresa no avisa", async () => {
    await comprarEnCentral("2026-09-10", 1500);
    const r = await comprarEnNorte("2026-09-12", 1500, { proveedor: otroProveedorId });
    expect(r.ok).toBe(true);
    expect(r.mensaje).not.toContain(AVISO);
  });

  it("(5b) la lectura trae solo las compras VIGENTES del proveedor pedido, dentro de los días pedidos, con su sucursal, su importe y el día en hora argentina", async () => {
    await comprarEnCentral("2026-09-10", 1500.5, { nroFactura: "1-1234" });
    await comprarEnNorte("2026-09-17", 700, { nroFactura: "A-17" });
    await comprarEnNorte("2026-09-18", 700, { nroFactura: "A-18" }); // un día después de la ventana
    await comprarEnNorte("2026-09-02", 700, { nroFactura: "A-02" }); // un día antes de la ventana
    await comprarEnNorte("2026-09-12", 700, { nroFactura: "A-12", proveedor: otroProveedorId }); // otro proveedor
    await comprarEnNorte("2026-09-13", 700, { nroFactura: "A-13" });
    await prisma.operacion.updateMany({ where: { proceso: "COMPRA", nroFactura: "A-13" }, data: { anuladaEn: new Date("2026-09-14T12:00:00Z"), anuladaPorId: usuarioNorte } }); // anulada

    // Con el alcance de quien opera en la Central (solo su sucursal): la lectura de las compras de las OTRAS sucursales es del código del aviso C25 (pendiente), no de este actor.
    const leidas = await cargarComprasParaAvisoDeDuplicado(baseDeTest({ lectura: [sucursalCentral], escritura: [sucursalCentral] }).db, { proveedorId, desde: "2026-09-03", hasta: "2026-09-17" });

    expect(leidas.map((c) => ({ dia: c.dia, importe: c.importe, sucursalNombre: c.sucursalNombre, anulado: c.anulado, proveedorId: c.proveedorId })).sort((a, b) => a.dia.localeCompare(b.dia))).toEqual([
      { dia: "2026-09-10", importe: 1500.5, sucursalNombre: "Central", anulado: false, proveedorId },
      { dia: "2026-09-17", importe: 700, sucursalNombre: "Norte", anulado: false, proveedorId },
    ]);
  });

  it("(6) una compra igual de OTRA empresa no se ve (aislamiento): no avisa", async () => {
    const e = "empresa_c25_b";
    await prismaAdmin.empresa.create({ data: { id: e, nombre: "Empresa C25 B", slug: "empresa-c25-b", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
    const sucursalB = await prismaAdmin.sucursal.create({ data: { empresaId: e, nombre: "Sucursal B" } });
    const seccionB = await prismaAdmin.seccion.create({ data: { empresaId: e, sucursalId: sucursalB.id, nombre: "Depósito B" } });
    const unidadB = await prismaAdmin.unidad.create({ data: { empresaId: e, nombre: "kg B", magnitud: "PESO", decimales: 2 } });
    const productoB = await prismaAdmin.producto.create({ data: { empresaId: e, codigo: "MP_B_C25", nombre: "Aceite B", tipo: "MP", unidadStockId: unidadB.id } });
    const proveedorB = await prismaAdmin.proveedor.create({ data: { empresaId: e, codigo: "PRV_B_C25", nombre: "Proveedor B" } });
    const operacionB = await prismaAdmin.operacion.create({
      data: { empresaId: e, sucursalId: sucursalB.id, proceso: "COMPRA", fecha: mediodiaDelDia("2026-09-11", ZONA_ARGENTINA), proveedorId: proveedorB.id, nroFactura: "1-1234", usuarioId: usuarioCentral },
    });
    await prismaAdmin.movimientoStock.create({
      data: { empresaId: e, operacionId: operacionB.id, productoId: productoB.id, seccionId: seccionB.id, proceso: "COMPRA", cantidad: 10, precioTotal: 1500, precioPorUnidadStock: 150, detalle: "" },
    });

    const r = await comprarEnCentral("2026-09-12", 1500);
    expect(r.ok).toBe(true);
    expect(r.mensaje).not.toContain(AVISO);

    // Aislamiento real: la consulta filtra por proveedor, y el de la empresa A no es el de B, así que lo de arriba solo no lo prueba. Se pide el proveedor de B DESDE el actor de A
    // (`baseDeTest.db`, con la RLS de la empresa A): tiene que devolver [] aunque la compra de B está en la ventana, con el mismo importe. Para que lo único que la frene sea la EMPRESA
    // (y no el alcance por sucursal, que la ocultaría igual), la sucursal de B va DENTRO del alcance de A (un alcance mal armado a propósito).
    const deAConLaSucursalDeBEnElAlcance = baseDeTest({ lectura: [sucursalCentral, sucursalB.id], escritura: [sucursalCentral] }).db;
    expect(await cargarComprasParaAvisoDeDuplicado(deAConLaSucursalDeBEnElAlcance, { proveedorId: proveedorB.id, desde: "2026-09-04", hasta: "2026-09-18" })).toEqual([]);
    // Control: el mismo pedido como dueño (salta la RLS) sí la ve; sin esto el [] de arriba podría ser una ventana mal armada.
    expect(await cargarComprasParaAvisoDeDuplicado(prismaAdmin, { proveedorId: proveedorB.id, desde: "2026-09-04", hasta: "2026-09-18" })).toHaveLength(1);
  });

  it("(7) sin precio (importe 0) nunca avisa, aunque haya otra compra sin precio", async () => {
    await comprarEnCentral("2026-09-10", undefined);
    const r = await comprarEnNorte("2026-09-12", undefined);
    expect(r.ok).toBe(true);
    expect(r.mensaje).not.toContain(AVISO);
  });

  it("(8) el reintento con la misma clave devuelve el MISMO mensaje (con el aviso) y no escribe de nuevo", async () => {
    await comprarEnCentral("2026-09-10", 1500, { nroFactura: "1-1234" });
    const clave = randomUUID();
    const primera = await comprarEnNorte("2026-09-13", 1500, { claveIdempotencia: clave });
    expect(primera.ok).toBe(true);
    expect(primera.mensaje).toContain(AVISO);

    const reintento = await comprarEnNorte("2026-09-13", 1500, { claveIdempotencia: clave });
    expect(reintento.ok).toBe(true);
    expect(reintento.mensaje).toBe(primera.mensaje);
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(2);
  });

  it("(10) con un actor de ALCANCE de una sola sucursal (el que arma el contexto real): las compras candidatas se leen con toda la empresa, la transacción de la compra NO se ensancha y el mensaje no da el día de la otra", async () => {
    await comprarEnCentral("2026-09-10", 1500, { nroFactura: "1-1234" });
    const alcance = { lectura: [sucursalNorte], escritura: [sucursalNorte] };
    const observador = observarAlcances();
    try {
      const r = await registrarMovimientoCasoDeUso(
        { usuarioId: usuarioNorte, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: sucursalNorte, sucursalNombre: "Norte", ...baseDeTest(alcance) },
        { proceso: "COMPRA", fecha: mediodiaDelDia("2026-09-13", ZONA_ARGENTINA), seccionId: seccionNorte, proveedorId, nroFactura: "9-77", items: [{ productoId, cantidad: 10, precioTotal: 1500 }] },
      );
      expect(r.ok, r.mensaje).toBe(true);
      expect(r.mensaje).toContain("en la sucursal Central. Revisá");
      expect(r.mensaje).not.toContain("10/09/2026");
      // La lectura de las candidatas corrió con TODA la empresa (Central y Norte) y la escritura solo en la activa...
      expect(deVerificacion(observador.vistos(), [sucursalCentral, sucursalNorte], [sucursalNorte]).length).toBeGreaterThan(0);
      // ...y la transacción de la compra (stock, líneas, escritura) siguió con el alcance de siempre: solo Norte.
      expect(observador.transacciones().length).toBeGreaterThan(0);
      expect(observador.transacciones().every((t) => t.lectura.join() === sucursalNorte && t.escritura.join() === sucursalNorte)).toBe(true);
      expect(conEscrituraMasAnchaQue(observador.vistos(), [sucursalNorte])).toEqual([]);
    } finally {
      observador.restaurar();
    }
  });

  it("(10b) una segunda EMPRESA con el mismo proveedor, el mismo importe y la misma factura no dispara el aviso ni aparece en lo que se lee, aun con la lectura de toda la empresa", async () => {
    const e = "empresa_c25_alcance";
    await prismaAdmin.empresa.create({ data: { id: e, nombre: "Empresa C25 alcance", slug: "empresa-c25-alcance", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
    const sucursalB = await prismaAdmin.sucursal.create({ data: { empresaId: e, nombre: "Sucursal B" } });
    const seccionB = await prismaAdmin.seccion.create({ data: { empresaId: e, sucursalId: sucursalB.id, nombre: "Depósito B" } });
    const unidadB = await prismaAdmin.unidad.create({ data: { empresaId: e, nombre: "kg B", magnitud: "PESO", decimales: 2 } });
    const productoB = await prismaAdmin.producto.create({ data: { empresaId: e, codigo: "MP_B_C25_ALC", nombre: "Aceite B", tipo: "MP", unidadStockId: unidadB.id } });
    const proveedorB = await prismaAdmin.proveedor.create({ data: { empresaId: e, codigo: "PRV_B_C25_ALC", nombre: "Proveedor B" } });
    const operacionB = await prismaAdmin.operacion.create({
      data: { empresaId: e, sucursalId: sucursalB.id, proceso: "COMPRA", fecha: mediodiaDelDia("2026-09-11", ZONA_ARGENTINA), proveedorId: proveedorB.id, nroFactura: "1-1234", usuarioId: usuarioCentral },
    });
    await prismaAdmin.movimientoStock.create({
      data: { empresaId: e, operacionId: operacionB.id, productoId: productoB.id, seccionId: seccionB.id, proceso: "COMPRA", cantidad: 10, precioTotal: 1500, precioPorUnidadStock: 150, detalle: "" },
    });

    const alcance = { lectura: [sucursalCentral], escritura: [sucursalCentral] };
    const observador = observarAlcances();
    try {
      const r = await registrarMovimientoCasoDeUso(
        { usuarioId: usuarioCentral, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: sucursalCentral, sucursalNombre: "Central", ...baseDeTest(alcance) },
        { proceso: "COMPRA", fecha: mediodiaDelDia("2026-09-12", ZONA_ARGENTINA), seccionId: seccionCentral, proveedorId, nroFactura: "1-1234", items: [{ productoId, cantidad: 10, precioTotal: 1500 }] },
      );
      expect(r.ok, r.mensaje).toBe(true);
      expect(r.mensaje).not.toContain(AVISO);
      // Ninguna operación leyó una sucursal de la otra empresa: la lista de la verificación es la de ESTA empresa.
      expect(observador.vistos().some((v) => v.lectura.includes(sucursalB.id) || v.escritura.includes(sucursalB.id))).toBe(false);
      expect(deVerificacion(observador.vistos(), [sucursalCentral, sucursalNorte], [sucursalCentral]).length).toBeGreaterThan(0);
    } finally {
      observador.restaurar();
    }
  });

  it("(9) la compra se escribe igual: la operación, la línea y el stock quedan", async () => {
    await comprarEnCentral("2026-09-10", 1500, { nroFactura: "1-1234" });
    const r = await comprarEnNorte("2026-09-13", 1500, { nroFactura: "9-77" });
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain(AVISO);
    const operaciones = await prisma.operacion.findMany({ where: { proceso: "COMPRA", sucursalId: sucursalNorte }, include: { movimientos: true } });
    expect(operaciones).toHaveLength(1);
    expect(operaciones[0]!.nroFactura).toBe("9-77");
    expect(operaciones[0]!.movimientos).toHaveLength(1);
    expect(Number(operaciones[0]!.movimientos[0]!.precioTotal)).toBe(1500);
  });
});
