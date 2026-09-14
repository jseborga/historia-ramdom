-- Con qué se publica un vídeo que no viene de una historia: gancho viral,
-- etiquetas y, si lo hay, el producto de Amazon al que hace referencia
-- ({ producto, gancho, ganchos, hashtags }). Sin guardarlo, el enlace de
-- afiliado y la divulgación obligatoria desaparecían en cada render.
ALTER TABLE "Proyecto" ADD COLUMN "publicacion" JSONB;
