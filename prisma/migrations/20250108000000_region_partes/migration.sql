-- AlterTable
ALTER TABLE "Serie" ADD COLUMN     "modismos" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "partes" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "region" TEXT NOT NULL DEFAULT 'bolivia';

-- AlterTable
ALTER TABLE "Historia" ADD COLUMN     "continuaDeId" TEXT,
ADD COLUMN     "parte" INTEGER NOT NULL DEFAULT 1;

