// Reemplaza "server-only" en el entorno de tests (ver vitest.config.ts) —
// ese paquete solo tira un error si lo importa un Client Component, algo
// que no existe corriendo bajo Vitest/Node directo.
export {};
