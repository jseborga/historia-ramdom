-- CreateEnum
CREATE TYPE "SalidaSerie" AS ENUM ('VIDEO', 'MONTAJE');

-- AlterEnum
ALTER TYPE "EstadoHistoria" ADD VALUE 'MONTAJE';

-- AlterTable
ALTER TABLE "Serie" ADD COLUMN     "salida" "SalidaSerie" NOT NULL DEFAULT 'VIDEO';

