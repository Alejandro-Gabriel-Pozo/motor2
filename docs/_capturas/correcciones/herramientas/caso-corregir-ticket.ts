/**
 * MAQUETA «Corregir un ticket» por pasos: paso 1 (buscar: fecha, letra, número; resultados abajo) y paso 2 (otra página: original y corregido lado a lado en escritorio). Pantallas reales sobre los tickets
 * reales de la base local. Muestra y calcula, NO guarda. Escritorio (1280, el que más importa para el largo de la página) y celular (375).
 */
import { abrir, foto } from "./comun";

async function recorrer(ancho: 375 | 1280, sufijo: string) {
  const { navegador, page } = await abrir(ancho);
  await page.goto("http://localhost:3300/reportes/tickets/corregir");
  await page.getByRole("heading", { name: "Corregir un ticket" }).waitFor();
  await foto(page, `70-ticket-paso1-buscar-${sufijo}`);

  // Buscar por número y letra
  await page.getByLabel("N.º de ticket").fill("3");
  await page.getByLabel("Letra").selectOption("A");
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.locator('[data-ticket-resultado="3-A"]').waitFor();
  await foto(page, `71-ticket-paso1-resultado-${sufijo}`);

  // Elegir → otra página
  await page.getByRole("link", { name: "Corregir →" }).click();
  await page.locator("[data-corregir-ticket]").waitFor();
  await foto(page, `72-ticket-paso2-original-y-corregido-${sufijo}`);

  // Quitar el Brownie
  await page.getByRole("button", { name: "Quitar Brownie" }).click();
  await foto(page, `73-ticket-paso2-quitando-una-linea-${sufijo}`);
  await navegador.close();
}

(async () => {
  await recorrer(1280, "escritorio");
  await recorrer(375, "celular");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
