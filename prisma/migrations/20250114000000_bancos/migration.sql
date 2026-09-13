-- De dónde sale la imagen de cada serie: bancos (pexels, pixabay, nasa) y
-- medios (video, imagen). Vacío = lo que use la categoría de la historia.
ALTER TABLE "Serie" ADD COLUMN "bancos" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Serie" ADD COLUMN "medios" TEXT[] DEFAULT ARRAY[]::TEXT[];
