import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { expectObjetivosTactiles, expectSinDesborde } from "./fixtures/movil";
import { ajustarCeldasDelAdmin } from "./fixtures/admin-con-filas";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * «+ Opción» y «+ Extra» en el paso 2 «Opciones y precio» del espacio del producto (Fase 6, bloque 3): agregar una opción a un grupo que el producto ya usa, sin salir del producto, con `crearOpcionEnElProducto` (la
 * opción en el grupo de la biblioteca y lo que ESTE producto admite de ella, en una transacción). A 1280 px, y la ventana a 375:
 *  - una variante: «+ Opción» pide el nombre y lo que suma (arranca en 0); queda en el grupo y el producto la admite (y OTRO producto del mismo grupo no);
 *  - un adicional: «+ Extra» pide además la unidad del producto de respaldo, que crea el sistema;
 *  - un tamaño en precio propio: «+ Opción» pide el precio final de la opción;
 *  - un rechazo del servidor (un nombre que ya existe con otro importe) queda DENTRO de la ventana, que no se cierra, y no escribe nada;
 *  - quién lo ve: solo quien además de las opciones del producto puede Editar `opciones_definir`; quien no, no ve el botón.
 * Lo sembrado de opciones no se borra (ver `fixtures/opciones.ts`): nombres con marca propia.
 */

const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function productoConLeche(m: string, sucursalId: string) {
  const leche = await sembrarGrupo({ nombre: `E2E Leche ${m}`, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "De vaca" }, { nombre: "Almendras", monto: 150 }] });
  const nombre = `E2E Café opción ${m}`;
  const { productoId } = await sembrarProductoConOpciones({ nombre, codigo: `E2E-OP-${m}`, precioVenta: 2500, sucursalId, grupos: [{ grupo: leche }] });
  return { productoId, nombre, leche, grupoNombre: `E2E Leche ${m}` };
}

const tarjeta = (page: import("@playwright/test").Page, grupoNombre: string) => page.locator(`[data-admision-grupo="${grupoNombre}"]`);

for (const { ancho, alto } of [
  { ancho: 1280, alto: 800 },
  { ancho: 375, alto: 800 },
]) {
  test(`«+ Opción» en una variante, a ${ancho} px: nombre y lo que suma; queda en el grupo, el producto la admite y otro producto del grupo no`, async ({ paginaAutenticada: page, sucursalId }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const m = marca();
    const p = await productoConLeche(m, sucursalId);
    const otro = await sembrarProductoConOpciones({ nombre: `E2E Otro café ${m}`, codigo: `E2E-OT-${m}`, precioVenta: 2000, sucursalId, grupos: [{ grupo: p.leche }] });

    await page.goto(`/catalogo/productos/${p.productoId}/opciones`);
    const grupo = tarjeta(page, p.grupoNombre);
    await grupo.getByRole("button", { name: `+ Opción en ${p.grupoNombre}` }).click();
    const ventana = page.getByRole("dialog", { name: `Nueva opción en «${p.grupoNombre}» de «${p.nombre}»` });
    await expect(ventana.getByLabel(/^Nombre de la opción/)).toBeFocused();
    await expect(ventana.getByLabel(/^Cuánto suma/), "lo que suma arranca en 0").toHaveValue(/^0$/);
    await ventana.getByLabel(/^Nombre de la opción/).fill("Avena");
    await ventana.getByLabel(/^Cuánto suma/).fill("200");
    await expectSinDesborde(page, `${ancho} px: la ventana «+ Opción»`);
    if (ancho === 375) await expectObjetivosTactiles(ventana.getByRole("button"), `${ancho} px: botones de la ventana «+ Opción»`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "ventana «+ Opción» abierta").toEqual([]);

    await ventana.getByRole("button", { name: "Agregar la opción" }).click();
    await expect(ventana).toBeHidden();
    await expect(grupo.getByRole("status")).toContainText(`Listo: se agregó la opción «Avena» a «${p.grupoNombre}» de «${p.nombre}».`);

    const opcion = await prisma.opcionDeGrupo.findFirstOrThrow({ where: { grupoId: p.leche.grupoId, nombre: "Avena" }, include: { versiones: true } });
    expect(Number(opcion.versiones[0]!.diferenciaPrecio)).toBe(200);
    expect(await prisma.productoAdmiteOpcion.count({ where: { productoId: p.productoId, opcionId: opcion.id, activo: true } })).toBe(1);
    expect(await prisma.productoAdmiteOpcion.count({ where: { productoId: otro.productoId, opcionId: opcion.id } }), "el otro producto del grupo no la admite").toBe(0);
    // Después del refresco, la opción nueva está en la tarjeta del grupo.
    await expect(grupo).toContainText("Avena");
  });
}

test("«+ Extra» en un adicional: pide la unidad del respaldo, que crea el sistema, y el producto lo admite con el tope del grupo", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const extras = await sembrarGrupo({ nombre: `E2E Extras ${m}`, tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 3, marca: m, opciones: [{ nombre: "Queso", monto: 400, conAncla: true }] });
  const nombre = `E2E Pizza extras ${m}`;
  const { productoId } = await sembrarProductoConOpciones({ nombre, codigo: `E2E-EX-${m}`, precioVenta: 9000, sucursalId, grupos: [{ grupo: extras }] });

  await page.goto(`/catalogo/productos/${productoId}/opciones`);
  const grupo = tarjeta(page, `E2E Extras ${m}`);
  await grupo.getByRole("button", { name: `+ Extra en E2E Extras ${m}` }).click();
  const ventana = page.getByRole("dialog", { name: `Nuevo extra en «E2E Extras ${m}» de «${nombre}»` });
  await ventana.getByLabel(/^Nombre del extra/).fill(`Huevo ${m}`);
  await ventana.getByLabel(/^Cuánto cobra/).fill("350");
  // Sin la unidad (el selector es obligatorio) no se envía: la ventana sigue abierta y no se escribe nada.
  await ventana.getByRole("button", { name: "Agregar el extra" }).click();
  expect(await ventana.getByLabel("Unidad para el stock del extra").evaluate((el) => (el as HTMLSelectElement).validity.valueMissing), "la unidad es obligatoria").toBe(true);
  await expect(ventana).toBeVisible();
  expect(await prisma.opcionDeGrupo.count({ where: { grupoId: extras.grupoId, nombre: `Huevo ${m}` } }), "no se creó nada").toBe(0);

  await ventana.getByLabel("Unidad para el stock del extra").selectOption({ label: "unidad" });
  await ventana.getByRole("button", { name: "Agregar el extra" }).click();
  await expect(ventana).toBeHidden();
  await expect(grupo.getByRole("status")).toContainText(`se agregó el extra «Huevo ${m}»`);

  const opcion = await prisma.opcionDeGrupo.findFirstOrThrow({ where: { grupoId: extras.grupoId, nombre: `Huevo ${m}` }, include: { versiones: true } });
  expect(opcion.productoId, "el extra lleva su producto de respaldo").not.toBeNull();
  expect(Number(opcion.versiones[0]!.diferenciaPrecio)).toBe(350);
  expect(await prisma.disponibilidadProducto.count({ where: { productoId: opcion.productoId! } }), "el respaldo no se vende por su cuenta").toBe(0);
  expect(await prisma.productoAdmiteOpcion.findFirstOrThrow({ where: { productoId, opcionId: opcion.id } })).toMatchObject({ cantidadMaxima: 3, activo: true });
});

test("«+ Opción» en un tamaño con precio propio: pide el precio final de la opción y queda en lo que admite el producto", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const tamano = await sembrarGrupo({ nombre: `E2E Tamaño ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Chica" }, { nombre: "Grande" }] });
  const nombre = `E2E Pizza tamaños ${m}`;
  const { productoId } = await sembrarProductoConOpciones({ nombre, codigo: `E2E-TA-${m}`, precioVenta: 6000, sucursalId, grupos: [{ grupo: tamano, modoPrecio: "ABSOLUTO", preciosAbsolutos: { Chica: 6000, Grande: 9000 } }] });

  await page.goto(`/catalogo/productos/${productoId}/opciones`);
  const grupo = tarjeta(page, `E2E Tamaño ${m}`);
  await grupo.getByRole("button", { name: `+ Opción en E2E Tamaño ${m}` }).click();
  const ventana = page.getByRole("dialog", { name: /^Nueva opción en/ });
  await ventana.getByLabel(/^Nombre de la opción/).fill("Gigante");
  await ventana.getByLabel(/^Precio final de la opción/).fill("12000");
  await ventana.getByRole("button", { name: "Agregar la opción" }).click();
  await expect(ventana).toBeHidden();

  const opcion = await prisma.opcionDeGrupo.findFirstOrThrow({ where: { grupoId: tamano.grupoId, nombre: "Gigante" }, include: { versiones: true } });
  expect(Number(opcion.versiones[0]!.diferenciaPrecio), "el precio final va en lo que admite el producto, no en la versión").toBe(0);
  const fila = await prisma.productoAdmiteOpcion.findFirstOrThrow({ where: { productoId, opcionId: opcion.id } });
  expect(Number(fila.precioAbsoluto)).toBe(12000);
});

test("un rechazo del servidor queda dentro de la ventana, que no se cierra, y no escribe nada: un nombre que ya existe con otro importe", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const p = await productoConLeche(m, sucursalId);
  await page.goto(`/catalogo/productos/${p.productoId}/opciones`);
  await tarjeta(page, p.grupoNombre).getByRole("button", { name: `+ Opción en ${p.grupoNombre}` }).click();
  const ventana = page.getByRole("dialog", { name: /^Nueva opción en/ });
  await ventana.getByLabel(/^Nombre de la opción/).fill("almendras");
  await ventana.getByLabel(/^Cuánto suma/).fill("999");
  await ventana.getByRole("button", { name: "Agregar la opción" }).click();
  await expect(ventana.getByRole("alert")).toContainText(/Ya hay una opción llamada «Almendras»/);
  await expect(ventana, "la ventana no se cierra: lo tecleado no se pierde").toBeVisible();
  await expect(ventana.getByLabel(/^Nombre de la opción/)).toHaveValue("almendras");
  expect(await prisma.opcionDeGrupo.count({ where: { grupoId: p.leche.grupoId } }), "no se creó otra opción").toBe(2);
});

test("DOBLE clic en «Agregar la opción»: una sola opción en la base", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const p = await productoConLeche(m, sucursalId);
  await page.goto(`/catalogo/productos/${p.productoId}/opciones`);
  await tarjeta(page, p.grupoNombre).getByRole("button", { name: `+ Opción en ${p.grupoNombre}` }).click();
  const ventana = page.getByRole("dialog", { name: /^Nueva opción en/ });
  await ventana.getByLabel(/^Nombre de la opción/).fill("Soja");
  await ventana.getByRole("button", { name: "Agregar la opción" }).dblclick();
  await expect(ventana).toBeHidden();
  await expect.poll(() => prisma.opcionDeGrupo.count({ where: { grupoId: p.leche.grupoId, nombre: "Soja" } })).toBe(1);
});

test("quién lo ve: sin Editar de `opciones_definir` no hay «+ Opción» (sigue la frase de los grupos nuevos); con el Editar de vuelta, sí", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const p = await productoConLeche(m, sucursalId);
  const admin = await ajustarCeldasDelAdmin({ opciones_definir: { puedeVer: true, puedeEditar: false } });
  try {
    await page.goto(`/catalogo/productos/${p.productoId}/opciones`);
    await expect(page.getByRole("heading", { level: 2, name: "Opciones y precio" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^\+ (Opción|Extra)/ })).toHaveCount(0);
    await expect(page.getByText("Los grupos nuevos los crea quien arma las opciones")).toBeVisible();

    await admin.cambiar({ opciones_definir: { puedeVer: true, puedeEditar: true } });
    await page.goto(`/catalogo/productos/${p.productoId}/opciones`);
    await expect(tarjeta(page, p.grupoNombre).getByRole("button", { name: `+ Opción en ${p.grupoNombre}` })).toBeVisible();
  } finally {
    await admin.restaurar();
  }
});
