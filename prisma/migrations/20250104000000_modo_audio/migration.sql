-- CreateEnum
CREATE TYPE "ModoAudio" AS ENUM ('VOZ', 'MUSICA', 'MUDO');

-- AlterTable
ALTER TABLE "Serie" ADD COLUMN     "modoAudio" "ModoAudio" NOT NULL DEFAULT 'VOZ',
ADD COLUMN     "segundosEscena" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Historia" ADD COLUMN     "modoAudio" "ModoAudio" NOT NULL DEFAULT 'VOZ';

