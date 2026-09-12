-- AlterTable
ALTER TABLE "Proyecto" ADD COLUMN     "calidad" TEXT NOT NULL DEFAULT 'normal',
ADD COLUMN     "bytes" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Variante" ADD COLUMN     "calidad" TEXT,
ADD COLUMN     "bytes" DOUBLE PRECISION;
