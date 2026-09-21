-- CreateTable
CREATE TABLE "PreferenciaUsuario" (
    "usuarioId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreferenciaUsuario_pkey" PRIMARY KEY ("usuarioId","clave")
);

-- AddForeignKey
ALTER TABLE "PreferenciaUsuario" ADD CONSTRAINT "PreferenciaUsuario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
