import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { TOKEN_CARTA_E2E } from "./fixtures/carta-token";

/**
 * Admin de la carta (/carta, docs/plan-carta-catalogo-2026-09-24.md, M10) de punta a punta: lo que se carga en la
 * pantalla (sección de carta, contenido del PV con su sección elegida DIRECTO —docs/plan-carta-seccion-directa-2026-09-25.md— y
 * una promo) es lo que devuelve el endpoint público GET /api/carta/[sucursal] — con el precio que se cobra, los tags normalizados
 * y el ★.
 */
test("cargar la carta desde el admin la publica en /api/carta/[sucursal]", async ({ paginaAutenticada: page, sucursalId, request }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const nombreSeccion = `E2E Carta Sección ${marca}`;
  const nombrePromo = `E2E Carta Promo ${marca}`;
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
  const categoria = await prisma.categoriaProducto.create({ data: { nombre: `E2E Carta Cat ${marca}` } });
  const producto = await prisma.producto.create({
    data: { codigo: `E2E_CARTA_ADMIN_${marca}`, nombre: `E2E Carta Plato ${marca}`, tipo: "PV", categoriaId: categoria.id, precioVenta: 12345, unidadStockId: unidad.id },
  });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });

  try {
    await page.goto("/carta");
    await expect(page.getByRole("heading", { name: "Carta pública", level: 1 })).toBeVisible();
    // D3: un PV disponible acá sin contenido de carta se avisa (si no, pasaría desapercibido que no sale).
    await expect(page.getByRole("heading", { name: /PV disponibles acá sin contenido de carta/ })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: new RegExp(`^${producto.nombre}$`) })).toBeVisible();

    // 1. Sección de carta nueva.
    const nuevaSeccion = page.locator("form", { has: page.getByRole("heading", { name: "Nueva sección de carta" }) });
    await nuevaSeccion.getByLabel("Nombre", { exact: true }).fill(nombreSeccion);
    await nuevaSeccion.getByLabel(/^Título/).fill("Del fuego");
    await nuevaSeccion.getByLabel("Orden").fill("1");
    await nuevaSeccion.getByRole("button", { name: "Crear sección" }).click();
    await expect(nuevaSeccion.getByRole("status")).toHaveText(`Sección de carta "${nombreSeccion}" creada.`);

    // Ya no existe el bloque "Qué categoría va en cada sección": la categoría no ubica nada en la carta.
    await expect(page.getByRole("heading", { name: "Qué categoría va en cada sección" })).toHaveCount(0);

    // 2. Contenido de carta del PV, con su sección elegida directo. Sin imagen propia (solo la sección tiene imagen).
    const filaProducto = page.locator(`[data-contenido-carta="${producto.nombre}"]`);
    await filaProducto.locator("summary").click();
    await expect(filaProducto.getByLabel(/^Imagen/)).toHaveCount(0);
    // Visible sin sección: la acción lo rechaza (DA2) y el formulario no se limpia.
    await filaProducto.getByRole("button", { name: `Guardar contenido de «${producto.nombre}»` }).click();
    await expect(filaProducto.getByRole("alert")).toHaveText("Elegí la sección de carta donde se muestra (sin sección no puede salir en la carta).");
    await filaProducto.getByLabel(/^Sección de carta/).selectOption({ label: nombreSeccion });
    await filaProducto.getByLabel("Descripción (opcional)").fill("400 g a las brasas");
    await filaProducto.getByLabel("Tags (separados por coma)").fill("Regional, regional, Sin TACC");
    await filaProducto.getByLabel("Especial (★)").check();
    await expect(filaProducto.getByLabel("Se muestra en la carta")).toBeChecked();
    await filaProducto.getByRole("button", { name: `Guardar contenido de «${producto.nombre}»` }).click();
    await expect(filaProducto.getByRole("status")).toHaveText(`Carta: "${producto.nombre}" se muestra.`);

    // 3. Una promo de la sucursal en esa sección.
    const nuevaPromo = page.locator("form", { has: page.getByRole("heading", { name: "Nueva promo" }) });
    await nuevaPromo.getByLabel("Título", { exact: true }).fill(nombrePromo);
    await nuevaPromo.getByLabel("Sección de carta").selectOption({ label: nombreSeccion });
    await nuevaPromo.getByLabel("Precio").fill("25000");
    await nuevaPromo.getByRole("button", { name: "Crear promo" }).click();
    await expect(nuevaPromo.getByRole("status")).toHaveText(`Promo "${nombrePromo}" creada en "${nombreSeccion}".`);

    // Y la carta pública lo refleja (sin cupos: `CartaV1` nunca los expone, D3 del paso 4 — el contrato público no cambia).
    const r = await request.get(`/api/carta/${sucursalId}`, { headers: { Authorization: `Bearer ${TOKEN_CARTA_E2E}` } });
    expect(r.status()).toBe(200);
    const carta = await r.json();
    const seccion = carta.secciones.find((s: { nombre: string }) => s.nombre === nombreSeccion);
    expect(seccion, "la sección cargada desde el admin no aparece en la carta pública").toBeTruthy();
    expect(seccion.titulo).toBe("Del fuego");
    expect(seccion.items).toEqual([
      { productoId: producto.id, nombre: producto.nombre, categoria: categoria.nombre, descripcion: "400 g a las brasas", precio: 12345, tags: ["Regional", "Sin TACC"], especial: true, imagenUrl: null },
    ]);
    expect(seccion.promos).toEqual([{ id: expect.any(String), titulo: nombrePromo, descripcion: null, precio: 25000, orden: 0 }]);

    // 4. Cupos de esa promo (Task #16, docs/plan-promo-combo-2026-09-26.md, D1): sin cupos empieza informativa; se tilda su propia
    // sección con mínimo 1 y máximo 2, y pasa a ser armable — sin que el contrato público (CartaV1) se entere.
    const filaPromo = page.locator(`[data-promo-carta="${nombrePromo}"]`);
    await expect(filaPromo.getByText("Informativa (sin cupos)")).toBeVisible();
    await filaPromo.getByText("Informativa (sin cupos)").click();
    const filaCupoSeccion = filaPromo.locator(`[data-cupo-seccion="${nombreSeccion}"]`);
    await filaCupoSeccion.getByLabel(new RegExp(`^${nombreSeccion}`)).check();
    await filaCupoSeccion.getByLabel("mín.").fill("1");
    await filaCupoSeccion.getByLabel("máx.").fill("2");
    await filaPromo.getByRole("button", { name: "Guardar cupos" }).click();
    await expect(filaPromo.getByRole("status")).toHaveText(`Cupos de "${nombrePromo}" guardados (1): ahora es una promo armable en el POS.`);
    await expect(filaPromo.getByText("Armable — 1 cupo")).toBeVisible();

    // Paso 13 (opcional, no bloqueante): con máximo 2, el peor caso son 2 unidades — el piso de D3 es $0,02, muy por debajo del
    // precio de esta promo ($25.000): el aviso lo dice, sin bloquear nada (guardarCuposPromoCarta ya lo hace duro si se cruza).
    await expect(filaPromo.locator(`[data-aviso-peor-caso="${nombrePromo}"]`)).toContainText("el peor caso son 2 unidades y el precio mínimo permitido es $0,02");
    await expect(filaPromo.locator(`[data-aviso-peor-caso="${nombrePromo}"]`)).toContainText("de margen antes de ese piso si subís algún máximo");

    const r2 = await request.get(`/api/carta/${sucursalId}`, { headers: { Authorization: `Bearer ${TOKEN_CARTA_E2E}` } });
    const carta2 = await r2.json();
    const seccion2 = carta2.secciones.find((s: { nombre: string }) => s.nombre === nombreSeccion);
    expect(seccion2.promos).toEqual([{ id: expect.any(String), titulo: nombrePromo, descripcion: null, precio: 25000, orden: 0 }]);
  } finally {
    const secciones = await prisma.seccionCarta.findMany({ where: { nombre: nombreSeccion }, select: { id: true } });
    const seccionIds = secciones.map((s) => s.id);
    await prisma.promoCartaCupo.deleteMany({ where: { promoCarta: { seccionCartaId: { in: seccionIds } } } });
    await prisma.promoCarta.deleteMany({ where: { seccionCartaId: { in: seccionIds } } });
    await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.seccionCarta.deleteMany({ where: { id: { in: seccionIds } } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
    await prisma.categoriaProducto.deleteMany({ where: { id: categoria.id } });
  }
});

/** ADR-006: /catalogo/carta se movió a /carta — el redirect (next.config.ts) evita romper marcadores guardados. */
test("un marcador viejo a /catalogo/carta/tema redirige a /carta/tema", async ({ paginaAutenticada: page }) => {
  await page.goto("/catalogo/carta/tema");
  await expect(page).toHaveURL(/\/carta\/tema$/);
  await expect(page.getByRole("heading", { name: "Tema de la carta", level: 1 })).toBeVisible();
});
