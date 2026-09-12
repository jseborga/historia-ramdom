-- CreateEnum
CREATE TYPE "EstadoProyecto" AS ENUM ('BORRADOR', 'RENDER', 'LISTO', 'ERROR');

-- CreateTable
CREATE TABLE "Proyecto" (
    "id" TEXT NOT NULL,
    "historiaId" TEXT,
    "nombre" TEXT NOT NULL,
    "formato" TEXT NOT NULL DEFAULT 'tiktok',
    "escenas" JSONB NOT NULL,
    "voz" JSONB,
    "musica" JSONB,
    "archivo" TEXT,
    "duracionSeg" DOUBLE PRECISION,
    "estado" "EstadoProyecto" NOT NULL DEFAULT 'BORRADOR',
    "error" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proyecto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Proyecto_estado_editadoEn_idx" ON "Proyecto"("estado", "editadoEn");

-- AddForeignKey
ALTER TABLE "Proyecto" ADD CONSTRAINT "Proyecto_historiaId_fkey" FOREIGN KEY ("historiaId") REFERENCES "Historia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

