import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import AxeBuilder from "@axe-core/playwright";

/**
 * P16 (decisión del dueño, 2026-10-11) de punta a punta: «Quitar del portal» APAGA la sucursal, no la borra. La carta pública de su dirección pasa a dar el 404 neutro (sin el nombre ni
 * la etiqueta de la sucursal), el slug queda RESERVADO (otra sucursal no lo puede tomar al editar) y, al volver a publicarla con la casilla, la MISMA dirección —la del QR ya impreso— vuelve a
 * funcionar. Prueba también que la caché de la carta (por etiqueta de empresa) se invalida en los dos sentidos: apagar y volver a publicar se ven al instante, sin esperar los 5 minutos.
 * Se mira con un pedido SIN sesión (`request`): la carta pública es un borde anónimo.
 */
test("quitar apaga y reserva el slug: la dirección da 404, otra sucursal no la toma, y publicar de nuevo la devuelve", async ({ page, request, paginaAutenticada: admin }) => {
  const marca = `${Date.now()}`;
  const nombreA = `E2E Reservado A ${marca}`;
  const nombreB = `E2E Reservado B ${marca}`;
  const etiquetaA = `Etiqueta Reservada ${marca}`;
  const slug = `e2e-reservado-${marca}`;
  const ruta = `/carta-publica/e2e/${slug}`;
  const [a, b] = await Promise.all([nombreA, nombreB].map((nombre) => prisma.sucursal.create({ data: { nombre } })));
  await prisma.sucursalPublica.create({ data: { sucursalId: a.id, slug, publicada: true, etiqueta: etiquetaA } });
  await prisma.sucursalPublica.create({ data: { sucursalId: b.id, slug: `e2e-reservado-otra-${marca}`, publicada: false } });

  try {
    // 1. Publicada: la dirección responde con la carta de A.
    const publicada = await request.get(ruta);
    expect(publicada.status()).toBe(200);
    expect(await publicada.text()).toContain(nombreA);

    // 2. «Quitar» desde la pantalla: queda sin publicar, con su dirección, y la fila sigue en la base.
    await admin.goto("/carta/portal");
    const filaA = admin.locator(`[data-sucursal-portal="${nombreA}"]`);
    const filaB = admin.locator(`[data-sucursal-portal="${nombreB}"]`);
    await expect(filaA).toContainText(`/carta/${slug} · publicada`);
    await filaA.locator("summary").click();
    await filaA.getByRole("button", { name: `Quitar «${nombreA}» del portal` }).click();
    await expect(filaA).toContainText(`/carta/${slug} · sin publicar`);
    expect(await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: a.id } })).toMatchObject({ slug, publicada: false, etiqueta: etiquetaA });

    // 3. La misma dirección da ahora el 404 neutro, sin ningún dato de la sucursal (ni el nombre ni la etiqueta), igual que un slug que no existe.
    const apagada = await request.get(ruta);
    expect(apagada.status()).toBe(404);
    const html = await apagada.text();
    expect(html).toContain("No encontramos esta carta");
    expect(html).not.toContain(nombreA);
    expect(html).not.toContain(etiquetaA);
    expect((await request.get(`/carta-publica/e2e/no-existe-${marca}`)).status()).toBe(404);
    await page.goto(ruta);
    await expect(page.getByRole("heading", { name: "No encontramos esta carta", level: 1 })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "el 404 de la carta apagada").toEqual([]);

    // 4. El slug quedó reservado: otra sucursal no lo puede tomar editándolo.
    await filaB.locator("summary").click();
    await filaB.getByLabel(/^Slug/).fill(slug);
    await filaB.getByRole("button", { name: `Guardar «${nombreB}»` }).click();
    await expect(filaB.getByRole("alert")).toHaveText(`El slug ${slug} ya lo usa "${nombreA}".`);
    expect(await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: b.id } })).toMatchObject({ slug: `e2e-reservado-otra-${marca}` });
    expect((await new AxeBuilder({ page: admin }).analyze()).violations, "/carta/portal con la sucursal apagada y el error de slug").toEqual([]);

    // 5. Volver a publicar con la casilla: la MISMA dirección vuelve a funcionar (la caché se invalidó en los dos sentidos).
    await filaA.getByLabel("Publicada en el portal").check();
    await filaA.getByRole("button", { name: `Guardar «${nombreA}»` }).click();
    await expect(filaA.getByRole("status")).toHaveText(`Portal: "${nombreA}" guardada y publicada.`);
    const republicada = await request.get(ruta);
    expect(republicada.status()).toBe(200);
    expect(await republicada.text()).toContain(nombreA);
    expect(await prisma.sucursalPublica.count({ where: { sucursalId: a.id } })).toBe(1);
  } finally {
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId: { in: [a.id, b.id] } } });
    await prisma.sucursal.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  }
});
