-- CreateTable
CREATE TABLE "ReferenciaBiblica" (
    "id" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "libro" INTEGER NOT NULL,
    "capitulo" INTEGER NOT NULL,
    "versiculo" INTEGER NOT NULL,
    "capituloFin" INTEGER NOT NULL,
    "versiculoFin" INTEGER NOT NULL,
    "tema" TEXT NOT NULL DEFAULT '',
    "dato" TEXT NOT NULL DEFAULT '',
    "palabra" TEXT NOT NULL DEFAULT '',
    "frase" TEXT NOT NULL DEFAULT '',
    "remate" TEXT NOT NULL DEFAULT '',
    "tono" TEXT NOT NULL DEFAULT 'historico',
    "fuente" "FuenteIdea" NOT NULL DEFAULT 'MANUAL',
    "usos" INTEGER NOT NULL DEFAULT 0,
    "usadaEn" TIMESTAMP(3),
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editadaEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferenciaBiblica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferenciaBiblica_libro_capitulo_versiculo_capituloFin_vers_key" ON "ReferenciaBiblica"("libro", "capitulo", "versiculo", "capituloFin", "versiculoFin");

-- CreateIndex
CREATE INDEX "ReferenciaBiblica_orden_idx" ON "ReferenciaBiblica"("orden");
