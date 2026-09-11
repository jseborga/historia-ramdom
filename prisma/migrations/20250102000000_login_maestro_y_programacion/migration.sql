-- AlterTable
ALTER TABLE "User" ADD COLUMN     "maestro" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Serie" ADD COLUMN     "modelo" TEXT;

-- AlterTable
ALTER TABLE "Historia" ADD COLUMN     "publicarEn" TIMESTAMP(3);

