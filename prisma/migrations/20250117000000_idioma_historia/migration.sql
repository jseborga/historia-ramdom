-- En qué idioma se escribió cada historia. Sin esto, la continuación de una
-- historia suelta volvía al español por defecto, aunque la parte 1 estuviera
-- en inglés.
ALTER TABLE "Historia" ADD COLUMN "idioma" TEXT NOT NULL DEFAULT 'es';
