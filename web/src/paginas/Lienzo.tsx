import { useEffect, useState } from "react";
import type { EscenaMontaje, Preset } from "../api";

/**
 * Vista previa del montaje. Reproduce las escenas en secuencia con sus
 * duraciones reales y rotula el texto en la misma posicion, tamano y animacion
 * que despues quemara ffmpeg.
 */
export function Lienzo({
  escenas,
  preset,
  indice,
  alCambiarIndice,
}: {
  escenas: EscenaMontaje[];
  preset: Preset;
  indice: number;
  alCambiarIndice: (i: number) => void;
}) {
  const [reproduciendo, setReproduciendo] = useState(false);
  const [leer, setLeer] = useState(true);
  const escena = escenas[indice];
  const hayVozNavegador = typeof window !== "undefined" && "speechSynthesis" in window;

  // Voz del navegador para probar el ritmo sin renderizar: lee cada escena al
  // entrar en ella mientras se reproduce. No es la voz del MP4, es una maqueta.
  useEffect(() => {
    if (!hayVozNavegador) return;
    window.speechSynthesis.cancel();
    if (!reproduciendo || !leer || !escena?.texto.trim()) return;
    const frase = new SpeechSynthesisUtterance(escena.texto);
    frase.lang = /[a-z]/i.test(escena.texto) && !/[áéíóúñ¿¡]/i.test(escena.texto) ? "en-US" : "es-419";
    frase.rate = 1;
    window.speechSynthesis.speak(frase);
    return () => window.speechSynthesis.cancel();
  }, [reproduciendo, leer, indice, escena, hayVozNavegador]);

  // La reproduccion es una cadena de temporizadores: cada escena dura lo suyo.
  useEffect(() => {
    if (!reproduciendo || !escena) return;
    const t = setTimeout(() => {
      if (indice + 1 < escenas.length) alCambiarIndice(indice + 1);
      else setReproduciendo(false);
    }, escena.duracion * 1000);
    return () => clearTimeout(t);
  }, [reproduciendo, indice, escena, escenas.length, alCambiarIndice]);

  if (!escena) return <p className="suave">Anade una escena para empezar.</p>;

  const total = escenas.reduce((s, e) => s + e.duracion, 0);
  const transcurrido = escenas.slice(0, indice).reduce((s, e) => s + e.duracion, 0);

  // El tamano del rotulo es relativo al lienzo, no a pixeles de pantalla, para
  // que la vista previa se parezca al render sea cual sea el tamano del navegador.
  const tamanoRelativo = `${(escena.estilo.tamano / preset.alto) * 100}cqh`;

  return (
    <>
      <div
        className="lienzo"
        style={{ aspectRatio: `${preset.ancho} / ${preset.alto}`, containerType: "size" }}
      >
        {escena.clip ? (
          <video
            key={escena.clip.id + escena.id}
            src={escena.clip.url}
            muted
            loop
            autoPlay
            playsInline
          />
        ) : (
          <div className="fondo" style={{ background: escena.color }} />
        )}

        <div
          key={`t-${escena.id}-${escena.animacion}-${indice}`}
          className={`rotulo ${escena.estilo.posicion} anim-${escena.animacion}`}
          style={{
            fontSize: tamanoRelativo,
            color: escena.estilo.color,
            fontWeight: escena.estilo.negrita ? 700 : 400,
            fontFamily: `"${escena.estilo.fuente}", "DejaVu Serif", Georgia, serif`,
            textShadow: `0 0 6px ${escena.estilo.contorno}, 0 2px 4px ${escena.estilo.contorno}`,
            WebkitTextStroke: `1px ${escena.estilo.contorno}`,
          }}
        >
          {escena.texto}
        </div>
      </div>

      <div className="fila" style={{ marginTop: 8 }}>
        <button onClick={() => setReproduciendo(!reproduciendo)}>
          {reproduciendo ? "Pausar" : "Reproducir"}
        </button>
        <button onClick={() => alCambiarIndice(Math.max(0, indice - 1))} disabled={indice === 0}>
          Anterior
        </button>
        <button
          onClick={() => alCambiarIndice(Math.min(escenas.length - 1, indice + 1))}
          disabled={indice >= escenas.length - 1}
        >
          Siguiente
        </button>
        <span className="suave">
          Escena {indice + 1} de {escenas.length} · {transcurrido.toFixed(1)}s de{" "}
          {total.toFixed(1)}s
        </span>
        {hayVozNavegador && (
          <label className="suave">
            <input
              type="checkbox"
              style={{ width: "auto", marginRight: 6 }}
              checked={leer}
              onChange={(e) => setLeer(e.target.checked)}
            />
            Leer con la voz del navegador
          </label>
        )}
      </div>
      <p className="suave">
        La vista previa es orientativa: el render final quema el texto con ffmpeg y puede variar
        unos pixeles en el salto de linea.
      </p>
    </>
  );
}
