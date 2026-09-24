/**
 * Token de servicio de `GET /api/carta/[sucursal]` para los E2E: playwright.config.ts lo pasa al servidor como
 * `CARTA_API_TOKEN` (webServer.env) y test/e2e/api-carta.spec.ts lo manda como `Authorization: Bearer`. Un solo lugar para
 * que no se desincronicen. No es un secreto: solo vale contra el servidor local de la suite.
 */
export const TOKEN_CARTA_E2E = "e2e-carta-token";
