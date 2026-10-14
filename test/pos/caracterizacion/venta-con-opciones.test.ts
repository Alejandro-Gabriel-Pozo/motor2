import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarCompraDeKardex } from "../../setup/test-db";
import { elegida, sembrarCafeDelSalon } from "../../setup/opciones";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../salon-fixture";
import { agregarItems, enviarACocina } from "../../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuenta } from "../../../src/server/actions/pos/cuenta-cierre";

/**
 * CARACTERIZACIÓN NUEVA de la venta CON OPCIONES (GO-2b, ADR-030): una cuenta del salón con un café grande con almendras y dos shots, dos cafés chicos, el mismo grande
 * otra vez y un flan sin opciones, enviada a cocina y cerrada con un cliente con descuento. Después de cada paso se vuelcan el resultado y TODAS las filas de
 * `CuentaItem`, `OpcionElegidaEnLinea`, `Operacion` y `MovimientoStock` de la empresa (las fechas solo como `<fecha>`, los ids con nombres simbólicos). No regenera
 * NINGUNA caracterización vieja: es una más, congelada en `test/arquitectura/caracterizaciones-congeladas.test.ts`. Para regenerarla A PROPÓSITO (una decisión de
 * producto): `REGENERAR_VENTA_CON_OPCIONES=1 npx vitest run test/pos/caracterizacion/venta-con-opciones.test.ts`, y declararlo en el guardián.
 */
const ARCHIVO = join(__dirname, "venta-con-opciones.golden.txt");
const E = EMPRESA_POR_DEFECTO_ID;
const ENMASCARADAS = new Set(["creadoEn", "fecha", "actualizadoEn", "cerradaEn", "abiertaEn", "emitidoEn"]);

afterAll(async () => {
  await limpiarBaseDeTest();
});

describe("Caracterización de la venta con opciones (GO-2b)", () => {
  const nombres = new Map<string, string>();
  const contadores = new Map<string, number>();
  const lineas: string[] = [];
  const nombrar = (prefijo: string, id: string) => {
    if (nombres.has(id)) return;
    const n = (contadores.get(prefijo) ?? 0) + 1;
    contadores.set(prefijo, n);
    nombres.set(id, `${prefijo}${n}`);
  };
  const simbolo = (v: string) => nombres.get(v) ?? v.replace(/c[a-z0-9]{20,}/g, (id) => nombres.get(id) ?? "<id-sin-nombre>");
  const fila = (f: Record<string, unknown>) =>
    Object.keys(f)
      .sort()
      .map((k) => {
        const v = f[k];
        if (v === null || v === undefined) return `${k}=null`;
        if (v instanceof Date || ENMASCARADAS.has(k)) return `${k}=<fecha>`;
        if (v instanceof Prisma.Decimal) return `${k}=${v.toString()}`;
        if (typeof v === "string") return `${k}=${simbolo(v)}`;
        return `${k}=${String(v)}`;
      })
      .join(" ");

  async function volcado(): Promise<string[]> {
    const donde = { empresaId: E };
    const orden = [{ creadoEn: "asc" as const }, { id: "asc" as const }];
    const items = await prismaAdmin.cuentaItem.findMany({ where: donde, orderBy: orden });
    items.forEach((i) => nombrar("item", i.id));
    // La huella es un SHA-256 de ids que cambian por corrida: va con nombre simbólico (misma huella, mismo nombre).
    items.forEach((i) => i.huellaOpciones !== null && nombrar("huella", i.huellaOpciones));
    const fotos = await prismaAdmin.opcionElegidaEnLinea.findMany({ where: donde, orderBy: [{ creadoEn: "asc" }, { cuentaItemId: "asc" }, { orden: "asc" }] });
    fotos.forEach((f) => nombrar("foto", f.id));
    const ops = await prismaAdmin.operacion.findMany({ where: { ...donde, proceso: "VENTA" }, orderBy: orden });
    ops.forEach((o) => nombrar("op", o.id));
    const movs = await prismaAdmin.movimientoStock.findMany({ where: { ...donde, operacion: { proceso: "VENTA" } }, orderBy: orden });
    movs.forEach((m) => nombrar("mov", m.id));
    const tabla = (t: string, filas: object[]) => filas.map((d) => `  ${t} ${fila(d as Record<string, unknown>)}`);
    return [...tabla("ITEM", items), ...tabla("FOTO", fotos), ...tabla("OPERACION", ops), ...tabla("MOVIMIENTO", movs)];
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
    const c = await sembrarCafeDelSalon(s);
    await entrarComo(s.admin);
    const fijos: Record<string, string> = {
      [E]: "empresa",
      [s.sucursalId]: "central",
      [s.admin.id]: "admin",
      [s.seccion.id]: "salon",
      [s.flan.id]: "flan",
      [s.flanReventa.id]: "flanReventa", // RECETA (ADR-033): la MP de la receta de reventa del flan (el fixture del salón)
      [c.cafeId]: "cafe",
      [c.lecheId]: "leche",
      [c.almendrasInsumoId]: "bebidaDeAlmendras",
      [c.granoId]: "grano",
      [c.anclaDelShotId]: "anclaShot",
      [c.grupoMedidaId]: "grupoTamaño",
      [c.grupoLecheId]: "grupoLeche",
      [c.grupoExtrasId]: "grupoExtras",
      [c.chicoId]: "chico",
      [c.grandeId]: "grande",
      [c.almendrasId]: "almendras",
      [c.shotId]: "shot",
      [c.versionDe[c.chicoId]!]: "chico.v1",
      [c.versionDe[c.grandeId]!]: "grande.v1",
      [c.versionDe[c.almendrasId]!]: "almendras.v1",
      [c.versionDe[c.shotId]!]: "shot.v1",
    };
    for (const [id, nombre] of Object.entries(fijos)) nombres.set(id, nombre);
    for (const [productoId, precio] of [[c.lecheId, 1500], [c.almendrasInsumoId, 2000], [c.granoId, 20000]] as const) {
      await sembrarCompraDeKardex({ sucursalId: s.sucursalId, seccionId: s.seccion.id, usuarioId: s.admin.id, productoId, proveedorId: null, fecha: "2026-10-01T12:00:00Z", precioPorUnidadStock: precio });
    }
    const cliente = await prisma.cliente.create({ data: { nombre: "Fulano", descuentoPorcentaje: 10 } });
    nombres.set(cliente.id, "fulano");
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    nombres.set(cuenta.id, "cuenta");
    await prisma.cuenta.update({ where: { id: cuenta.id }, data: { clienteId: cliente.id, descuentoPorcentaje: 10 } });

    const grande = [elegida(c, c.grandeId), elegida(c, c.almendrasId), elegida(c, c.shotId, 2)];
    await paso(
      "1. Agregar: café grande con almendras y dos shots, dos cafés chicos y un flan",
      await agregarItems(cuenta.id, [
        { productoId: c.cafeId, cantidad: 1, opciones: grande },
        { productoId: c.cafeId, cantidad: 2, opciones: [elegida(c, c.chicoId)] },
        { productoId: s.flan.id, cantidad: 1 },
      ])
    );
    await paso("2. Agregar otra vez el mismo café grande (misma configuración)", await agregarItems(cuenta.id, [{ productoId: c.cafeId, cantidad: 1, opciones: grande }]));
    const sinEnviar = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id, numeroEnvio: null }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    await paso("3. Enviar a cocina todo", await enviarACocina(cuenta.id, sinEnviar.map((i) => i.id)));
    await paso("4. Cerrar la cuenta (cliente con 10%)", await cerrarCuenta(cuenta.id));

    const texto = lineas.join("\n") + "\n";
    if (process.env.REGENERAR_VENTA_CON_OPCIONES === "1" || !existsSync(ARCHIVO)) writeFileSync(ARCHIVO, texto);
    expect(texto).toBe(readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n"));
  });
});
