import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../../setup/test-db";
import { crearMozo, entrarComo, sembrarSalon } from "../salon-fixture";
import { crearMesa, actualizarMaxMesasAbiertas } from "../../../src/server/actions/pos/mesas";
import { abrirCuenta, asignarClienteACuenta, corregirComensales, liberarMesa } from "../../../src/server/actions/pos/cuenta-apertura";
import { agregarItems, enviarACocina, quitarItemSinEnviar, quitarPromoSinEnviar } from "../../../src/server/actions/pos/cuenta-pedido";

/**
 * HUELLA del POS (Hito 4, paso 0.1 de `docs/plan-hito-4-pureza.md` §5): las 10 Server Actions del POS que todavía no pasan por un caso de uso —apertura y
 * mesas (`abrirCuenta`, `corregirComensales`, `asignarClienteACuenta`, `liberarMesa`, `crearMesa`, `actualizarMaxMesasAbiertas`) y pedido (`agregarItems`,
 * `quitarPromoSinEnviar`, `quitarItemSinEnviar`, `enviarACocina`)— recorridas por las acciones públicas, con la sesión de un admin, de un «mozo» armado desde la
 * matriz y del operador de fábrica (sin ninguna clave del salón). Se escribe ANTES de mover nada (contra el código de `4c00ab79`) y NO se edita en ningún paso
 * posterior: si una mudanza cambia una fila, un mensaje, el orden de dos chequeos o el de dos filas de auditoría, este archivo lo tiene que ver en rojo. Para
 * regenerarlo A PROPÓSITO (una decisión de producto, nunca una mudanza): `REGENERAR_HUELLA_DEL_POS=1 npx vitest run test/pos/caracterizacion/huella-del-pos.test.ts`;
 * la regeneración se declara además en `test/arquitectura/caracterizaciones-congeladas.test.ts`. Archivo propio y no snapshots de Vitest, para que `-u` no lo
 * regenere en silencio.
 *
 * Es UNA secuencia con estado (un turno del salón): alta de mesas y límite; abrir, reabrir, corregir comensales, asignar y quitar un cliente, liberar; cargar,
 * quitar y enviar ítems y promos; el mozo haciendo su circuito; y cada rechazo con su texto. Hay pasos con DOS FALLAS A LA VEZ (cuenta cerrada + comensales
 * inválidos, mesa ya abierta + comensales inválidos, cuenta de otra sucursal + lista vacía, id que no es texto + lista vacía, límite alcanzado + comensales
 * inválidos): fijan qué chequeo gana, que es lo primero que una mudanza puede dar vuelta sin querer. Después de cada paso se vuelcan el resultado y TODAS las
 * filas de `Mesa`, `Cuenta`, `CuentaItem`, `PromoCuenta`, `Sucursal` (nombre y `maxMesasAbiertas`) y `RegistroAuditoria` de la empresa, con todas sus columnas
 * (las fechas, solo si hay o no: `<fecha>`/`null`), los ids reemplazados por nombres simbólicos y la auditoría ordenada por `[creadoEn, id]`.
 */
const ARCHIVO = join(__dirname, "huella-del-pos.golden.txt");
const E = EMPRESA_POR_DEFECTO_ID;

afterAll(async () => {
  await limpiarBaseDeTest();
});

describe("Huella del POS (las 10 acciones sin caso de uso)", () => {
  const nombres = new Map<string, string>();
  const contadores = new Map<string, number>();
  const lineas: string[] = [];

  /** Le da un nombre a un id la primera vez que se lo ve (`cuenta1`, `item3`…) y lo conserva: borrar una fila no corre los nombres de las otras. */
  const nombrar = (prefijo: string, id: string): void => {
    if (nombres.has(id)) return;
    const n = (contadores.get(prefijo) ?? 0) + 1;
    contadores.set(prefijo, n);
    nombres.set(id, `${prefijo}${n}`);
  };
  const simbolo = (valor: string): string => (nombres.get(valor) ?? valor).replace(/c[a-z0-9]{20,}/g, (id) => nombres.get(id) ?? "<id-sin-nombre>");

  const fila = (f: Record<string, unknown>): string =>
    Object.keys(f)
      .sort()
      .map((columna) => {
        const v = f[columna];
        if (v === null || v === undefined) return `${columna}=null`;
        if (v instanceof Date) return `${columna}=<fecha>`;
        if (v instanceof Prisma.Decimal) return `${columna}=${v.toString()}`;
        if (typeof v === "string") return `${columna}=${simbolo(v)}`;
        return `${columna}=${String(v)}`;
      })
      .join(" ");

  /** Vuelca las tablas del salón de la empresa, con todas sus columnas; nombra en orden de creación lo que aparece por primera vez. */
  async function volcado(): Promise<string[]> {
    const donde = { empresaId: E };
    const porCreacion = [{ creadoEn: "asc" as const }, { id: "asc" as const }];
    const mesas = await prismaAdmin.mesa.findMany({ where: donde, orderBy: porCreacion });
    mesas.forEach((m) => nombrar("mesa", m.id));
    const cuentas = await prismaAdmin.cuenta.findMany({ where: donde, orderBy: [{ abiertaEn: "asc" }, { id: "asc" }] });
    cuentas.forEach((c) => nombrar("cuenta", c.id));
    const promos = await prismaAdmin.promoCuenta.findMany({ where: donde, orderBy: porCreacion });
    promos.forEach((p) => nombrar("promoCuenta", p.id));
    const items = await prismaAdmin.cuentaItem.findMany({ where: donde, orderBy: porCreacion });
    items.forEach((i) => nombrar("item", i.id));
    const auditoria = await prismaAdmin.registroAuditoria.findMany({ where: donde, orderBy: porCreacion });
    auditoria.forEach((a) => nombrar("auditoria", a.id));
    const sucursales = await prismaAdmin.sucursal.findMany({ where: donde, orderBy: { nombre: "asc" }, select: { id: true, nombre: true, maxMesasAbiertas: true } });
    const filas = (titulo: string, datos: object[]) => datos.map((d) => `  ${titulo} ${fila({ ...(d as Record<string, unknown>) })}`);
    return [
      ...filas("SUCURSAL", sucursales),
      ...filas("MESA", mesas),
      ...filas("CUENTA", cuentas),
      ...filas("PROMO_CUENTA", promos),
      ...filas("ITEM", items),
      ...filas("AUDITORIA", auditoria),
    ];
  }

  const paso = async (titulo: string, resultado: unknown) => {
    lineas.push(`### ${titulo}`, `  resultado: ${JSON.stringify(resultado, (_, v) => (typeof v === "string" ? simbolo(v) : v))}`, ...(await volcado()));
  };

  beforeEach(async () => {
    nombres.clear();
    contadores.clear();
    lineas.length = 0;
    await limpiarBaseDeTest();
  });

  it("la secuencia entera coincide con lo guardado", async () => {
    const s = await sembrarSalon();
    const mozo = await crearMozo(s.sucursalId);
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: s.sucursalId, rolId: s.operador.id });
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const mesaNorte = await prisma.mesa.create({ data: { sucursalId: norte.id, numero: 9 } });
    const cuentaNorte = await prisma.cuenta.create({ data: { mesaId: mesaNorte.id, abiertaPorId: s.admin.id, comensales: 2 } });
    const fulano = await prisma.cliente.create({ data: { nombre: "Fulano", descuentoPorcentaje: 15 } });
    const mengano = await prisma.cliente.create({ data: { nombre: "Mengano", descuentoPorcentaje: 10, activo: false } });

    // La promo «Menú del día» (Milanesa $9000 + Flan $3000 a $10000: prorrateo exacto 7500/2500), como en promo-cuenta-action.test.ts.
    const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos" } });
    const postres = await prisma.seccionCarta.create({ data: { nombre: "Postres" } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.milanesa.id, visibleEnCarta: true, seccionCartaId: platos.id } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.flan.id, visibleEnCarta: true, seccionCartaId: postres.id } });
    const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: platos.id, titulo: "Menú del día", precio: 10000 } });
    await prisma.promoCartaCupo.createMany({
      data: [
        { promoCartaId: promo.id, seccionCartaId: platos.id, cantidadMinima: 1, cantidadMaxima: 1, orden: 0 },
        { promoCartaId: promo.id, seccionCartaId: postres.id, cantidadMinima: 1, cantidadMaxima: 1, orden: 1 },
      ],
    });
    const menuDelDia = [
      {
        promoCartaId: promo.id,
        elecciones: [
          { seccionCartaId: platos.id, elegidos: [{ productoId: s.milanesa.id, cantidad: 1 }] },
          { seccionCartaId: postres.id, elegidos: [{ productoId: s.flan.id, cantidad: 1 }] },
        ],
      },
    ];

    const fijos: Record<string, string> = {
      [E]: "empresa",
      [s.sucursalId]: "central",
      [norte.id]: "norte",
      [s.admin.id]: "admin",
      [mozo.id]: "mozo",
      [operador.id]: "operador",
      [s.milanesa.id]: "milanesa",
      [s.flan.id]: "flan",
      [s.pizza.id]: "pizza",
      [s.muzzarella.id]: "muzzarella",
      [fulano.id]: "fulano",
      [mengano.id]: "mengano",
      [promo.id]: "promoMenu",
      [s.mesa.id]: "mesa4",
      [mesaNorte.id]: "mesaNorte9",
      [cuentaNorte.id]: "cuentaNorte",
    };
    for (const [id, nombre] of Object.entries(fijos)) nombres.set(id, nombre);

    const cuentaAbiertaDe = async (mesaId: string) => (await prisma.cuenta.findFirstOrThrow({ where: { mesaId, cerradaEn: null } })).id;
    const itemDe = async (cuentaId: string, productoId: string, conPromo: boolean) =>
      (await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId, productoId, promoCuentaId: conPromo ? { not: null } : null, numeroEnvio: null }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] })).id;

    // ── A. Mesas y límite (admin) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    await entrarComo(s.admin);
    const alta5 = await crearMesa(5);
    const mesa5 = (await prisma.mesa.findFirstOrThrow({ where: { sucursalId: s.sucursalId, numero: 5 } })).id;
    nombres.set(mesa5, "mesa5");
    await paso("A1. Alta de la mesa 5", alta5);
    await paso("A2. Alta de la mesa 5 otra vez (número repetido)", await crearMesa(5));
    await paso("A3. Números inválidos: 0, 1,5, 10000, NaN y un texto", [await crearMesa(0), await crearMesa(1.5), await crearMesa(10000), await crearMesa(Number.NaN), await crearMesa("7" as unknown as number)]);
    await paso("A4. Límite de mesas abiertas en 3", await actualizarMaxMesasAbiertas(3));
    await paso("A5. El mismo límite otra vez (sin auditoría nueva)", await actualizarMaxMesasAbiertas(3));
    await paso("A6. Límites inválidos: 0, 2,5, 10000 y un texto", [await actualizarMaxMesasAbiertas(0), await actualizarMaxMesasAbiertas(2.5), await actualizarMaxMesasAbiertas(10000), await actualizarMaxMesasAbiertas("4" as unknown as number)]);
    await paso("A7. Sin límite (null)", await actualizarMaxMesasAbiertas(null));

    // ── B. Apertura (admin) ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    await paso("B1. Abrir la mesa 4 con 2 comensales", await abrirCuenta(s.mesa.id, 2));
    const cuenta4 = await cuentaAbiertaDe(s.mesa.id);
    await paso("B2. Reabrir la mesa 4 con 5 (conserva los 2)", await abrirCuenta(s.mesa.id, 5));
    await paso("B3. DOS FALLAS: mesa ya abierta + comensales inválidos (0)", await abrirCuenta(s.mesa.id, 0));
    await paso("B4. Una mesa de otra sucursal", await abrirCuenta(mesaNorte.id, 2));
    await paso("B5. DOS FALLAS: id de mesa que no es texto + comensales inválidos", await abrirCuenta(123 as unknown as string, 0));
    await paso("B6. Una mesa que no existe", await abrirCuenta("mesa-que-no-existe", 2));
    await paso("B7. Comensales inválidos en una mesa libre: 0, 1,5, 100 y un texto", [await abrirCuenta(mesa5, 0), await abrirCuenta(mesa5, 1.5), await abrirCuenta(mesa5, 100), await abrirCuenta(mesa5, "2" as unknown as number)]);
    await actualizarMaxMesasAbiertas(1);
    await paso("B8. Con el límite en 1 (ya hay una abierta), abrir la mesa 5", await abrirCuenta(mesa5, 2));
    await paso("B9. DOS FALLAS: límite alcanzado + comensales inválidos", await abrirCuenta(mesa5, 0));
    await paso("B10. Con el límite alcanzado, reabrir la MISMA mesa 4", await abrirCuenta(s.mesa.id, 3));
    await actualizarMaxMesasAbiertas(null);
    await paso("B11. Corregir los comensales de la mesa 4 a 4", await corregirComensales(cuenta4, 4));
    await paso("B12. Corregir con valores inválidos: 0, 100, un texto", [await corregirComensales(cuenta4, 0), await corregirComensales(cuenta4, 100), await corregirComensales(cuenta4, "3" as unknown as number)]);
    await paso("B13. DOS FALLAS: cuenta de otra sucursal + comensales inválidos", await corregirComensales(cuentaNorte.id, 0));
    await paso("B14. DOS FALLAS: id de cuenta que no es texto + comensales inválidos", await corregirComensales(42 as unknown as string, 0));

    // ── C. Cliente con descuento (admin) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    await paso("C1. Asignar a Fulano (15%)", await asignarClienteACuenta(cuenta4, fulano.id));
    await prisma.cliente.update({ where: { id: fulano.id }, data: { descuentoPorcentaje: 20 } });
    await paso("C2. Fulano pasa a 20% en el catálogo; la cuenta conserva el 15% congelado", "ver CUENTA");
    await paso("C3. Un cliente que no existe", await asignarClienteACuenta(cuenta4, "cliente-que-no-existe"));
    await paso("C4. Un cliente desactivado", await asignarClienteACuenta(cuenta4, mengano.id));
    await paso("C5. Un id de cliente que no es texto", await asignarClienteACuenta(cuenta4, 7 as unknown as string));
    await paso("C6. Asignar otra vez a Fulano (toma el 20% de ahora)", await asignarClienteACuenta(cuenta4, fulano.id));
    await paso("C7. Quitar el cliente", await asignarClienteACuenta(cuenta4, null));
    await paso("C8. Quitar otra vez (ya no tenía)", await asignarClienteACuenta(cuenta4, null));
    await paso("C9. DOS FALLAS: cuenta de otra sucursal + cliente inexistente", await asignarClienteACuenta(cuentaNorte.id, "cliente-que-no-existe"));
    await paso("C10. Asignar a Fulano otra vez", await asignarClienteACuenta(cuenta4, fulano.id));

    // ── D. Liberar (admin) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    await paso("D1. Abrir la mesa 5 con 3 comensales", await abrirCuenta(mesa5, 3));
    const cuenta5 = await cuentaAbiertaDe(mesa5);
    await paso("D2. Liberar la mesa 5 (sin ítems)", await liberarMesa(cuenta5));
    await paso("D3. Liberar otra vez la misma cuenta (ya cerrada)", await liberarMesa(cuenta5));
    await paso("D4. DOS FALLAS: cuenta cerrada + comensales inválidos", await corregirComensales(cuenta5, 0));
    await paso("D5. DOS FALLAS: cuenta cerrada + cliente inexistente", await asignarClienteACuenta(cuenta5, "cliente-que-no-existe"));
    await paso("D6. Liberar una cuenta de otra sucursal, una que no existe y un id que no es texto", [await liberarMesa(cuentaNorte.id), await liberarMesa("cuenta-que-no-existe"), await liberarMesa(5 as unknown as string)]);

    // ── E. Pedido (admin) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    await paso("E1. Agregar 2 Milanesas y 1 Flan", await agregarItems(cuenta4, [{ productoId: s.milanesa.id, cantidad: 2 }, { productoId: s.flan.id, cantidad: 1 }]));
    await paso("E2. Agregar la promo Menú del día", await agregarItems(cuenta4, [], menuDelDia));
    await paso("E3. Agregar una materia prima (no es PV)", await agregarItems(cuenta4, [{ productoId: s.muzzarella.id, cantidad: 1 }]));
    await paso("E4. Agregar un producto que no existe y un id que no es texto", [await agregarItems(cuenta4, [{ productoId: "producto-que-no-existe", cantidad: 1 }]), await agregarItems(cuenta4, [{ productoId: 9 as unknown as string, cantidad: 1 }])]);
    await paso("E5. Cantidad 0 (inválida) y 1,5 de una unidad sin decimales (se redondea)", [await agregarItems(cuenta4, [{ productoId: s.flan.id, cantidad: 0 }]), await agregarItems(cuenta4, [{ productoId: s.flan.id, cantidad: 1.5 }])]);
    await paso("E6. Todo o nada: un Flan válido y una materia prima", await agregarItems(cuenta4, [{ productoId: s.flan.id, cantidad: 1 }, { productoId: s.muzzarella.id, cantidad: 1 }]));
    await paso("E7. Más de 50 ítems de una vez", await agregarItems(cuenta4, Array.from({ length: 51 }, () => ({ productoId: s.flan.id, cantidad: 1 }))));
    await paso("E8. DOS FALLAS: cuenta de otra sucursal + lista vacía", await agregarItems(cuentaNorte.id, []));
    await paso("E9. DOS FALLAS: id de cuenta que no es texto + lista vacía", await agregarItems(11 as unknown as string, []));
    await paso("E10. DOS FALLAS: cuenta cerrada + lista vacía", await agregarItems(cuenta5, []));
    await paso("E11. Agregar a una cuenta cerrada y a una de otra sucursal", [await agregarItems(cuenta5, [{ productoId: s.flan.id, cantidad: 1 }]), await agregarItems(cuentaNorte.id, [{ productoId: s.flan.id, cantidad: 1 }])]);
    await paso("E12. Una promo que no existe y una elección incompleta", [
      await agregarItems(cuenta4, [], [{ promoCartaId: "promo-que-no-existe", elecciones: [] }]),
      await agregarItems(cuenta4, [], [{ promoCartaId: promo.id, elecciones: [{ seccionCartaId: platos.id, elegidos: [{ productoId: s.milanesa.id, cantidad: 1 }] }] }]),
    ]);
    await paso("E13. Liberar la mesa 4 con ítems cargados", await liberarMesa(cuenta4));

    const flanSuelto = await itemDe(cuenta4, s.flan.id, false);
    const flanDeLaPromo = await itemDe(cuenta4, s.flan.id, true);
    const promoCuenta1 = (await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId: cuenta4 } })).id;
    await paso("E14. Quitar el componente de una promo suelto", await quitarItemSinEnviar(flanDeLaPromo));
    await paso("E15. Quitar el Flan suelto sin enviar", await quitarItemSinEnviar(flanSuelto));
    await paso("E16. Quitar otra vez el mismo ítem, uno que no existe y un id que no es texto", [await quitarItemSinEnviar(flanSuelto), await quitarItemSinEnviar("item-que-no-existe"), await quitarItemSinEnviar(3 as unknown as string)]);
    await paso("E17. Quitar la promo sin enviar", await quitarPromoSinEnviar(promoCuenta1));
    await paso("E18. Quitar otra vez la misma promo y un id que no es texto", [await quitarPromoSinEnviar(promoCuenta1), await quitarPromoSinEnviar(4 as unknown as string)]);

    await paso("E19. Agregar la promo otra vez", await agregarItems(cuenta4, [], menuDelDia));
    const milanesaSuelta = await itemDe(cuenta4, s.milanesa.id, false);
    await paso("E20. Enviar a cocina solo la Milanesa suelta", await enviarACocina(cuenta4, [milanesaSuelta]));
    await paso("E21. Enviar otra vez lo mismo (idempotente)", await enviarACocina(cuenta4, [milanesaSuelta]));
    await paso("E22. Quitar la Milanesa ya enviada", await quitarItemSinEnviar(milanesaSuelta));
    const milanesaDeLaPromo = await itemDe(cuenta4, s.milanesa.id, true);
    await paso("E23. Enviar un componente de la promo (sale la promo entera)", await enviarACocina(cuenta4, [milanesaDeLaPromo]));
    const promoCuenta2 = (await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId: cuenta4 } })).id;
    await paso("E24. Quitar la promo ya enviada", await quitarPromoSinEnviar(promoCuenta2));
    await paso("E25. Enviar sin ids, con un id que no es texto y con más de 200", [
      await enviarACocina(cuenta4, []),
      await enviarACocina(cuenta4, [5 as unknown as string]),
      await enviarACocina(cuenta4, Array.from({ length: 201 }, (_, i) => `id-${i}`)),
    ]);
    await paso("E26. DOS FALLAS: cuenta de otra sucursal + lista vacía", await enviarACocina(cuentaNorte.id, []));
    await paso("E27. Enviar a una cuenta de otra sucursal, a una cerrada y con un id de cuenta que no es texto", [
      await enviarACocina(cuentaNorte.id, [milanesaSuelta]),
      await enviarACocina(cuenta5, [milanesaSuelta]),
      await enviarACocina(12 as unknown as string, [milanesaSuelta]),
    ]);

    // ── F. El mozo hace su circuito ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    await entrarComo(mozo);
    await paso("F1. Mozo: abrir la mesa 5 con 2", await abrirCuenta(mesa5, 2));
    const cuenta5b = await cuentaAbiertaDe(mesa5);
    await paso("F2. Mozo: corregir a 3, asignar a Fulano, agregar un Flan", [await corregirComensales(cuenta5b, 3), await asignarClienteACuenta(cuenta5b, fulano.id), await agregarItems(cuenta5b, [{ productoId: s.flan.id, cantidad: 1 }])]);
    const flanDelMozo = await itemDe(cuenta5b, s.flan.id, false);
    await paso("F3. Mozo: enviar a cocina y liberar (no se puede, tiene ítems)", [await enviarACocina(cuenta5b, [flanDelMozo]), await liberarMesa(cuenta5b)]);
    await paso("F4. Mozo: alta de mesa y límite (sin esas claves)", [await crearMesa(8), await actualizarMaxMesasAbiertas(2)]);

    // ── G. El operador de fábrica (sin ninguna clave del salón) ─────────────────────────────────────────────────────────────────────────────────────────────
    await entrarComo(operador);
    await paso("G1. Operador: las 10 acciones", [
      await crearMesa(8),
      await actualizarMaxMesasAbiertas(2),
      await abrirCuenta(mesa5, 2),
      await corregirComensales(cuenta4, 2),
      await asignarClienteACuenta(cuenta4, null),
      await liberarMesa(cuenta4),
      await agregarItems(cuenta4, [{ productoId: s.flan.id, cantidad: 1 }]),
      await quitarPromoSinEnviar(promoCuenta2),
      await quitarItemSinEnviar(flanDelMozo),
      await enviarACocina(cuenta4, [flanDelMozo]),
    ]);

    const actual = lineas.join("\n") + "\n";
    expect(actual.length).toBeGreaterThan(20_000); // si el escenario no armó nada, esto no está mirando nada
    expect(actual).not.toContain("<id-sin-nombre>");

    if (process.env.REGENERAR_HUELLA_DEL_POS === "1") {
      mkdirSync(__dirname, { recursive: true });
      writeFileSync(ARCHIVO, actual, "utf8");
      return;
    }
    expect(existsSync(ARCHIVO), "falta huella-del-pos.golden.txt: generalo contra el código ANTERIOR a la mudanza").toBe(true);
    expect(actual.replace(/\r\n/g, "\n")).toBe(readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n"));
  }, 180_000);
});
