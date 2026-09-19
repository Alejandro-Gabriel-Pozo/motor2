/**
 * Valor de filtro del listado de compras para «las compras cargadas sin proveedor». En su propio archivo (sin importar nada del servidor) a
 * propósito: lo usan la tabla de Período (`"use client"`) y la consulta del listado, y importar un valor de un módulo que trae `prisma`
 * arrastraría `pg` al bundle del navegador.
 */
export const SIN_PROVEEDOR = "SIN";
