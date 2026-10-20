import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { darRecetaDeReventa } from "../setup/receta-de-venta";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarVentaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import type { DatosVentaInput } from "../../src/core/features/ventas/venta.schema";
import type { Transaccion } from "../../src/lib/db-tipos";

/**
 * UN PRODUCTO CON OPCIONES OBLIGATORIAS NO SE VENDE POR MOSTRADOR SIN ELEGIRLAS (fila O.430), contra Postgres real. La venta de mostrador no tiene selector de opciones: un producto que admite un grupo con
 * mínimo mayor que 0 (el tamaño que fija el precio y el consumo de stock) se cobraría al precio base. La barrera es la del núcleo (`armarLinea`), la MISMA lectura de los grupos y la MISMA regla que el POS
 * (`validarOpcionesElegidas` con cero opciones): código estable `PRODUCTO_REQUIERE_OPCIONES`, antes de escribir nada (ni Operacion, ni movimientos, ni el comprobante de la clave), y dentro de la transacción.
 * Los productos sin grupos obligatorios (sin grupos, o con grupos opcionales) se venden como siempre.
 */
let sucursalId: string;
let sucursalNombre: string;
let seccionId: string;
let adminId: string;
let unidadId: string;
let gaseosaId: string;
let cafeId: string;
let grupoTamanoId: string;

const baseDe = (sucursal: string) => baseDeTest({ lectura: [sucursal], escritura: [sucursal] });
const actor = () => ({ usuarioId: adminId, sucursalId, sucursalNombre, ...baseDe(sucursalId) });
const datos = (ventas: DatosVentaInput["ventas"], extra: Partial<DatosVentaInput> = {}): DatosVentaInput => ({ fecha: new Date("2026-08-06T12:00:00Z"), seccionId, ventas, ...extra });
const MENSAJE_CAFE = "«Café» se vende con opciones obligatorias (ej. tamaño): cobralo desde las mesas/POS, donde se eligen.";
const RECHAZO_CAFE = { ok: false, codigo: "PRODUCTO_REQUIERE_OPCIONES", mensaje: MENSAJE_CAFE };

/** Deja el grupo «Tamaño» como OPCIONAL para el café (el mínimo del PRODUCTO manda sobre el del grupo; un grupo MEDIDA es siempre de 1 a 1). */
const volverOpcional = () => prisma.productoAdmiteGrupo.updateMany({ where: { productoId: cafeId, grupoId: grupoTamanoId }, data: { cantidadMinima: 0 } });

/** Lo que una venta deja escrito en la base, entero: si un rechazo no escribe nada, esto no cambia. */
async function escrito() {
  return {
    operaciones: await prisma.operacion.count(),
    ventas: await prisma.operacion.count({ where: { proceso: "VENTA" } }),
    movimientos: await prisma.movimientoStock.count(),
    conClave: await prisma.operacion.count({ where: { claveIdempotencia: { not: null } } }),
  };
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  sucursalId = base.sucursal.id;
  sucursalNombre = base.sucursal.nombre;
  const { kg } = await sembrarCatalogoBase();
  unidadId = kg.id;
  seccionId = (await sembrarSeccion(sucursalId)).id;
  adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
  const stock = { cantidad: 100, seccionIds: [seccionId], usuarioId: adminId };

  // Una gaseosa de siempre: sin ningún grupo de opciones.
  const gaseosa = await sembrarProductoDisponible({ codigo: "PV_GASEOSA", nombre: "Gaseosa", tipo: "PV", unidadStockId: unidadId, precioVenta: 500 }, sucursalId);
  gaseosaId = gaseosa.id;
  await darRecetaDeReventa(prisma, gaseosa, { sucursalIds: [sucursalId], stock });

  // Un café con un grupo OBLIGATORIO: «Tamaño» (MEDIDA, de 1 a 1) con dos tamaños, cada uno con su versión.
  const cafe = await sembrarProductoDisponible({ codigo: "PV_CAFE", nombre: "Café", tipo: "PV", unidadStockId: unidadId, precioVenta: 1000 }, sucursalId);
  cafeId = cafe.id;
  await darRecetaDeReventa(prisma, cafe, { sucursalIds: [sucursalId], stock });
  grupoTamanoId = (await prisma.grupoDeOpciones.create({ data: { nombre: "Tamaño", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 } })).id;
  for (const [orden, [nombre, diferencia, factor]] of [["Chico", "-50.00", "0.5000"], ["Grande", "100.00", "1.5000"]].entries()) {
    const opcion = await prisma.opcionDeGrupo.create({ data: { grupoId: grupoTamanoId, nombre: nombre!, orden } });
    await prisma.versionDeOpcion.create({ data: { opcionId: opcion.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: diferencia!, factorEscala: factor!, creadoPorId: adminId } });
    await prisma.productoAdmiteOpcion.create({ data: { productoId: cafeId, opcionId: opcion.id } });
  }
  await prisma.productoAdmiteGrupo.create({ data: { productoId: cafeId, grupoId: grupoTamanoId, orden: 0 } });
});

describe("mostrador: un producto con un grupo obligatorio", () => {
  it("se rechaza con PRODUCTO_REQUIERE_OPCIONES y el mensaje que nombra el producto, y NO se escribe nada (ni Operacion, ni movimientos)", async () => {
    const antes = await escrito();
    const r = await registrarVentaCasoDeUso(actor(), datos([{ productoId: cafeId, cantidadVendida: 1 }]));
    expect(r).toEqual(RECHAZO_CAFE);
    expect(await escrito()).toEqual(antes);
  });

  it("la Server Action (lo que ve la pantalla) devuelve el mismo texto, y tampoco escribe nada", async () => {
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
    const antes = await escrito();
    expect(await registrarVenta(datos([{ productoId: cafeId, cantidadVendida: 1 }]))).toEqual({ ok: false, mensaje: MENSAJE_CAFE });
    expect(await escrito()).toEqual(antes);
  });

  it("todo o nada: en un lote con un producto sin grupos y el café, no se vende ninguno de los dos (tampoco el de siempre)", async () => {
    const antes = await escrito();
    const r = await registrarVentaCasoDeUso(actor(), datos([{ productoId: gaseosaId, cantidadVendida: 2 }, { productoId: cafeId, cantidadVendida: 1 }]));
    expect(r).toEqual(RECHAZO_CAFE);
    expect(await escrito()).toEqual(antes);
  });

  it("el mínimo del PRODUCTO manda sobre el del grupo: con mínimo 0 en el producto se vende; un grupo opcional hecho obligatorio por el producto, se rechaza", async () => {
    await volverOpcional();
    expect((await registrarVentaCasoDeUso(actor(), datos([{ productoId: cafeId, cantidadVendida: 1 }]))).ok).toBe(true);

    // Un grupo OPCIONAL del grupo (VARIANTE de 0 a 1) que el producto vuelve obligatorio (mínimo 1 en su fila).
    const cocinado = await prisma.producto.create({ data: { codigo: "PV_BIFE", nombre: "Bife", tipo: "PV", unidadStockId: unidadId, precioVenta: 3000 } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: cocinado.id, disponible: true } });
    await darRecetaDeReventa(prisma, cocinado, { sucursalIds: [sucursalId], stock: { cantidad: 100, seccionIds: [seccionId], usuarioId: adminId } });
    const grupoPunto = await prisma.grupoDeOpciones.create({ data: { nombre: "Punto", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 } });
    await prisma.productoAdmiteGrupo.create({ data: { productoId: cocinado.id, grupoId: grupoPunto.id, orden: 0 } });
    expect((await registrarVentaCasoDeUso(actor(), datos([{ productoId: cocinado.id, cantidadVendida: 1 }]))).ok).toBe(true);
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: cocinado.id, grupoId: grupoPunto.id }, data: { cantidadMinima: 1 } });
    const antes = await escrito();
    expect(await registrarVentaCasoDeUso(actor(), datos([{ productoId: cocinado.id, cantidadVendida: 1 }]))).toEqual({ ok: false, codigo: "PRODUCTO_REQUIERE_OPCIONES", mensaje: "«Bife» se vende con opciones obligatorias (ej. tamaño): cobralo desde las mesas/POS, donde se eligen." });
    expect(await escrito()).toEqual(antes);
  });

  it("un grupo obligatorio APAGADO para la empresa también rechaza (falla cerrado: vender sin elegir lo obligatorio cobraría mal)", async () => {
    await prisma.grupoDeOpciones.update({ where: { id: grupoTamanoId }, data: { activo: false } });
    const antes = await escrito();
    expect(await registrarVentaCasoDeUso(actor(), datos([{ productoId: cafeId, cantidadVendida: 1 }]))).toEqual(RECHAZO_CAFE);
    expect(await escrito()).toEqual(antes);
  });

  it("todas las opciones del grupo obligatorio apagadas en la sucursal: no hay con qué cumplir el mínimo, también rechaza", async () => {
    for (const o of await prisma.opcionDeGrupo.findMany({ where: { grupoId: grupoTamanoId } })) {
      await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId, opcionId: o.id, apagada: true, actualizadoPorId: adminId } });
    }
    expect(await registrarVentaCasoDeUso(actor(), datos([{ productoId: cafeId, cantidadVendida: 1 }]))).toEqual(RECHAZO_CAFE);
  });

  it("con el grupo DESASIGNADO del producto (fila apagada) ya no hay nada obligatorio: se vende como siempre", async () => {
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: cafeId, grupoId: grupoTamanoId }, data: { activo: false } });
    expect((await registrarVentaCasoDeUso(actor(), datos([{ productoId: cafeId, cantidadVendida: 1 }]))).ok).toBe(true);
  });
});

describe("mostrador: lo que NO cambia", () => {
  it("un producto sin ningún grupo se vende igual que siempre (una Operacion VENTA, su consumo y su venta)", async () => {
    const r = await registrarVentaCasoDeUso(actor(), datos([{ productoId: gaseosaId, cantidadVendida: 2 }]));
    expect(r.ok, r.mensaje).toBe(true);
    expect(r.mensaje).toBe("Se registraron 1 venta(s) correctamente.");
    const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" }, include: { movimientos: true } });
    expect(venta.movimientos.map((m) => [m.proceso, Number(m.cantidad)]).sort()).toEqual([["CONSUMO", -2], ["VENTA", -2]]);
  });

  it("un producto con SOLO grupos opcionales (mínimo 0) se vende sin elegir nada, a su precio base", async () => {
    await volverOpcional();
    const r = await registrarVentaCasoDeUso(actor(), datos([{ productoId: cafeId, cantidadVendida: 1 }]));
    expect(r.ok, r.mensaje).toBe(true);
    const venta = await prisma.movimientoStock.findFirstOrThrow({ where: { proceso: "VENTA", productoId: cafeId } });
    expect(Number(venta.precioPorUnidadStock)).toBe(1000);
  });

  it("un lote de varios productos sin grupos obligatorios se vende entero (una Operacion por línea)", async () => {
    const r = await registrarVentaCasoDeUso(actor(), datos([{ productoId: gaseosaId, cantidadVendida: 1 }, { productoId: gaseosaId, cantidadVendida: 3 }]));
    expect(r.ok, r.mensaje).toBe(true);
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(2);
  });
});

describe("mostrador: idempotencia (I3) del rechazo", () => {
  it("el MISMO pedido con clave enviado dos veces seguidas rechaza las dos veces, sin efectos ni comprobante; con el grupo ya opcional, la MISMA clave vende una sola vez", async () => {
    const clave = randomUUID();
    const pedido = datos([{ productoId: cafeId, cantidadVendida: 1 }], { claveIdempotencia: clave });
    const antes = await escrito();
    for (let i = 0; i < 2; i++) {
      expect(await registrarVentaCasoDeUso(actor(), pedido)).toEqual(RECHAZO_CAFE);
      expect(await escrito()).toEqual(antes);
    }
    expect(await prisma.operacion.count({ where: { claveIdempotencia: clave } })).toBe(0);

    await volverOpcional();
    const vendida = await registrarVentaCasoDeUso(actor(), pedido);
    expect(vendida.ok, vendida.mensaje).toBe(true);
    const reenvio = await registrarVentaCasoDeUso(actor(), pedido);
    expect(reenvio).toEqual({ ok: true, mensaje: vendida.mensaje, datos: { operacionIds: null, repetida: true } });
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(1);
    expect(await prisma.operacion.count({ where: { claveIdempotencia: clave } })).toBe(1);
  });
});

describe("la lectura de los grupos: una por lote y dentro de la transacción", () => {
  it("N líneas, UNA sola lectura de lo que admiten los productos (la del POS, `cargarOpcionesParaVender`), no una por línea", async () => {
    const contar = async (ventas: DatosVentaInput["ventas"]) => {
      const registro: string[] = [];
      const transaccion: Transaccion = Object.assign(
        <T,>(fn: (tx: Parameters<Parameters<Transaccion>[0]>[0]) => Promise<T>, opciones?: Parameters<Transaccion>[1]) =>
          baseDe(sucursalId).transaccion(async (tx) => {
            const original = tx.producto.findMany.bind(tx.producto);
            (tx.producto as { findMany: unknown }).findMany = (...args: Parameters<typeof original>) => {
              registro.push(JSON.stringify(args[0]?.select ? Object.keys(args[0].select) : "sin-select").includes("gruposAdmitidos") ? "grupos" : "otra");
              return original(...args);
            };
            return fn(tx);
          }, opciones),
        { aleatorio: () => 0 }
      );
      const r = await registrarVentaCasoDeUso({ ...actor(), transaccion }, datos(ventas));
      expect(r.ok, r.mensaje).toBe(true);
      return registro.filter((x) => x === "grupos").length;
    };
    expect(await contar([{ productoId: gaseosaId, cantidadVendida: 1 }])).toBe(1);
    expect(await contar([{ productoId: gaseosaId, cantidadVendida: 1 }, { productoId: gaseosaId, cantidadVendida: 2 }, { productoId: gaseosaId, cantidadVendida: 3 }])).toBe(1);
  });

  it("intercalado forzado: la venta ya tomó su foto (SERIALIZABLE) cuando el grupo pasa a ser obligatorio y confirma; la venta sigue con la foto que leyó, o —si Postgres la hace reintentar— rechaza: nunca una venta a medias", async () => {
    await volverOpcional();
    let avisarFoto!: () => void;
    const fotoTomada = new Promise<void>((r) => (avisarFoto = r));
    let soltar!: () => void;
    const suelto = new Promise<void>((r) => (soltar = r));
    let intentos = 0;
    const transaccion: Transaccion = Object.assign(
      <T,>(fn: (tx: Parameters<Parameters<Transaccion>[0]>[0]) => Promise<T>, opciones?: Parameters<Transaccion>[1]) =>
        baseDe(sucursalId).transaccion(async (tx) => {
          intentos++;
          // La primera consulta de la transacción fija su foto; en el PRIMER intento la venta espera ahí hasta que el cambio del grupo confirmó.
          await tx.productoAdmiteGrupo.findMany({ where: { productoId: cafeId }, select: { cantidadMinima: true } });
          if (intentos === 1) {
            avisarFoto();
            await suelto;
          }
          return fn(tx);
        }, opciones),
      { aleatorio: () => 0 }
    );
    const venta = registrarVentaCasoDeUso({ ...actor(), transaccion }, datos([{ productoId: cafeId, cantidadVendida: 1 }]));
    await fotoTomada;
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: cafeId, grupoId: grupoTamanoId }, data: { cantidadMinima: 1 } });
    soltar();
    const r = await venta;

    const ventas = await prisma.operacion.findMany({ where: { proceso: "VENTA" }, include: { movimientos: true } });
    if (r.ok) {
      // La foto era la de antes del cambio: el grupo todavía era opcional. Venta completa (consumo + venta).
      expect(ventas).toHaveLength(1);
      expect(ventas[0]!.movimientos.map((m) => m.proceso).sort()).toEqual(["CONSUMO", "VENTA"]);
    } else {
      // Si el conflicto la hizo reintentar, el reintento ve el grupo obligatorio y rechaza sin escribir.
      expect(intentos).toBeGreaterThan(1);
      expect(r).toEqual(RECHAZO_CAFE);
      expect(ventas).toEqual([]);
    }
  });
});

describe("Fase 4 (ADR-035): un producto que se vende por opción no se cobra suelto (defensa del núcleo)", () => {
  it("una base SIN ninguna admisión (escrita a mano por SQL) se rechaza en el mostrador con PRODUCTO_REQUIERE_OPCIONES y no se escribe nada; como directo, se vende", async () => {
    await prisma.producto.update({ where: { id: gaseosaId }, data: { modoDeVenta: "BASE_CONFIGURABLE" } });
    const antes = await escrito();
    const r = await registrarVentaCasoDeUso(actor(), datos([{ productoId: gaseosaId, cantidadVendida: 1 }]));
    expect(r).toEqual({ ok: false, codigo: "PRODUCTO_REQUIERE_OPCIONES", mensaje: "«Gaseosa» se vende por opción: no tiene un precio propio que cobrar suelto. Cobralo desde las mesas/POS, eligiendo su opción." });
    expect(await escrito()).toEqual(antes);
    await prisma.producto.update({ where: { id: gaseosaId }, data: { modoDeVenta: "DIRECTO" } });
    expect(await registrarVentaCasoDeUso(actor(), datos([{ productoId: gaseosaId, cantidadVendida: 1 }]))).toMatchObject({ ok: true });
  });
});
