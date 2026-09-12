import { useEffect, useMemo, useState } from "react";
import type { EscenaMontaje, Preset } from "../api";
import { fragmentar, repartirTiempo, retardosKaraoke } from "../lectura";

/**
 * Vista previa del montaje. Reproduce las escenas en secuencia con sus
 * duraciones reales, va mostrando el texto por fragmentos como hara el render,
 * y aproxima con CSS los efectos de imagen y el karaoke de palabras.
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
  const [fragmento, setFragmento] = useState(0);
  const escena = escenas[indice];
  const hayVozNavegador = typeof window !== "undefined" && "speechSynthesis" in window;

  const fragmentos = useMemo(
    () => (escena ? fragmentar(escena.texto, escena.lectura) : []),
    [escena],
  );
  const tiempos = useMemo(
    () => (escena ? repartirTiempo(fragmentos, escena.duracion) : []),
    [fragmentos, escena],
  );

  // Al cambiar de escena se empieza por su primer fragmento.
  useEffect(() => setFragmento(0), [indice, escena?.id]);

  // Reproduccion: una cadena de temporizadores por fragmento; al acabar la
  // escena salta a la siguiente.
  useEffect(() => {
    if (!reproduciendo || !escena) return;
    const dura = fragmentos.length ? tiempos[fragmento] ?? escena.duracion : escena.duracion;
    const t = setTimeout(() => {
      if (fragmento + 1 < fragmentos.length) setFragmento(fragmento + 1);
      else if (indice + 1 < escenas.length) alCambiarIndice(indice + 1);
      else setReproduciendo(false);
    }, dura * 1000);
    return () => clearTimeout(t);
  }, [reproduciendo, indice, fragmento, fragmentos, tiempos, escena, escenas.length, alCambiarIndice]);

  // Voz del navegador: lee cada fragmento al entrar en el. Es una maqueta del
  // ritmo, no la voz del MP4.
  useEffect(() => {
    if (!hayVozNavegador) return;
    window.speechSynthesis.cancel();
    const texto = fragmentos[fragmento];
    if (!reproduciendo || !leer || !texto) return;
    const frase = new SpeechSynthesisUtterance(texto);
    frase.lang = /[áéíóúñ¿¡]/i.test(texto) || !/[a-z]/i.test(texto) ? "es-419" : "en-US";
    window.speechSynthesis.speak(frase);
    return () => window.speechSynthesis.cancel();
  }, [reproduciendo, leer, fragmento, fragmentos, hayVozNavegador]);

  if (!escena) return <p className="suave">Anade una escena para empezar.</p>;

  const total = escenas.reduce((s, e) => s + e.duracion, 0);
  const transcurrido = escenas.slice(0, indice).reduce((s, e) => s + e.duracion, 0);
  const tamanoRelativo = `${(escena.estilo.tamano / preset.alto) * 100}cqh`;
  const textoActual = fragmentos[fragmento] ?? "";
  const duraFragmento = tiempos[fragmento] ?? escena.duracion;
  const retardos = escena.animacion === "resaltar" ? retardosKaraoke(textoActual, duraFragmento) : [];

  return (
    <>
      <div
        className={`lienzo efecto-${escena.efecto}`}
        style={{
          aspectRatio: `${preset.ancho} / ${preset.alto}`,
          containerType: "size",
          ["--dur" as string]: `${escena.duracion}s`,
        }}
      >
        {escena.clip ? (
          <video
            key={escena.clip.id + escena.id}
            className="capa"
            src={escena.clip.url}
            muted
            loop
            autoPlay
            playsInline
          />
        ) : (
          <div className="fondo capa" style={{ background: escena.color }} />
        )}
        {escena.efecto === "vineta" && <div className="vineta" />}

        <div
          key={`t-${escena.id}-${escena.animacion}-${fragmento}`}
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
          {escena.animacion === "resaltar"
            ? textoActual.split(/\s+/).map((w, i) => (
                <span
                  key={i}
                  className="palabra"
                  style={{ animationDelay: `${retardos[i] ?? 0}s` }}
                >
                  {w}{" "}
                </span>
              ))
            : textoActual}
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
          Escena {indice + 1} de {escenas.length}
          {fragmentos.length > 1 ? ` · trozo ${fragmento + 1} de ${fragmentos.length}` : ""} ·{" "}
          {transcurrido.toFixed(1)}s de {total.toFixed(1)}s
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
        Vista orientativa: posicion, letra, trozos y efectos se corresponden con el render, pero el
        salto de linea puede variar unos pixeles.
      </p>
    </>
  );
}
