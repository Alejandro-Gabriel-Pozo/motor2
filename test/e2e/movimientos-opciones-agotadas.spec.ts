import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { abrirComoRol } from "./fixtures/rol-pos";
import { usuarioConDosSucursales } from "./fixtures/dos-sucursales";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * GO-2d, lo de cada SUCURSAL sobre las opciones de venta: «Opciones agotadas» (`opcion_apagar_en_sucursal`, delegable al encargado) y «Precios por tamaño en esta sucursal»
 * (`precio_local`). Lo que se agota en «Central» sigue disponible en otra sucursal; el aviso de los productos que se quedan sin poder venderse; «Deshacer»; el stock teórico AVISA y
 * nunca bloquea. Lo sembrado de opciones no se borra (ver `fixtures/opciones.ts`).
 */

const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function milanesaConGuarnicion(m: string, sucursalId: string) {
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const papasMp = await prisma.producto.create({ data: { codigo: `E2E-MP-PAPA-${m}`, nombre: `E2E Papas ${m}`, tipo: "MP", unidadStockId: unidad.id } });
  const guarnicion = await sembrarGrupo({
    nombre: `E2E Guarnición ${m}`,
    tipo: "INCLUIDA",
    cantidadMinima: 1,
    cantidadMaxima: 1,
    marca: m,
    opciones: [{ nombre: `Papas fritas ${m}`, consumos: [{ insumoProductoId: papasMp.id, cantidad: 0.2 }] }],
  });
  const { productoId } = await sembrarProductoConOpciones({ nombre: `E2E Milanesa ${m}`, codigo: `E2E-MILA-${m}`, precioVenta: 9000, sucursalId, grupos: [{ grupo: guarnicion }] });
  return { papasMp, guarnicion, productoId, opcionId: guarnicion.opciones[`Papas fritas ${m}`]!.opcionId };
}

test("agotar en «Central»: el aviso del producto que no se puede vender, «Deshacer», y en la otra sucursal sigue disponible", async ({ browser, baseURL, sucursalId }) => {
  const m = marca();
  const { opcionId, papasMp } = await milanesaConGuarnicion(m, sucursalId);
  const { page, segunda, limpiar } = await usuarioConDosSucursales(browser, baseURL, sucursalId, "admin", "admin");
  try {
    await page.goto("/movimientos/opciones-agotadas");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Opciones agotadas en «Central»");
    const fila = page.locator(`[data-opcion-sucursal='Papas fritas ${m}']`);
    // El sistema no registra papas (0): AVISA, con el conteo físico a mano, y la opción sigue disponible.
    await expect(fila.locator(`[data-aviso-stock='${papasMp.nombre}']`)).toContainText("el sistema dice 0 kg. Si hay en el depósito, hacé un conteo físico");
    await expect(fila.getByRole("link", { name: "hacé un conteo físico" })).toHaveAttribute("href", "/movimientos/conteo-fisico");
    const pildora = fila.getByRole("button", { name: `Papas fritas ${m}: Disponible` });
    await expect(pildora).toHaveAttribute("aria-pressed", "true");
    expect((await new AxeBuilder({ page }).analyze()).violations, "con el aviso de stock").toEqual([]);

    await pildora.click();
    await expect(fila.getByRole("button", { name: `Papas fritas ${m}: Agotada` })).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("[data-sin-vender]")).toContainText(`«E2E Milanesa ${m}»: no queda ninguna opción de «E2E Guarnición ${m}»`);
    await expect(page.locator("[data-agotadas-ahora]")).toContainText("Agotadas ahora: 1");
    expect(await prisma.opcionApagadaEnSucursal.findMany({ where: { opcionId }, select: { sucursalId: true, apagada: true } })).toEqual([{ sucursalId, apagada: true }]);
    expect((await new AxeBuilder({ page }).analyze()).violations, "agotada, con el aviso y «Deshacer»").toEqual([]);

    // En la otra sucursal, la misma opción sigue disponible.
    await page.getByLabel("Sucursal activa").selectOption(segunda.id);
    await page.waitForURL((url) => url.pathname === "/movimientos/opciones-agotadas");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(segunda.nombre);
    await expect(page.locator(`[data-opcion-sucursal='Papas fritas ${m}']`).getByRole("button", { name: `Papas fritas ${m}: Disponible` })).toBeVisible();

    // De vuelta en «Central», «Deshacer» la vuelve a prender.
    await page.getByLabel("Sucursal activa").selectOption(sucursalId);
    await page.waitForURL((url) => url.pathname === "/movimientos/opciones-agotadas");
    await page.locator(`[data-opcion-sucursal='Papas fritas ${m}']`).getByRole("button", { name: `Papas fritas ${m}: Agotada` }).click();
    await page.getByRole("button", { name: "Deshacer" }).click();
    await expect(page.locator(`[data-opcion-sucursal='Papas fritas ${m}']`).getByRole("button", { name: `Papas fritas ${m}: Agotada` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Deshacer" })).toHaveCount(0);
  } finally {
    // El usuario no se puede borrar: quedó como autor de la fila de la opción agotada (y esa tabla no tiene DELETE). La base E2E se vacía al empezar cada corrida.
    await limpiar().catch(() => undefined);
  }
});

test("el encargado con la clave delegada puede agotar; con solo «Ver» la píldora no se toca; sin la clave no hay menú ni pantalla", async ({ browser, baseURL, sucursalId }) => {
  const m = marca();
  const { opcionId } = await milanesaConGuarnicion(m, sucursalId);
  const encargado = await abrirComoRol(browser, baseURL, sucursalId, { opcion_apagar_en_sucursal: "editar" });
  const soloVe = await abrirComoRol(browser, baseURL, sucursalId, { opcion_apagar_en_sucursal: "ver" });
  const sinClave = await abrirComoRol(browser, baseURL, sucursalId, { pos_mesas: "ver" });
  try {
    await encargado.page.goto("/movimientos/opciones-agotadas");
    await encargado.page.locator(`[data-opcion-sucursal='Papas fritas ${m}']`).getByRole("button", { name: `Papas fritas ${m}: Disponible` }).click();
    await expect(encargado.page.getByRole("status").filter({ hasText: "quedó agotada" })).toBeVisible();
    expect((await prisma.opcionApagadaEnSucursal.findFirstOrThrow({ where: { opcionId, sucursalId } })).actualizadoPorId).toBe(encargado.usuario.id);

    await soloVe.page.goto("/movimientos/opciones-agotadas");
    await expect(soloVe.page.locator(`[data-opcion-sucursal='Papas fritas ${m}']`).getByRole("button", { name: `Papas fritas ${m}: Agotada` })).toBeDisabled();

    await sinClave.page.goto("/movimientos/opciones-agotadas");
    await expect(sinClave.page.getByText(/No tenés permiso/).first()).toBeVisible();
    await expect(sinClave.page.getByRole("link", { name: "Opciones agotadas" })).toHaveCount(0);
  } finally {
    await encargado.limpiar().catch(() => undefined); // quedó como autor de la fila agotada (ver arriba)
    await soloVe.limpiar();
    await sinClave.limpiar();
  }
});

test("precios por tamaño en esta sucursal: se carga uno propio y se vuelve al de la empresa", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const tamano = await sembrarGrupo({ nombre: `E2E Tamaño local ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Chico", factorEscala: 1 }, { nombre: "Grande", factorEscala: 1.5 }] });
  const { productoId } = await sembrarProductoConOpciones({
    nombre: `E2E Café local ${m}`,
    codigo: `E2E-CL-${m}`,
    precioVenta: 2500,
    sucursalId,
    grupos: [{ grupo: tamano, modoPrecio: "ABSOLUTO", preciosAbsolutos: { Chico: 2500, Grande: 3100 } }],
  });
  const grandeId = tamano.opciones["Grande"]!.opcionId;
  await page.goto("/movimientos/precio-local");
  const fila = page.locator(`[data-tamano='E2E Café local ${m} · Grande']`);
  await expect(fila).toContainText("$ 3.100");
  await fila.getByLabel(`Precio de E2E Café local ${m} · Grande en esta sucursal`).fill("3000");
  await fila.getByRole("button", { name: "Guardar" }).click();
  await expect(fila.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();
  expect(await prisma.precioLocalDeOpcion.findFirstOrThrow({ where: { sucursalId, productoId, opcionId: grandeId }, select: { precio: true, habilitado: true } })).toMatchObject({ habilitado: true });
  expect(Number((await prisma.precioLocalDeOpcion.findFirstOrThrow({ where: { sucursalId, productoId, opcionId: grandeId } })).precio)).toBe(3000);
  expect((await new AxeBuilder({ page }).analyze()).violations, "precio local con la grilla de tamaños").toEqual([]);

  await fila.getByRole("button", { name: "Volver al de la empresa" }).click();
  await expect(fila.getByRole("status").filter({ hasText: "vuelve a regir el precio de la empresa" })).toBeVisible();
  expect((await prisma.precioLocalDeOpcion.findFirstOrThrow({ where: { sucursalId, productoId, opcionId: grandeId } })).habilitado).toBe(false);
});

test("carta (mantenimiento): un plato que se muestra con un ingrediente en 0 en el sistema AVISA con el conteo físico a mano y sigue en la carta", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const carne = await prisma.producto.create({ data: { codigo: `E2E-MP-CARNE-${m}`, nombre: `E2E Carne ${m}`, tipo: "MP", unidadStockId: kg.id } });
  const plato = await prisma.producto.create({ data: { codigo: `E2E-PV-BIFE-${m}`, nombre: `E2E Bife ${m}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 12000 } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: plato.id, disponible: true } });
  await prisma.recetaVersion.create({ data: { productoId: plato.id, version: 1, ingredientes: { create: [{ insumoProductoId: carne.id, cantidad: 0.3, unidadId: kg.id }] } } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Sección stock ${m}` } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: plato.id, visibleEnCarta: true, seccionCartaId: seccion.id } });
  try {
    await page.goto("/carta");
    const avisos = page.locator("[data-avisos-de-stock]");
    await expect(avisos).toContainText(`«E2E Bife ${m}»: E2E Carne ${m}: el sistema dice 0 kg. Si hay en el depósito, hacé un conteo físico.`);
    await expect(avisos.getByRole("link", { name: "hacé un conteo físico" }).first()).toHaveAttribute("href", "/movimientos/conteo-fisico");
    // Avisa, no bloquea: el plato sigue «se muestra».
    await expect(page.locator(`[data-contenido-carta='E2E Bife ${m}']`)).toContainText("se muestra");
    expect((await new AxeBuilder({ page }).include("[data-avisos-de-stock]").analyze()).violations, "el aviso de stock").toEqual([]);
  } finally {
    await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: plato.id } });
    await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    await prisma.recetaIngrediente.deleteMany({ where: { insumoProductoId: carne.id } });
    await prisma.recetaVersion.deleteMany({ where: { productoId: plato.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: plato.id } });
    await prisma.producto.deleteMany({ where: { id: { in: [plato.id, carne.id] } } });
  }
});
