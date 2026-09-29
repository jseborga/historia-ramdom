-- Un par pegado a mano viene muchas veces en dos tiempos: "La paciencia es
-- infinita ; la vida es finita". El cierre es de ESA frase, no de cualquiera,
-- así que se guarda con ella; sin esto se mezclaba con el montón de remates y
-- el chiste se partía por la mitad.
ALTER TABLE "Frase" ADD COLUMN "remate" TEXT NOT NULL DEFAULT '';
