import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";
import { formatearFechaHora } from "../../src/core/tiempo/zona-horaria";

/**
 * GO-2d, pantalla de UN grupo de opciones (`/catalogo/opciones/[grupoId]`, clave `opciones_definir`): editar el grupo con su versión (dos pestañas: la vieja se rechaza y ofrece
 * «Recargar»), el alta de una opción con su precio y el espejo de referencia, la opción «ninguna», el orden con «mover tocando» (atómico) y apagar una opción. Lo sembrado de
 * opciones no se borra (esas tablas solo se agregan; ver `fixtures/opciones.ts`).
 */

const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

test("dos pestañas: la que tiene el grupo viejo no pisa el cambio de la otra, se avisa y ofrece «Recargar»", async ({ paginaAutenticada: pestañaA }) => {
  const m = marca();
  const g = await sembrarGrupo({ nombre: `E2E Leche ${m}`, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "De vaca" }] });
  const pestañaB = await pestañaA.context().newPage();
  await pestañaA.goto(`/catalogo/opciones/${g.grupoId}`);
  await pestañaB.goto(`/catalogo/opciones/${g.grupoId}`);

  await pestañaA.getByLabel("Nombre", { exact: true }).fill(`E2E Leche A ${m}`);
  await pestañaA.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(pestañaA.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();

  await pestañaB.getByLabel("Máximo a elegir").fill("2");
  await pestañaB.getByRole("button", { name: "Guardar", exact: true }).click();
  const aviso = pestañaB.getByRole("alert").filter({ hasText: "cambió mientras lo editabas" });
  await expect(aviso).toBeVisible();
  await expect(aviso).not.toContainText(/versi[oó]n/);
  expect(await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: g.grupoId }, select: { nombre: true, cantidadMaxima: true, version: true } })).toEqual({ nombre: `E2E Leche A ${m}`, cantidadMaxima: 1, version: 2 });
  expect((await new AxeBuilder({ page: pestañaB }).analyze()).violations, "con el conflicto a la vista").toEqual([]);

  // «Recargar» trae lo último; el cambio ahora sí entra.
  await aviso.getByRole("button", { name: "Recargar" }).click();
  await expect(pestañaB.getByLabel("Nombre", { exact: true })).toHaveValue(`E2E Leche A ${m}`);
  await pestañaB.getByLabel("Máximo a elegir").fill("2");
  await pestañaB.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(pestañaB.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();
  expect((await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: g.grupoId } })).cantidadMaxima).toBe(2);
});

test("alta de una opción con recargo: el espejo de referencia y una sola fila aunque se toque dos veces; la «ninguna» sin precio", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const g = await sembrarGrupo({ nombre: `E2E Preparación ${m}`, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Solo" }] });
  await sembrarProductoConOpciones({ nombre: `E2E Café Espejo ${m}`, codigo: `E2E-ESP-${m}`, precioVenta: 2500, sucursalId, grupos: [{ grupo: g }] });
  await page.goto(`/catalogo/opciones/${g.grupoId}`);
  await page.getByRole("button", { name: "+ Agregar opción" }).click();
  await page.getByLabel("Nombre de la opción").fill("Con leche");
  await page.getByLabel("Diferencia en pesos").fill("400");
  // El espejo: 400 sobre 2.500 es el 16 %, con el rótulo «referencia».
  await expect(page.locator("[data-espejo]")).toContainText("≈ 16 % del precio base de");
  await expect(page.locator("[data-espejo]")).toContainText("referencia");
  await page.getByRole("radio", { name: "Porcentaje" }).check();
  await page.getByLabel("Diferencia en porcentaje").fill("10");
  await expect(page.locator("[data-espejo]")).toContainText("≈ + $ 250");
  expect((await new AxeBuilder({ page }).analyze()).violations, "alta abierta").toEqual([]);
  await page.getByRole("radio", { name: "Monto en pesos" }).check();
  await page.getByLabel("Diferencia en pesos").fill("400");
  await page.getByRole("button", { name: "Agregar opción" }).dblclick();
  await expect(page.getByRole("status").filter({ hasText: /creada|ya existía/i }).first()).toBeVisible();
  await expect(page.locator("[data-opcion='Con leche']")).toContainText("+ $ 400");
  const filas = await prisma.opcionDeGrupo.findMany({ where: { grupoId: g.grupoId, nombre: "Con leche" }, select: { versiones: { select: { tipoDeDiferencia: true, diferenciaPrecio: true } } } });
  expect(filas.map((f) => f.versiones.map((v) => [v.tipoDeDiferencia, Number(v.diferenciaPrecio)]))).toEqual([[["MONTO", 400]]]);

  // La «ninguna»: sin campos de precio.
  // El alta queda abierta después de guardar (se vacía sola): se carga la siguiente.
  await page.getByLabel("Nombre de la opción").fill("Sin leche");
  await page.getByLabel(/Es la opción «ninguna»/).check();
  await expect(page.getByLabel("Diferencia en pesos")).toHaveCount(0);
  await page.getByRole("button", { name: "Agregar opción" }).click();
  await expect(page.locator("[data-opcion='Sin leche']")).toContainText("ninguna");
  // Ya hay una «ninguna»: no se ofrece otra.
  await expect(page.getByLabel(/Es la opción «ninguna»/)).toHaveCount(0);
});

test("ordenar con «mover tocando»: se guarda de una vez y la «ninguna» nunca va primera", async ({ paginaAutenticada: page }) => {
  const m = marca();
  const g = await sembrarGrupo({
    nombre: `E2E Guarnición ${m}`,
    tipo: "INCLUIDA",
    cantidadMinima: 1,
    cantidadMaxima: 1,
    marca: m,
    opciones: [{ nombre: "Papas fritas" }, { nombre: "Puré" }, { nombre: "Ensalada" }, { nombre: "Sin guarnición", esNinguna: true }],
  });
  await page.goto(`/catalogo/opciones/${g.grupoId}`);
  await page.getByRole("button", { name: "Ordenar opciones" }).click();
  const zona = page.getByRole("region", { name: "Ordenar las opciones" });
  await zona.getByRole("button", { name: /Ensalada/ }).click();
  await expect(zona.getByRole("button", { name: /Ensalada/ })).toHaveAttribute("aria-pressed", "true");
  await zona.getByRole("button", { name: "Poner acá" }).first().click();
  // La «ninguna» elegida no tiene el primer lugar.
  await zona.getByRole("button", { name: /Sin guarnición/ }).click();
  await expect(zona.locator("ol > li").first().getByRole("button", { name: /Ensalada/ }), "antes de la primera opción no hay lugar para la «ninguna»").toBeVisible();
  await expect(zona.getByRole("button", { name: /Poner acá|Poner al final/ })).toHaveCount(2);
  await zona.getByRole("button", { name: /Sin guarnición/ }).click(); // se suelta sin mover
  expect((await new AxeBuilder({ page }).analyze()).violations, "ordenando").toEqual([]);
  await zona.getByRole("button", { name: "Guardar orden" }).click();
  await expect(page.getByRole("status").filter({ hasText: "quedó con el orden nuevo" })).toBeVisible();
  const orden = await prisma.opcionDeGrupo.findMany({ where: { grupoId: g.grupoId }, orderBy: { orden: "asc" }, select: { nombre: true } });
  expect(orden.map((o) => o.nombre)).toEqual(["Ensalada", "Papas fritas", "Puré", "Sin guarnición"]);
  await expect(page.getByRole("list", { name: `Opciones de E2E Guarnición ${m}` }).locator("li").first()).toContainText("Ensalada");
});

test("apagar una opción pide confirmar y avisa; la lista dice «apagada»", async ({ paginaAutenticada: page }) => {
  const m = marca();
  const g = await sembrarGrupo({ nombre: `E2E Tamaño ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Chico", monto: -300, factorEscala: 0.75 }, { nombre: "Grande", monto: 500, factorEscala: 1.5 }] });
  await page.goto(`/catalogo/opciones/${g.grupoId}`);
  const chico = page.locator("[data-opcion='Chico']");
  await expect(chico).toContainText("− $ 300");
  await expect(chico).toContainText("consume ×0,75");
  await expect(chico).toContainText(/Rige desde \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} · cargó/);
  await chico.getByRole("button", { name: "Desactivar" }).click();
  await expect(chico.getByRole("alert")).toContainText("no se ofrece en ningún producto");
  await chico.getByRole("button", { name: "Sí, desactivar" }).click();
  await expect(chico).toContainText("apagada");
  expect((await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: g.opciones["Chico"]!.opcionId } })).activa).toBe(false);
  // Un tamaño se elige siempre una vez: los límites no se pueden tocar.
  await expect(page.getByLabel("Mínimo a elegir")).toHaveAttribute("readonly", "");
  await page.emulateMedia({ colorScheme: "dark" });
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations, "modo oscuro").toEqual([]);
});

test("cambiar precio o consumo: de monto a porcentaje con su espejo, REEMPLAZA sin ingrediente rechazado, la hora argentina del historial y el choque de dos pestañas", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "l" } });
  const leche = await prisma.producto.create({ data: { codigo: `E2E-MP-LECHE-${m}`, nombre: `E2E Leche entera ${m}`, tipo: "MP", unidadStockId: unidad.id } });
  const almendras = await prisma.producto.create({ data: { codigo: `E2E-MP-ALM-${m}`, nombre: `E2E Bebida de almendras ${m}`, tipo: "MP", unidadStockId: unidad.id } });
  const g = await sembrarGrupo({ nombre: `E2E Bebida ${m}`, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Almendras", monto: 300 }] });
  await sembrarProductoConOpciones({ nombre: `E2E Cortado ${m}`, codigo: `E2E-CORT-${m}`, precioVenta: 2000, sucursalId, grupos: [{ grupo: g }] });
  const opcionId = g.opciones["Almendras"]!.opcionId;

  const otra = await page.context().newPage();
  await page.goto(`/catalogo/opciones/${g.grupoId}`);
  await otra.goto(`/catalogo/opciones/${g.grupoId}`);
  const fila = page.locator("[data-opcion='Almendras']");
  await fila.getByRole("button", { name: "Cambiar precio o consumo de Almendras" }).click();
  // Arranca con lo que rige: 300 pesos.
  await expect(fila.getByLabel("Diferencia en pesos")).toHaveValue("300");
  await fila.getByRole("radio", { name: "Porcentaje" }).check();
  await fila.getByLabel("Diferencia en porcentaje").fill("15");
  await expect(fila.locator("[data-espejo]")).toContainText("≈ + $ 300 sobre el precio base");
  // Un REEMPLAZA sin el ingrediente que reemplaza: el servidor lo rechaza y no carga nada.
  await fila.getByRole("button", { name: "+ Agregar línea de consumo" }).click();
  await fila.getByLabel("Línea 1", { exact: true }).selectOption("REEMPLAZA");
  await fila.getByLabel("Por", { exact: true }).selectOption({ label: almendras.nombre });
  await fila.getByLabel(/^Cantidad/).fill("0,2");
  await expect(fila.getByLabel(/^Cantidad/)).toBeVisible();
  await expect(fila.getByText("Cantidad (l)")).toBeVisible();
  await fila.getByRole("button", { name: "Guardar el cambio" }).click();
  await expect(fila.getByRole("alert").filter({ hasText: "falta cuál" })).toBeVisible();
  expect(await prisma.versionDeOpcion.count({ where: { opcionId } })).toBe(1);
  expect((await new AxeBuilder({ page }).analyze()).violations, "cambio de precio abierto con un error").toEqual([]);

  await fila.getByLabel("Ingrediente que reemplaza").selectOption({ label: leche.nombre });
  await fila.getByRole("button", { name: "Guardar el cambio" }).click();
  await expect(page.getByRole("status").filter({ hasText: "rige desde ahora" })).toBeVisible();
  const versiones = await prisma.versionDeOpcion.findMany({ where: { opcionId }, orderBy: { numero: "desc" }, select: { numero: true, tipoDeDiferencia: true, porcentaje: true, creadoEn: true, consumos: { select: { efecto: true, insumoProductoId: true, reemplazaAProductoId: true, cantidad: true } } } });
  expect(versiones.map((v) => [v.numero, v.tipoDeDiferencia, Number(v.porcentaje)])).toEqual([[2, "PORCENTAJE", 15], [1, "MONTO", 0]]);
  expect(versiones[0]!.consumos.map((c) => [c.efecto, c.insumoProductoId, c.reemplazaAProductoId, Number(c.cantidad)])).toEqual([["REEMPLAZA", almendras.id, leche.id, 0.2]]);

  // La pantalla dice «+ 15 %», su consumo, y desde cuándo rige en la hora de la empresa (Buenos Aires), con el anterior en el historial.
  await expect(fila).toContainText("+ 15 %");
  await expect(fila).toContainText(`reemplaza ${leche.nombre} por 0,2 l de ${almendras.nombre}`);
  await expect(fila).toContainText(`Rige desde ${formatearFechaHora(versiones[0]!.creadoEn, "America/Argentina/Buenos_Aires")}`);
  await fila.getByText("Cambios de precio anteriores (1)").click();
  await expect(fila).toContainText("+ $ 300");

  // La otra pestaña sigue mostrando el cambio 1: su cambio se rechaza y ofrece «Recargar».
  const filaVieja = otra.locator("[data-opcion='Almendras']");
  await filaVieja.getByRole("button", { name: "Cambiar precio o consumo de Almendras" }).click();
  await filaVieja.getByLabel("Diferencia en pesos").fill("350");
  await filaVieja.getByRole("button", { name: "Guardar el cambio" }).click();
  const choque = filaVieja.getByRole("alert").filter({ hasText: "cambió mientras lo editabas" });
  await expect(choque).toBeVisible();
  await expect(choque).not.toContainText(/versi[oó]n/);
  await expect(choque.getByRole("button", { name: "Recargar" })).toBeVisible();
  expect(await prisma.versionDeOpcion.count({ where: { opcionId } })).toBe(2);
});
