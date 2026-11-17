-- Reversa de 20261117170000_empresa_zona_horaria_valida: saca el disparador y las dos funciones. No toca datos. Se puede correr dos veces.
DROP TRIGGER IF EXISTS "Empresa_zona_horaria_valida" ON "Empresa";
DROP FUNCTION IF EXISTS empresa_validar_zona_horaria();
DROP FUNCTION IF EXISTS zona_horaria_valida(text);
