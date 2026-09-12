-- CreateEnum
CREATE TYPE "TipoProyecto" AS ENUM ('NARRACION', 'MUSICA');

-- AlterTable
ALTER TABLE "Proyecto" ADD COLUMN     "tipo" "TipoProyecto" NOT NULL DEFAULT 'NARRACION',
ADD COLUMN     "letra" JSONB;

-- CreateTable
CREATE TABLE "Variante" (
    "id" TEXT NOT NULL,
    "proyectoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "formato" TEXT NOT NULL DEFAULT 'tiktok',
    "inicio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duracion" DOUBLE PRECISION,
    "archivo" TEXT,
    "duracionSeg" DOUBLE PRECISION,
    "estado" "EstadoProyecto" NOT NULL DEFAULT 'BORRADOR',
    "error" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Variante_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Variante_proyectoId_creadaEn_idx" ON "Variante"("proyectoId", "creadaEn");

-- AddForeignKey
ALTER TABLE "Variante" ADD CONSTRAINT "Variante_proyectoId_fkey" FOREIGN KEY ("proyectoId") REFERENCES "Proyecto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
