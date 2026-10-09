import type { BrowserContext } from "@playwright/test";

/**
 * Un ORIGEN propio para cada contexto del navegador (M-18 de la auditoría intermedia). Antes, un pedido sin `x-forwarded-for` no tenía cupo por origen; ahora cuenta en un balde común
 * («desconocido») con el mismo cupo que cualquier IP. El servidor de los E2E no trae un proxy delante: todos los pedidos de la corrida llegarían sin cabecera y compartirían un solo cupo
 * (30 aperturas de invitación por hora, 4 pedidos de código de la consola por hora), que se agota a mitad de la corrida. Cada contexto que abre una invitación o pide un código de ingreso
 * se presenta con su propia IP privada, como lo haría cada persona real detrás de Vercel. El cupo en sí NO se toca: sus pruebas están en `test/seguridad` y `test/plataforma`.
 */
export async function conOrigenPropio(contexto: BrowserContext): Promise<void> {
  const octeto = () => 1 + Math.floor(Math.random() * 254);
  await contexto.setExtraHTTPHeaders({ "x-forwarded-for": `10.${octeto()}.${octeto()}.${octeto()}` });
}
