import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Orden autosugerido en la carta (docs/plan-carta-seccion-directa-2026-09-25.md, DA5/DA6, M8), en un navegador real:
 *  - DA5: "Nueva sección de carta" arranca con orden = cuántas secciones hay (cae al final), y después de crear una, el formulario
 *    vuelve a arrancar con el siguiente número;
 *  - DA6: en el contenido de un PV (/carta) y en un ítem agrupado (/carta/agrupados), elegir una sección
 *    autocompleta el orden con la cantidad de ítems que ya tiene; editar algo existente sin cambiar de sección conserva su orden
 *    guardado, y volver a su sección lo recupera.
 */
test("el orden se autosugiere al crear una sección y al elegir la sección de un producto o ítem agrupado", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  // «Llena» ya tiene 2 ítems (un PV suelto visible y un ítem agrupado prendido); «Vacía», ninguno.
  const llena = await prisma.seccionCarta.create({ data: { nombre: `E2E Orden Llena ${marca}`, orden: 50 } });
  const vacia = await prisma.seccionCarta.create({ data: { nombre: `E2E Orden Vacía ${marca}`, orden: 51 } });
  const crear = (q: string) =>
    prisma.producto.create({ data: { codigo: `E2E_ORD_${q}_${marca}`, nombre: `E2E Orden ${q} ${marca}`, tipo: "PV", precioVenta: 1000, unidadStockId: unidad.id } });
  const [ubicado, conOrden, nuevo, opcion] = await Promise.all([crear("Ubicado"), crear("ConOrden"), crear("Nuevo"), crear("Opcion")]);
  const productoIds = [ubicado, conOrden, nuevo, opcion].map((p) => p.id);
  await prisma.disponibilidadProducto.createMany({ data: productoIds.map((productoId) => ({ sucursalId, productoId, disponible: true })) });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: ubicado.id, visibleEnCarta: true, seccionCartaId: llena.id, orden: 0 } });
  // Guardado en «Llena» con orden 7 (y oculto, así no cambia la cuenta de «Llena»).
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: conOrden.id, visibleEnCarta: false, seccionCartaId: llena.id, orden: 7 } });
  // CARTA-MANT: un PV SIN contenido ya no tiene ficha (va a «Fuera de carta», con «Agregar a la carta»); el que se ubica por primera vez es uno oculto y sin sección.
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: nuevo.id, visibleEnCarta: false, seccionCartaId: null, orden: 0 } });
  const agrupado = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: `E2E Orden Agrupado ${marca}`, seccionCartaId: llena.id, orden: 3 } });
  await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId, itemAgrupadoCartaId: agrupado.id, productoId: opcion.id } });
  const nombreSeccionNueva = `E2E Orden Nueva ${marca}`;

  try {
    // DA5: sección nueva.
    const cantidadSecciones = await prisma.seccionCarta.count();
    // CARTA-MANT: los formularios de las secciones y la ficha de cada producto viven en Parametrización › Secciones.
    await page.goto("/carta/parametrizacion/secciones");
    const nuevaSeccion = page.locator("form", { has: page.getByRole("heading", { name: "Nueva sección de carta" }) });
    await expect(nuevaSeccion.getByLabel("Orden")).toHaveValue(String(cantidadSecciones));
    await nuevaSeccion.getByRole("textbox", { name: "Nombre", exact: true }).fill(nombreSeccionNueva);
    await nuevaSeccion.getByRole("button", { name: "Crear sección" }).click();
    await expect(nuevaSeccion.getByRole("status")).toHaveText(`Sección de carta "${nombreSeccionNueva}" creada.`);
    expect((await prisma.seccionCarta.findFirstOrThrow({ where: { nombre: nombreSeccionNueva } })).orden).toBe(cantidadSecciones);
    // Tras el alta (y el refresco), el formulario vuelve a arrancar con el siguiente.
    await expect(nuevaSeccion.getByLabel("Orden")).toHaveValue(String(cantidadSecciones + 1));

    // DA6 en /carta: un PV oculto y sin sección (grupo «Ocultos, sin sección»).
    await page.locator(`[data-grupo-de-la-carta="Ocultos, sin sección"] > summary`).click();
    const filaNuevo = page.locator(`[data-contenido-carta="${nuevo.nombre}"]`);
    await filaNuevo.locator("summary").click();
    const seccionNuevo = filaNuevo.getByLabel(/^Sección de carta/);
    const ordenNuevo = filaNuevo.getByLabel("Orden dentro de su sección");
    await expect(ordenNuevo).toHaveValue("0");
    await seccionNuevo.selectOption(llena.id);
    await expect(ordenNuevo).toHaveValue("2");
    await seccionNuevo.selectOption(vacia.id);
    await expect(ordenNuevo).toHaveValue("0");
    // Sigue siendo editable a mano, y se guarda lo que quedó en el campo.
    await seccionNuevo.selectOption(llena.id);
    await expect(ordenNuevo).toHaveValue("2");
    await filaNuevo.getByLabel("Se muestra en la carta").check();
    await filaNuevo.getByRole("button", { name: `Guardar contenido de «${nuevo.nombre}»` }).click();
    // Al guardarse pasa del grupo «Ocultos, sin sección» al de «Llena» (el renglón se vuelve a dibujar ahí): se mira lo guardado.
    await expect.poll(async () => (await prisma.contenidoCartaProducto.findFirstOrThrow({ where: { productoId: nuevo.id } })).seccionCartaId).toBe(llena.id);
    expect(await prisma.contenidoCartaProducto.findFirstOrThrow({ where: { productoId: nuevo.id } })).toMatchObject({ seccionCartaId: llena.id, orden: 2, visibleEnCarta: true });

    // DA6: editar uno existente sin cambiar de sección conserva su orden; cambiar y volver lo recupera.
    await page.locator(`[data-grupo-de-la-carta="${llena.nombre}"] > summary`).click();
    const filaConOrden = page.locator(`[data-contenido-carta="${conOrden.nombre}"]`);
    await filaConOrden.locator("summary").click();
    const seccionConOrden = filaConOrden.getByLabel(/^Sección de carta/);
    const ordenConOrden = filaConOrden.getByLabel("Orden dentro de su sección");
    await expect(seccionConOrden).toHaveValue(llena.id);
    await expect(ordenConOrden).toHaveValue("7");
    await seccionConOrden.selectOption(vacia.id);
    await expect(ordenConOrden).toHaveValue("0");
    await seccionConOrden.selectOption(llena.id);
    await expect(ordenConOrden).toHaveValue("7");

    // DA6 en /carta/agrupados. «Llena» ahora tiene 3 ítems (se sumó el PV recién guardado).
    await page.goto("/carta/agrupados");
    const nuevoItem = page.locator("form", { has: page.getByRole("heading", { name: "Nuevo ítem agrupado" }) });
    const ordenItemNuevo = nuevoItem.getByLabel("Orden dentro de su sección");
    await expect(ordenItemNuevo).toHaveValue("0");
    await nuevoItem.getByLabel(/^Sección de carta/).selectOption(llena.id);
    await expect(ordenItemNuevo).toHaveValue("3");
    await nuevoItem.getByLabel(/^Sección de carta/).selectOption(vacia.id);
    await expect(ordenItemNuevo).toHaveValue("0");

    const filaItem = page.locator(`[data-item-agrupado="${agrupado.nombre}"]`);
    await filaItem.locator("summary").first().click();
    const ordenItem = filaItem.getByLabel("Orden dentro de su sección");
    await expect(filaItem.getByLabel(/^Sección de carta/)).toHaveValue(llena.id);
    await expect(ordenItem).toHaveValue("3");
    await filaItem.getByLabel(/^Sección de carta/).selectOption(vacia.id);
    await expect(ordenItem).toHaveValue("0");
    await filaItem.getByLabel(/^Sección de carta/).selectOption(llena.id);
    await expect(ordenItem).toHaveValue("3");
  } finally {
    await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { itemAgrupadoCartaId: agrupado.id } });
    await prisma.itemAgrupadoCarta.deleteMany({ where: { id: agrupado.id } });
    await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: productoIds } } });
    await prisma.seccionCarta.deleteMany({ where: { OR: [{ id: { in: [llena.id, vacia.id] } }, { nombre: nombreSeccionNueva }] } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
    await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
  }
});
