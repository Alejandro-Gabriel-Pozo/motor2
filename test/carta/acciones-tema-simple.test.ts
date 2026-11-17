import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { DATOS_EMPRESA_TESTIGO, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { guardarTemaSimpleCarta } from "../../src/server/actions/carta/tema";
import { guardarTemaSimpleCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/guardar-tema-simple-carta";
import { MENSAJE_TEMA_SIMPLE_APAGADO } from "../../src/core/carta/tema-simple";
import { ALGO_AJENO_CARGADO, TODO_LO_AJENO_CARGADO } from "./tema-simple.oraculo";

/**
 * Guardado simple del Tema de la carta (PASO A de «Apariencia y publicación», `docs/diseno-carta-apariencia-y-publicacion-como-pedernal-2026-11-17.md`), contra Postgres real: el interruptor, la MEZCLA («lo cargado manda»: cambia solo las siete
 * claves y conserva todo lo demás y `aplicarEnCarta`), la idempotencia (guardar dos veces lo mismo no versiona), la concurrencia real (dos guardados con la misma versión: gana uno), los permisos (el operador no; el administrador y el gerente sí),
 * el aislamiento (otra sucursal y otra empresa no se tocan) y los validadores. La acción se llama con el interruptor encendido por la variable de prueba (`MOTOR2_PRUEBAS_TEMA_SIMPLE`).
 */
describe("guardado simple del tema de la carta", () => {
  let centralId: string;
  let operadorRolId: string;
  let adminRolId: string;
  let adminId: string;

  const fila = (sucursalId = centralId) => prisma.temaCartaSucursal.findFirst({ where: { sucursalId } });
  const guardado = async () => (await fila())?.valores;
  /** La versión que vería la pantalla ahora. */
  const versionVigente = async () => (await fila())?.actualizadoEn.toISOString() ?? "sin-tema";
  const guardar = async (valores: Record<string, unknown>, version?: string) => guardarTemaSimpleCarta(centralId, valores, version ?? (await versionVigente()));

  beforeEach(async () => {
    process.env.MOTOR2_PRUEBAS_TEMA_SIMPLE = "si";
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    operadorRolId = base.operador.id;
    adminRolId = base.admin.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: adminRolId });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  afterEach(() => {
    delete process.env.MOTOR2_PRUEBAS_TEMA_SIMPLE;
  });

  describe("interruptor", () => {
    it("apagado, el servidor rechaza aunque el pedido se arme a mano y no escribe nada", async () => {
      delete process.env.MOTOR2_PRUEBAS_TEMA_SIMPLE;
      expect(await guardarTemaSimpleCarta(centralId, { color_marca: "#1f4e79" }, "sin-tema")).toEqual({ ok: false, mensaje: MENSAJE_TEMA_SIMPLE_APAGADO });
      expect(await prisma.temaCartaSucursal.count()).toBe(0);
    });

    it("apagado, el permiso sigue siendo lo primero: el operador recibe el rechazo de permiso, no el del interruptor", async () => {
      delete process.env.MOTOR2_PRUEBAS_TEMA_SIMPLE;
      const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: centralId, rolId: operadorRolId });
      await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
      const r = await guardarTemaSimpleCarta(centralId, { color_marca: "#1f4e79" }, "sin-tema");
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
    });
  });

  describe("guardar", () => {
    it("en una sucursal sin tema lo crea, ya aplicado, con el color elegido, el marcador de la marca oscura y las demás claves de la pantalla", async () => {
      const r = await guardar({
        color_marca: "#1f4e79",
        restaurante_logo_url: "https://cdn.example.com/logo.png",
        restaurante_nombre: "La Parrilla",
        restaurante_instagram: "laparrilla",
        restaurante_facebook: "",
        restaurante_whatsapp: "+54 9 294 123-4567",
        restaurante_footer_maps_url: "https://maps.app.goo.gl/x",
      });
      expect(r).toEqual({ ok: true, mensaje: 'Tema de "Central" guardado. Está aplicado: la carta toma los cambios en hasta 5 minutos.' });
      const f = await fila();
      expect(f?.aplicarEnCarta).toBe(true);
      expect(f?.empresaId).toBe(EMPRESA_POR_DEFECTO_ID);
      expect(f?.valores).toEqual({
        color_marca: "#1f4e79",
        marca_derivada: "oscura",
        restaurante_logo_url: "https://cdn.example.com/logo.png",
        restaurante_nombre: "La Parrilla",
        restaurante_instagram: "laparrilla",
        restaurante_whatsapp: "5492941234567",
        restaurante_footer_maps_url: "https://maps.app.goo.gl/x",
      });
    });

    it("NO rechaza por contraste: un color que no se lee (blanco, negro, amarillo claro) se guarda tal cual", async () => {
      for (const hex of ["#ffffff", "#000000", "#ffff99"]) {
        expect((await guardar({ color_marca: hex })).ok, hex).toBe(true);
        expect(await guardado()).toMatchObject({ color_marca: hex });
      }
    });

    it("sin pedido de color (todo vacío) en una sucursal sin tema no crea nada", async () => {
      expect((await guardar({ color_marca: "", restaurante_nombre: "" })).ok).toBe(true);
      expect(await prisma.temaCartaSucursal.count()).toBe(0);
    });

    it("vaciar un campo lo saca (vacío = default de la carta); sacar el color saca también el marcador", async () => {
      await guardar({ color_marca: "#1f4e79", restaurante_nombre: "A" });
      await guardar({ color_marca: "#1f4e79", restaurante_nombre: "" });
      expect(await guardado()).toEqual({ color_marca: "#1f4e79", marca_derivada: "oscura" });
      await guardar({ color_marca: "" });
      expect(await guardado()).toEqual({});
    });
  });

  describe("mezcla: lo cargado manda", () => {
    it("con 58+ claves ya cargadas, guardar un color nuevo cambia solo las claves de la pantalla simple: lo demás queda idéntico y `aplicarEnCarta` también", async () => {
      const previo = { ...TODO_LO_AJENO_CARGADO, clave_vieja: "que el catálogo ya no conoce", color_item_precio: "no es un color;", color_marca: "#17562f", restaurante_nombre: "Viejo", marca_derivada: "si" };
      expect(Object.keys(previo).length).toBeGreaterThanOrEqual(40);
      await prisma.temaCartaSucursal.create({ data: { sucursalId: centralId, valores: previo, aplicarEnCarta: false } });

      const r = await guardar({ color_marca: "#7a1f2b", restaurante_nombre: "Nuevo" });
      expect(r.ok).toBe(true);
      const despues = (await fila())!;
      expect(despues.aplicarEnCarta, "`aplicarEnCarta` no cambia").toBe(false);
      const valores = despues.valores as Record<string, unknown>;
      expect(valores.color_marca).toBe("#7a1f2b");
      expect(valores.restaurante_nombre).toBe("Nuevo");
      expect(valores.marca_derivada).toBe("oscura");
      for (const [clave, valor] of Object.entries(previo)) {
        if (["color_marca", "restaurante_nombre", "marca_derivada"].includes(clave)) continue;
        expect(valores[clave], clave).toBe(valor);
      }
      expect(Object.keys(valores).sort()).toEqual(Object.keys(previo).sort());
    });

    it("algunas cargadas: pasan intactas", async () => {
      await prisma.temaCartaSucursal.create({ data: { sucursalId: centralId, valores: ALGO_AJENO_CARGADO, aplicarEnCarta: true } });
      await guardar({ color_marca: "#17562f" });
      expect(await guardado()).toEqual({ ...ALGO_AJENO_CARGADO, color_marca: "#17562f", marca_derivada: "oscura" });
    });

    it("una clave ajena a la pantalla simple que llegue en el pedido NO se escribe", async () => {
      await prisma.temaCartaSucursal.create({ data: { sucursalId: centralId, valores: { hero_ink: "claro" }, aplicarEnCarta: true } });
      const r = await guardar({ color_marca: "#17562f", hero_ink: "oscuro", color_fondo_dia: "#ffffff", marca_derivada: "si", carta_fuente_familia: "lora", precio_simbolo: "US$" });
      expect(r.ok).toBe(true);
      expect(await guardado()).toEqual({ hero_ink: "claro", color_marca: "#17562f", marca_derivada: "oscura" });
    });
  });

  describe("idempotencia", () => {
    it("guardar dos veces lo mismo (la segunda con la versión vieja, como un doble clic): éxito, una sola fila y no se versiona", async () => {
      const pedido = { color_marca: "#1f4e79", restaurante_nombre: "A" };
      expect((await guardar(pedido)).ok).toBe(true);
      const unaVez = (await fila())!;
      const dos = await guardarTemaSimpleCarta(centralId, pedido, "sin-tema");
      expect(dos).toEqual({ ok: true, mensaje: 'El tema de "Central" ya estaba así: no cambió nada.' });
      expect(await prisma.temaCartaSucursal.count()).toBe(1);
      const dosVeces = (await fila())!;
      expect(dosVeces.actualizadoEn.toISOString()).toBe(unaVez.actualizadoEn.toISOString());
      expect(dosVeces.valores).toEqual(unaVez.valores);
    });

    it("sobre un tema ya cargado con el mismo orden de claves distinto, tampoco escribe", async () => {
      await prisma.temaCartaSucursal.create({ data: { sucursalId: centralId, valores: { marca_derivada: "oscura", color_marca: "#1f4e79", hero_ink: "claro" }, aplicarEnCarta: true } });
      const antes = (await fila())!;
      expect((await guardar({ color_marca: "#1f4e79" })).ok).toBe(true);
      expect((await fila())!.actualizadoEn.toISOString()).toBe(antes.actualizadoEn.toISOString());
    });
  });

  describe("concurrencia y versión", () => {
    it("dos guardados a la vez con la misma versión: gana uno entero, el otro recibe «otra persona cambió esto» y no escribe nada", async () => {
      await guardar({ color_marca: "#1f4e79", restaurante_nombre: "Base" });
      const version = await versionVigente();
      const r = await Promise.allSettled([guardarTemaSimpleCarta(centralId, { color_marca: "#17562f", restaurante_nombre: "Base" }, version), guardarTemaSimpleCarta(centralId, { color_marca: "#7a1f2b", restaurante_nombre: "Base" }, version)]);
      const resultados = r.map((x) => (x.status === "fulfilled" ? x.value : { ok: false as const, mensaje: String(x.reason) }));
      expect(resultados.filter((x) => x.ok)).toHaveLength(1);
      const perdedor = resultados.find((x) => !x.ok)!;
      expect(perdedor.mensaje).toMatch(/Otra persona cambió esto mientras lo editabas/);
      expect(perdedor.mensaje).toMatch(/Recargá la pantalla/);
      expect(await prisma.temaCartaSucursal.count()).toBe(1);
      expect(["#17562f", "#7a1f2b"]).toContain(((await guardado()) as { color_marca: string }).color_marca);
      expect((await guardado()) as object).toMatchObject({ restaurante_nombre: "Base", marca_derivada: "oscura" });
    });

    it("dos primeros guardados a la vez (sin tema todavía): una sola fila y gana uno", async () => {
      const r = await Promise.allSettled([guardarTemaSimpleCarta(centralId, { color_marca: "#17562f" }, "sin-tema"), guardarTemaSimpleCarta(centralId, { color_marca: "#7a1f2b" }, "sin-tema")]);
      const resultados = r.map((x) => (x.status === "fulfilled" ? x.value : { ok: false as const, mensaje: String(x.reason) }));
      expect(resultados.filter((x) => x.ok)).toHaveLength(1);
      expect(await prisma.temaCartaSucursal.count()).toBe(1);
    });

    it("el mismo pedido dos veces a la vez: una fila y los dos responden bien (el segundo es «ya estaba así»)", async () => {
      const r = await Promise.all([guardarTemaSimpleCarta(centralId, { color_marca: "#17562f" }, "sin-tema"), guardarTemaSimpleCarta(centralId, { color_marca: "#17562f" }, "sin-tema")]);
      expect(r.map((x) => x.ok)).toEqual([true, true]);
      expect(await prisma.temaCartaSucursal.count()).toBe(1);
    });

    it("con una versión vieja (otra persona guardó antes) no se escribe nada", async () => {
      await guardar({ color_marca: "#1f4e79" });
      const vieja = await versionVigente();
      await new Promise((r) => setTimeout(r, 15));
      await guardar({ color_marca: "#17562f" });
      const antes = await fila();
      const r = await guardarTemaSimpleCarta(centralId, { color_marca: "#7a1f2b" }, vieja);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/Otra persona cambió esto/);
      expect(await fila()).toEqual(antes);
    });

    it("«sin-tema» con un tema que ya existe también es una versión vieja", async () => {
      await guardar({ color_marca: "#1f4e79" });
      const r = await guardarTemaSimpleCarta(centralId, { color_marca: "#7a1f2b" }, "sin-tema");
      expect(r.ok).toBe(false);
      expect(await guardado()).toMatchObject({ color_marca: "#1f4e79" });
    });
  });

  describe("permisos", () => {
    it("el operador (arranca sin `carta_tema`) no puede: rechazo de permiso, sin escribir", async () => {
      await guardar({ color_marca: "#1f4e79" });
      const antes = await fila();
      const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: centralId, rolId: operadorRolId });
      await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
      const r = await guardar({ color_marca: "#7a1f2b" });
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
      expect(await fila()).toEqual(antes);
    });

    it("el administrador puede", async () => {
      expect((await guardar({ color_marca: "#1f4e79" })).ok).toBe(true);
    });

    it("el gerente de la empresa (el primer administrador, con rolEmpresa «gerente») puede", async () => {
      const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: centralId, rolId: adminRolId });
      await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: gerente.id, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });
      await mockearUsuarioActual({ id: gerente.id, email: gerente.email, nombre: null });
      expect((await guardar({ color_marca: "#1f4e79" })).ok).toBe(true);
    });
  });

  describe("aislamiento", () => {
    it("guardar para otra sucursal que la activa responde «No se encontró la sucursal.» y no toca la fila de esa sucursal", async () => {
      const otraId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
      await prisma.temaCartaSucursal.create({ data: { sucursalId: otraId, valores: { color_marca: "#ffffff" }, aplicarEnCarta: true } });
      const antes = await fila(otraId);
      expect(await guardarTemaSimpleCarta(otraId, { color_marca: "#17562f" }, "sin-tema")).toEqual({ ok: false, mensaje: "No se encontró la sucursal." });
      expect(await fila(otraId)).toEqual(antes);
      expect(await fila()).toBeNull();
    });

    it("guardar en la activa no toca el tema de otra sucursal de la misma empresa", async () => {
      const otraId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
      await prisma.temaCartaSucursal.create({ data: { sucursalId: otraId, valores: { color_marca: "#ffffff", hero_ink: "claro" }, aplicarEnCarta: true } });
      const antes = await fila(otraId);
      expect((await guardar({ color_marca: "#17562f" })).ok).toBe(true);
      expect(await fila(otraId)).toEqual(antes);
    });

    it("el caso de uso con la sucursal de OTRA empresa responde «no encontrada» (la RLS no la deja ver) y no toca su tema", async () => {
      await prismaAdmin.empresa.upsert({ where: { id: EMPRESA_TESTIGO_ID }, update: { estado: "ACTIVE" }, create: DATOS_EMPRESA_TESTIGO });
      const ajena = await prismaAdmin.sucursal.create({ data: { empresaId: EMPRESA_TESTIGO_ID, nombre: "Ajena" } });
      await prismaAdmin.temaCartaSucursal.create({ data: { empresaId: EMPRESA_TESTIGO_ID, sucursalId: ajena.id, valores: { color_marca: "#ffffff" }, aplicarEnCarta: true } });
      try {
        const r = await guardarTemaSimpleCartaCasoDeUso(actorDePrueba(adminId, centralId), { sucursalId: ajena.id, valores: { color_marca: "#17562f" }, versionEsperada: "sin-tema" });
        expect(r).toMatchObject({ ok: false, codigo: "SUCURSAL_NO_ENCONTRADA" });
        expect((await prismaAdmin.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId: ajena.id } })).valores).toEqual({ color_marca: "#ffffff" });
      } finally {
        await prismaAdmin.temaCartaSucursal.deleteMany({ where: { empresaId: EMPRESA_TESTIGO_ID } });
        await prismaAdmin.sucursal.deleteMany({ where: { empresaId: EMPRESA_TESTIGO_ID } });
      }
    });
  });

  describe("validadores: lo inválido se rechaza sin escribir", () => {
    it.each([
      ["color_marca", "red"],
      ["color_marca", "#fff"],
      ["color_marca", "rgb(1, 2, 3)"],
      ["restaurante_instagram", "javascript:alert(1)"],
      ["restaurante_facebook", "https://evil.com/x"],
      ["restaurante_whatsapp", "abc"],
      ["restaurante_footer_maps_url", "javascript:alert(1)"],
      ["restaurante_logo_url", "http://x.com/logo.png"],
      ["restaurante_nombre", "x".repeat(121)],
    ])("%s = %j", async (clave, valor) => {
      await guardar({ color_marca: "#1f4e79" });
      const antes = await fila();
      const r = await guardar({ color_marca: "#1f4e79", [clave]: valor });
      expect(r.ok).toBe(false);
      expect(await fila()).toEqual(antes);
    });

    it.each([undefined, "", "ayer", "2026-11-17"])("una versión que no es de la forma permitida (%j) se rechaza antes de leer nada", async (version) => {
      const r = await guardarTemaSimpleCarta(centralId, { color_marca: "#1f4e79" }, version as never);
      expect(r.ok).toBe(false);
      expect(await prisma.temaCartaSucursal.count()).toBe(0);
    });
  });
});
