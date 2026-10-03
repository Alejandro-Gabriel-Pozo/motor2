import { randomUUID } from "node:crypto";
import type { Browser } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { crearMembresia } from "../setup/membresia";
import { ajustarCeldasDelAdmin } from "./fixtures/admin-con-filas";

/**
 * Ver ≠ editar en las pantallas de la carta (/carta y /carta/agrupados): con «Ver» pero sin «Editar» de las claves de la carta (carta_secciones, carta_generos, carta_contenido_producto, carta_promo_definir / carta_promo_activar / carta_promo_precio_local, carta_items_agrupados) se
 * ven los mismos datos como texto, sin un solo campo ni botón (docs/grounding-lista-ver-editar-2026-09-18.md §7.4: catálogo chico,
 * queda inline; la separación se resuelve con el nivel de permiso). Con la semilla de fábrica no hay un rol que vea la carta y no la
 * edite, así que cada caso fabrica el suyo (usuario y sesión propios), mismo patrón que catalogo-productos-permiso-editar.spec.ts. las claves de la carta son
 * acciones de piso administrador: solo la alcanza el rol «admin», así que el caso se arma sobre ese rol con la celda de la carta como pide el caso
 * (ajustarCeldasDelAdmin la deja como estaba al limpiar).
 */
async function abrirComoRol(browser: Browser, baseURL: string | undefined, sucursalId: string, puedeEditar: boolean) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const celda = { puedeVer: true, puedeEditar };
  const admin = await ajustarCeldasDelAdmin({
    carta_ver: celda,
    carta_secciones: celda,
    carta_generos: celda,
    carta_contenido_producto: celda,
    carta_producto_descuento: celda,
    carta_promo_definir: celda,
    carta_promo_activar: celda,
    carta_promo_precio_local: celda,
    carta_items_agrupados: celda,
  });
  const rol = { id: admin.rolId };
  const usuario = await prisma.user.create({ data: { email: `e2e-carta-${marca}@local.test`, activoGlobal: true } });
  await crearMembresia({ usuarioId: usuario.id, sucursalId, rolId: rol.id, activo: true });
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });
  const contexto = await browser.newContext();
  await contexto.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await contexto.newPage();
  return {
    page,
    limpiar: async () => {
      await contexto.close();
      await prisma.session.deleteMany({ where: { userId: usuario.id } });
      await prisma.usuarioSucursal.deleteMany({ where: { usuarioId: usuario.id } });
      await prisma.usuarioEmpresa.deleteMany({ where: { usuarioId: usuario.id } });
      await prisma.user.deleteMany({ where: { id: usuario.id } });
      await admin.restaurar();
    },
  };
}

/** Una sección con un PV suelto (con contenido), una promo de la sucursal y un ítem agrupado con una opción. */
async function crearCarta(sucursalId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Solo ver Sección ${marca}`, titulo: "Del horno", descripcion: `Descripción de sección ${marca}`, orden: 3 } });
  const crearPV = (q: string) =>
    prisma.producto.create({ data: { codigo: `E2E_CARTA_SV_${q}_${marca}`, nombre: `E2E Solo ver ${q} ${marca}`, tipo: "PV", precioVenta: 4200, unidadStockId: unidad.id } });
  const [suelto, agrupado] = await Promise.all([crearPV("Plato"), crearPV("Gaseosa")]);
  await prisma.disponibilidadProducto.createMany({ data: [suelto, agrupado].map((p) => ({ sucursalId, productoId: p.id, disponible: true })) });
  await prisma.contenidoCartaProducto.create({
    data: { sucursalId, productoId: suelto.id, visibleEnCarta: true, seccionCartaId: seccion.id, descripcion: `Contenido del plato ${marca}`, tags: ["Sin TACC"], especial: true, orden: 2 },
  });
  const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: seccion.id, titulo: `E2E Solo ver Promo ${marca}`, descripcion: `Descripción de promo ${marca}`, precio: 9900 } });
  const item = await prisma.itemAgrupadoCarta.create({
    data: { sucursalId, nombre: `E2E Solo ver Ítem ${marca}`, seccionCartaId: seccion.id, descripcion: `Descripción del ítem ${marca}`, tags: ["Bien fría"], orden: 4 },
  });
  await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId, itemAgrupadoCartaId: item.id, productoId: agrupado.id } });
  return {
    marca,
    seccion,
    suelto,
    agrupado,
    promo,
    item,
    limpiar: async () => {
      await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { itemAgrupadoCartaId: item.id } });
      await prisma.itemAgrupadoCarta.deleteMany({ where: { id: item.id } });
      await prisma.promoCartaSucursal.deleteMany({ where: { promoCarta: { id: promo.id } } });
      await prisma.promoCarta.deleteMany({ where: { id: promo.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: [suelto.id, agrupado.id] } } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [suelto.id, agrupado.id] } } });
      await prisma.producto.deleteMany({ where: { id: { in: [suelto.id, agrupado.id] } } });
    },
  };
}

/** Ningún control de edición dentro del contenido de la pantalla (el menú lateral no cuenta). */
const BOTONES_DE_EDICION = /Guardar|Crear|Agregar|Quitar|Apagar|Prender/;

test("un rol que solo VE la carta ve secciones, contenido y promos en /carta como texto, sin campos ni botones", async ({ browser, baseURL, sucursalId }) => {
  const carta = await crearCarta(sucursalId);
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, false);
  try {
    await page.goto("/carta");
    const main = page.locator("main");
    await expect(page.getByRole("heading", { name: "Carta pública", level: 1 })).toBeVisible(); // la pantalla, no un mensaje de permiso
    await expect(main.locator("[data-aviso-solo-lectura]")).toHaveText("Solo lectura: tu rol no tiene permiso para editar la carta.");

    // Los datos están, como texto.
    const seccion = main.locator(`[data-seccion-carta="${carta.seccion.nombre}"]`);
    await seccion.locator("summary").click();
    await expect(seccion.locator("[data-solo-lectura]")).toContainText(`Descripción de sección ${carta.marca}`);
    await expect(seccion.locator("[data-solo-lectura]")).toContainText("Del horno");

    const contenido = main.locator(`[data-contenido-carta="${carta.suelto.nombre}"]`);
    await contenido.locator("summary").click();
    const datosContenido = contenido.locator("[data-solo-lectura]").first();
    await expect(datosContenido).toContainText(`Contenido del plato ${carta.marca}`);
    await expect(datosContenido).toContainText("Sin TACC");
    await expect(contenido.locator("[data-solo-lectura]").filter({ hasText: "Descuento en esta sucursal" })).toContainText("Sin descuento");
    await expect(datosContenido).toContainText(carta.seccion.nombre);

    const promo = main.locator(`[data-promo-carta="${carta.promo.titulo}"]`);
    await promo.locator("summary").click();
    await expect(promo.locator("[data-solo-lectura]").filter({ hasText: `Descripción de promo ${carta.marca}` })).toBeVisible();

    // …y no hay nada para editar: ni campos ni botones, ni las altas.
    await expect(main.locator("input, textarea, select"), "no tenía que haber ningún campo editable").toHaveCount(0);
    await expect(main.getByRole("button", { name: BOTONES_DE_EDICION }), "no tenía que haber botones de edición").toHaveCount(0);
    await expect(main.getByRole("heading", { name: "Nueva sección de carta" })).toHaveCount(0);
    await expect(main.getByRole("heading", { name: "Nueva promo" })).toHaveCount(0);
    // El resumen de solo lectura también pasa axe (con los <details> abiertos).
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await limpiar();
    await carta.limpiar();
  }
});

test("un rol que solo VE la carta ve los ítems agrupados y sus opciones en /carta/agrupados como texto, sin campos ni botones", async ({ browser, baseURL, sucursalId }) => {
  const carta = await crearCarta(sucursalId);
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, false);
  try {
    await page.goto("/carta/agrupados");
    const main = page.locator("main");
    await expect(page.getByRole("heading", { name: "Ítems agrupados de la carta", level: 1 })).toBeVisible();
    await expect(main.locator("[data-aviso-solo-lectura]")).toBeVisible();

    const item = main.locator(`[data-item-agrupado="${carta.item.nombre}"]`);
    await item.locator("summary").click();
    const datos = item.locator("[data-solo-lectura]");
    await expect(datos).toContainText(`Descripción del ítem ${carta.marca}`);
    await expect(datos).toContainText("Bien fría");
    await expect(datos).toContainText(carta.seccion.nombre);
    await expect(item.locator(`[data-opcion-agrupada="${carta.agrupado.nombre}"]`)).toContainText("$4.200 acá");

    await expect(main.locator("input, textarea, select"), "no tenía que haber ningún campo editable").toHaveCount(0);
    await expect(main.getByRole("button", { name: BOTONES_DE_EDICION }), "no tenía que haber botones de edición").toHaveCount(0);
    await expect(main.getByRole("heading", { name: "Nuevo ítem agrupado" })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await limpiar();
    await carta.limpiar();
  }
});

test("un rol CON editar de la carta ve los formularios y las altas en las dos pantallas", async ({ browser, baseURL, sucursalId }) => {
  // Contraespejo: impide «arreglarlo» escondiendo los formularios para todos.
  const carta = await crearCarta(sucursalId);
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, true);
  try {
    await page.goto("/carta");
    const main = page.locator("main");
    await expect(main.locator("[data-aviso-solo-lectura]")).toHaveCount(0);
    await expect(main.getByRole("heading", { name: "Nueva sección de carta" })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Nueva promo" })).toBeVisible();
    const seccion = main.locator(`[data-seccion-carta="${carta.seccion.nombre}"]`);
    await seccion.locator("summary").click();
    await expect(seccion.getByRole("button", { name: "Guardar sección" })).toBeVisible();
    await expect(seccion.getByRole("button", { name: `Apagar «${carta.seccion.nombre}»` })).toBeVisible();
    await expect(main.locator("[data-solo-lectura]")).toHaveCount(0);

    await page.goto("/carta/agrupados");
    await expect(main.getByRole("heading", { name: "Nuevo ítem agrupado" })).toBeVisible();
    const item = main.locator(`[data-item-agrupado="${carta.item.nombre}"]`);
    await item.locator("summary").click();
    await expect(item.getByRole("button", { name: `Quitar «${carta.agrupado.nombre}»` })).toBeVisible();
    await expect(item.getByRole("button", { name: `Apagar «${carta.item.nombre}»` })).toBeVisible();
    await expect(main.locator("[data-solo-lectura]")).toHaveCount(0);
  } finally {
    await limpiar();
    await carta.limpiar();
  }
});
