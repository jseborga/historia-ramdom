import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipPista, Preset, RotuloPista } from "../api";
import { fragmentar, repartirTiempo, retardosKaraoke } from "../lectura";

/**
 * Vista previa por tiempo, como un reproductor de verdad: un reloj recorre el
 * proyecto y en cada instante muestra el clip que toca, los rotulos que caen
 * encima y la narracion real del servidor, cada pista por su cuenta.
 */
export function Lienzo({
  video,
  textos,
  preset,
  duracionTotal,
  urlVoz,
  vozInicio,
  urlMusica,
  musicaVolumen = 0.25,
  seek,
  alTiempo,
  alternar,
}: {
  video: ClipPista[];
  textos: RotuloPista[];
  preset: Preset;
  duracionTotal: number;
  urlVoz: string | null;
  vozInicio: number;
  /** La musica del proyecto, para editar oyendo lo que se va a oir. */
  urlMusica?: string | null;
  musicaVolumen?: number;
  /** Salto pedido desde fuera (bloque pulsado, regla). `n` cambia en cada salto. */
  seek: { t: number; n: number };
  alTiempo: (t: number) => void;
  /** Cambia para alternar reproducir/pausar desde fuera (barra espaciadora). */
  alternar?: { n: number };
}) {
  const [t, setT] = useState(0);
  const [reproduciendo, setReproduciendo] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const musica = useRef<HTMLAudioElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const ultimo = useRef(0);

  useEffect(() => {
    if (!alternar || alternar.n === 0) return;
    setReproduciendo((r) => !r);
  }, [alternar?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saltos desde fuera
  useEffect(() => {
    setT(Math.max(0, Math.min(seek.t, duracionTotal)));
  }, [seek.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // El reloj: requestAnimationFrame mientras se reproduce
  useEffect(() => {
    if (!reproduciendo) return;
    let id = 0;
    ultimo.current = performance.now();
    const paso = (ahora: number) => {
      const dt = (ahora - ultimo.current) / 1000;
      ultimo.current = ahora;
      setT((prev) => {
        const sig = prev + dt;
        if (sig >= duracionTotal) {
          setReproduciendo(false);
          return duracionTotal;
        }
        return sig;
      });
      id = requestAnimationFrame(paso);
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, [reproduciendo, duracionTotal]);

  useEffect(() => alTiempo(t), [t, alTiempo]);

  // Clip activo y su instante local
  const { clip, indice, local } = useMemo(() => {
    let acum = 0;
    for (const [i, c] of video.entries()) {
      if (t < acum + c.duracion || i === video.length - 1) {
        return { clip: c, indice: i, local: Math.min(Math.max(t - acum, 0), c.duracion) };
      }
      acum += c.duracion;
    }
    return { clip: null, indice: -1, local: 0 };
  }, [video, t]);

  // El video sigue al reloj: se resincroniza si se desvia mas de 0,35 s
  useEffect(() => {
    const v = vid.current;
    if (!v || !clip?.clip) return;
    const objetivo = local + clip.recorte;
    if (Math.abs(v.currentTime - objetivo) > 0.35) v.currentTime = objetivo;
    if (reproduciendo && v.paused) v.play().catch(() => {});
    if (!reproduciendo && !v.paused) v.pause();
  }, [t, local, clip, reproduciendo]);

  // La narracion real: arranca cuando el reloj llega a su inicio
  useEffect(() => {
    const a = audio.current;
    if (!a || !urlVoz) return;
    const enVoz = t >= vozInicio && t - vozInicio < (a.duration || Infinity);
    if (reproduciendo && enVoz) {
      if (Math.abs(a.currentTime - (t - vozInicio)) > 0.35) a.currentTime = t - vozInicio;
      if (a.paused) a.play().catch(() => {});
    } else if (!a.paused) {
      a.pause();
    }
  }, [t, reproduciendo, urlVoz, vozInicio]);

  // La musica acompaña al reloj desde el segundo cero, como en el render.
  useEffect(() => {
    const m = musica.current;
    if (!m || !urlMusica) return;
    m.volume = Math.max(0, Math.min(1, musicaVolumen));
    if (reproduciendo) {
      if (Math.abs(m.currentTime - t) > 0.35) m.currentTime = t;
      if (m.paused) m.play().catch(() => {});
    } else if (!m.paused) {
      m.pause();
    }
  }, [t, reproduciendo, urlMusica, musicaVolumen]);

  // Rotulos activos en este instante, cada uno con su trozo y su karaoke
  const activos = useMemo(
    () =>
      textos
        .filter((r) => r.texto.trim() && t >= r.inicio && t < r.inicio + r.duracion)
        .map((r) => {
          const frs = fragmentar(r.texto, r.lectura);
          const tiempos = repartirTiempo(frs, r.duracion);
          let rel = t - r.inicio;
          let i = 0;
          for (; i < frs.length - 1 && rel >= tiempos[i]; i++) rel -= tiempos[i];
          const texto = frs[i] ?? "";
          const encendidas =
            r.animacion === "resaltar"
              ? retardosKaraoke(texto, tiempos[i] ?? r.duracion).filter((d) => d <= rel).length
              : Infinity;
          return { r, texto, trozo: i, encendidas };
        }),
    [textos, t],
  );

  const progreso = clip ? local / clip.duracion : 0;
  const esFoto = clip?.clip?.tipo === "imagen";
  // Una foto sin movimiento parece un fallo: en el render se le pone Ken Burns
  // aunque el efecto elegido no mueva nada, y la vista previa hace lo mismo.
  const movimiento =
    clip && ["zoomLento", "alejar", "paneoDerecha", "paneoIzquierda", "kenBurns"].includes(clip.efecto)
      ? clip.efecto
      : esFoto
        ? "kenBurns"
        : "";
  const desplazar = (p: number) => `${(-6 * p).toFixed(2)}%`;
  const estiloMovimiento: React.CSSProperties =
    movimiento === "zoomLento"
      ? { transform: `scale(${1 + 0.12 * progreso})` }
      : movimiento === "alejar"
        ? { transform: `scale(${1.12 - 0.12 * progreso})` }
        : movimiento === "paneoDerecha"
          ? { transform: `scale(1.12) translateX(${desplazar(progreso)})` }
          : movimiento === "paneoIzquierda"
            ? { transform: `scale(1.12) translateX(${desplazar(1 - progreso)})` }
            : movimiento === "kenBurns"
              ? {
                  transform: `scale(${1 + 0.16 * progreso}) translate(${desplazar(progreso)}, ${desplazar(progreso)})`,
                }
              : {};
  const estiloEfecto: React.CSSProperties = {
    ...estiloMovimiento,
    transformOrigin: "center",
    ...(clip?.efecto === "fundido"
      ? { opacity: progreso < 0.12 ? progreso / 0.12 : progreso > 0.88 ? (1 - progreso) / 0.12 : 1 }
      : {}),
    ...(clip?.efecto === "blancoYNegro" ? { filter: "grayscale(1)" } : {}),
  };

  return (
    <>
      {urlVoz && <audio ref={audio} src={urlVoz} preload="auto" />}
      {urlMusica && <audio ref={musica} src={urlMusica} preload="auto" />}
      <div
        className="lienzo"
        style={{ aspectRatio: `${preset.ancho} / ${preset.alto}`, containerType: "size" }}
      >
        {clip?.clip && esFoto ? (
          <img key={clip.id} className="capa" style={estiloEfecto} src={clip.clip.url} alt="" />
        ) : clip?.clip ? (
          <video
            key={clip.id}
            ref={vid}
            className="capa"
            style={estiloEfecto}
            src={clip.clip.url}
            muted
            loop
            playsInline
            preload="auto"
          />
        ) : (
          <div className="fondo capa" style={{ background: clip?.color ?? "#000", ...estiloEfecto }} />
        )}
        {clip?.efecto === "vineta" && <div className="vineta" />}

        {activos.map(({ r, texto, trozo, encendidas }) => (
          <div
            key={`${r.id}-${trozo}`}
            className={`rotulo ${r.estilo.posicion} anim-${r.animacion === "resaltar" ? "ninguna" : r.animacion}`}
            style={{
              fontSize: `${(r.estilo.tamano / preset.alto) * 100}cqh`,
              color: r.estilo.color,
              fontWeight: r.estilo.negrita ? 700 : 400,
              fontFamily: `"${r.estilo.fuente}", "DejaVu Serif", Georgia, serif`,
              textShadow: `0 0 6px ${r.estilo.contorno}, 0 2px 4px ${r.estilo.contorno}`,
              WebkitTextStroke: `1px ${r.estilo.contorno}`,
            }}
          >
            {r.animacion === "resaltar"
              ? texto.split(/\s+/).map((w, i) => (
                  <span key={i} className={i < encendidas ? "palabra viva" : "palabra apagada"}>
                    {w}{" "}
                  </span>
                ))
              : texto}
          </div>
        ))}
      </div>

      <div className="fila" style={{ marginTop: 8 }}>
        <button
          className="primario"
          onClick={() => {
            if (!reproduciendo && t >= duracionTotal - 0.05) setT(0);
            setReproduciendo(!reproduciendo);
          }}
        >
          {reproduciendo ? "Pausar" : "Reproducir"}
        </button>
        <button onClick={() => { setReproduciendo(false); setT(0); }}>Inicio</button>
        <span className="suave">
          {t.toFixed(1)}s / {duracionTotal.toFixed(1)}s
          {indice >= 0 ? ` · clip ${indice + 1}` : ""}
          {urlVoz ? " · narracion real" : urlMusica ? "" : " · sin narracion generada"}
          {urlMusica ? " · con musica" : ""}
        </span>
      </div>
    </>
  );
}
