-- Sad but true pasa a tener tres secciones con el mismo formato: la de
-- siempre (triste), motivación y sarcasmo. Lo que ya había es de la primera.
ALTER TABLE "Frase" ADD COLUMN "seccion" TEXT NOT NULL DEFAULT 'triste';
CREATE INDEX "Frase_seccion_tipo_idioma_idx" ON "Frase"("seccion", "tipo", "idioma");
