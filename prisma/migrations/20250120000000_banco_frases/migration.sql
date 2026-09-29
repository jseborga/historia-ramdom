-- Banco de "Sad but true": las parejas palabra → frase y los remates, para
-- poder sortear un vídeo sin gastar IA. Lo que escribe la IA se guarda aquí
-- al vuelo, y lo pegado a mano entra por la misma puerta.
CREATE TYPE "TipoFrase" AS ENUM ('SORTEO', 'REMATE');

CREATE TABLE "Frase" (
    "id" TEXT NOT NULL,
    "tipo" "TipoFrase" NOT NULL DEFAULT 'SORTEO',
    "palabra" TEXT NOT NULL DEFAULT '',
    "texto" TEXT NOT NULL,
    "tema" TEXT NOT NULL DEFAULT '',
    "idioma" TEXT NOT NULL DEFAULT 'es',
    "tono" TEXT NOT NULL DEFAULT 'reflexiva',
    "fuente" "FuenteIdea" NOT NULL DEFAULT 'MANUAL',
    "usos" INTEGER NOT NULL DEFAULT 0,
    "usadaEn" TIMESTAMP(3),
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Frase_pkey" PRIMARY KEY ("id")
);

-- La misma pareja no entra dos veces, venga de donde venga.
CREATE UNIQUE INDEX "Frase_tipo_palabra_texto_key" ON "Frase"("tipo", "palabra", "texto");
CREATE INDEX "Frase_tipo_tema_idioma_idx" ON "Frase"("tipo", "tema", "idioma");
CREATE INDEX "Frase_usos_idx" ON "Frase"("usos");
