import { useEffect, useRef, useState } from "react";
import { urlMuestra, type ClipPista, type RotuloPista, type VozPista } from "../api";

/**
 * Linea de tiempo multipista al estilo CapCut: zoom (deslizador y Ctrl+rueda),
 * bloques que se arrastran, bordes que se estiran, cabezal que se arrastra y
 * division del clip por el cabezal. Los clips nunca superan su duracion real.
 */
export type Sel = { tipo: "clip" | "texto" | "voz"; id?: string };

const inicioDe = (video: ClipPista[], i: number) => video.slice(0, i).reduce((s, c) => s + c.duracion, 0);
const red = (n: number) => Math.round(n * 20) / 20;
const IMAN = 0.25;

export function LineaDeTiempo({
  video, textos, voz, total, t, sel,
  alSeleccionar, alSaltar, alCambiarVideo, alCambiarTextos, alCambiarVoz, alDividir,
}: {
  video: ClipPista[];
  textos: RotuloPista[];
  voz: VozPista;
  total: number;
  t: number;
  sel: Sel;
  alSeleccionar: (s: Sel) => void;
  alSaltar: (t: number) => void;
  alCambiarVideo: (v: ClipPista[]) => void;
  alCambiarTextos: (r: RotuloPista[]) => void;
  alCambiarVoz: (v: Partial<VozPista>) => void;
  alDividir: () => void;
}) {
  const [pps, setPps] = useState(36);
  const caja = useRef<HTMLDivElement>(null);
  const arrastre = useRef<null | {
    tipo: "moverTexto" | "moverVoz" | "estirarTexto" | "estirarClip" | "cabezal";
    id?: string;
    x0: number;
    v0: number;
  }>(null);

  // Ctrl + rueda: zoom centrado en el cursor
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setPps((p) => Math.min(240, Math.max(8, p * (e.deltaY < 0 ? 1.15 : 0.87))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** Bordes de clip: puntos a los que se pegan los bloques al soltarlos cerca. */
  const imanes = video.map((_, i) => inicioDe(video, i)).concat(total);
  const pegar = (x: number) => {
    const cerca = imanes.find((m) => Math.abs(m - x) < IMAN);
    return cerca ?? x;
  };

  const xDeEvento = (e: React.PointerEvent | PointerEvent) => {
    const r = caja.current!.getBoundingClientRect();
    return (e.clientX - r.left + caja.current!.scrollLeft) / pps;
  };

  const empezar = (e: React.PointerEvent, a: NonNullable<typeof arrastre.current>) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    arrastre.current = { ...a, x0: e.clientX };
  };

  const mover = (e: React.PointerEvent) => {
    const a = arrastre.current;
    if (!a) return;
    const dx = (e.clientX - a.x0) / pps;
    if (a.tipo === "cabezal") alSaltar(Math.max(0, Math.min(total, xDeEvento(e))));
    else if (a.tipo === "moverTexto") {
      alCambiarTextos(textos.map((r) => (r.id === a.id ? { ...r, inicio: Math.max(0, red(a.v0 + dx)) } : r)));
    } else if (a.tipo === "estirarTexto") {
      alCambiarTextos(textos.map((r) => (r.id === a.id ? { ...r, duracion: Math.max(0.2, red(a.v0 + dx)) } : r)));
    } else if (a.tipo === "moverVoz") {
      alCambiarVoz({ inicio: Math.max(0, red(a.v0 + dx)) });
    } else if (a.tipo === "estirarClip") {
      alCambiarVideo(
        video.map((c) =>
          c.id === a.id
            ? { ...c, duracion: Math.max(0.5, Math.min(c.clip?.duracion ?? 180, red(a.v0 + dx))) }
            : c,
        ),
      );
    }
  };

  const soltar = () => {
    const a = arrastre.current;
    if (!a) return;
    // Al soltar, un bloque de texto o la voz se pega al borde de clip mas cercano.
    if (a.tipo === "moverTexto") alCambiarTextos(textos.map((r) => (r.id === a.id ? { ...r, inicio: Math.max(0, pegar(r.inicio)) } : r)));
    if (a.tipo === "moverVoz") alCambiarVoz({ inicio: Math.max(0, pegar(voz.inicio)) });
    arrastre.current = null;
  };

  const ancho = Math.max(total, 10) * pps + 80;
  const paso = pps >= 120 ? 0.5 : pps >= 60 ? 1 : pps >= 24 ? 2 : pps >= 12 ? 5 : 10;
  const marcas: number[] = [];
  for (let s = 0; s <= Math.max(total, 10) + paso; s += paso) marcas.push(red(s));

  return (
    <section className="tarjeta">
      <div className="fila" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Linea de tiempo</h2>
        <button onClick={alDividir} disabled={!video.some((c, i) => t > inicioDe(video, i) + 0.3 && t < inicioDe(video, i) + c.duracion - 0.3)}>
          Dividir clip en {t.toFixed(1)}s
        </button>
        <label className="suave" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Zoom
          <input type="range" min={8} max={240} step={1} value={pps} onChange={(e) => setPps(Number(e.target.value))} style={{ width: 140 }} />
        </label>
        <span className="suave">Ctrl+rueda para ampliar · arrastra bloques y bordes · espacio reproduce · Supr borra</span>
      </div>

      <div ref={caja} className="tiempo" style={{ overflowX: "auto", userSelect: "none" }}
        onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}>
        <div style={{ position: "relative", width: ancho, minWidth: "100%" }}>
          <div className="regla" onPointerDown={(e) => { alSaltar(Math.max(0, Math.min(total, xDeEvento(e)))); empezar(e, { tipo: "cabezal", x0: 0, v0: 0 }); }}>
            {marcas.map((s) => (
              <span key={s} className={`marca ${Number.isInteger(s) ? "" : "menor"}`} style={{ left: s * pps }}>
                {Number.isInteger(s) ? `${s}s` : ""}
              </span>
            ))}
          </div>

          <div className="pista" onPointerDown={(e) => { if (e.target === e.currentTarget) alSaltar(xDeEvento(e)); }}>
            <span className="nombrePista">Video</span>
            {video.map((c, i) => {
              const ini = inicioDe(video, i);
              const tope = c.clip?.duracion;
              return (
                <div key={c.id} className={`bloque ${sel.id === c.id ? "sel" : ""}`}
                  style={{ position: "absolute", left: ini * pps, width: Math.max(c.duracion * pps - 2, 18), top: 4 }}
                  onPointerDown={(e) => { e.stopPropagation(); alSeleccionar({ tipo: "clip", id: c.id }); alSaltar(ini); }}
                  title={tope ? `Origen: ${tope.toFixed(0)} s` : undefined}>
                  {c.clip?.imagen ? <img className="mini" src={urlMuestra(c.clip.imagen)} alt="" loading="lazy" draggable={false} /> : <div className="mini" style={{ background: c.color }} />}
                  <span>
                    {i + 1} · {c.duracion.toFixed(1)}s{tope && c.duracion >= tope - 0.05 ? " (tope)" : ""}
                    {c.encuadre === "ajustar" ? " · ajustada" : ""}
                  </span>
                  {(c.transicion ?? "ninguna") !== "ninguna" && i < video.length - 1 && (
                    <div className="cruce" title={`Transicion ${c.transicion} de ${(c.transicionSeg ?? 0.5).toFixed(1)} s`}>
                      ⟩
                    </div>
                  )}
                  <div className="asa" onPointerDown={(e) => empezar(e, { tipo: "estirarClip", id: c.id, x0: 0, v0: c.duracion })} />
                </div>
              );
            })}
          </div>

          <div className="pista pistaTextos" onPointerDown={(e) => { if (e.target === e.currentTarget) alSaltar(xDeEvento(e)); }}>
            <span className="nombrePista">Textos</span>
            {textos.map((r) => (
              <div key={r.id} className={`bloque texto ${sel.id === r.id ? "sel" : ""}`}
                style={{ position: "absolute", left: r.inicio * pps, width: Math.max(r.duracion * pps - 2, 18), top: 4, cursor: "grab" }}
                onPointerDown={(e) => { alSeleccionar({ tipo: "texto", id: r.id }); empezar(e, { tipo: "moverTexto", id: r.id, x0: 0, v0: r.inicio }); }}>
                <span>{r.texto.slice(0, 40) || "(vacio)"}</span>
                <div className="asa" onPointerDown={(e) => empezar(e, { tipo: "estirarTexto", id: r.id, x0: 0, v0: r.duracion })} />
              </div>
            ))}
          </div>

          <div className="pista pistaVoz" onPointerDown={(e) => { if (e.target === e.currentTarget) alSaltar(xDeEvento(e)); }}>
            <span className="nombrePista">Voz</span>
            {voz.modo !== "ninguna" && (
              <div className={`bloque voz ${sel.tipo === "voz" ? "sel" : ""}`}
                style={{ position: "absolute", left: voz.inicio * pps, width: Math.max((voz.duracion ?? 2) * pps - 2, 18), top: 4, cursor: "grab" }}
                onPointerDown={(e) => { alSeleccionar({ tipo: "voz" }); empezar(e, { tipo: "moverVoz", x0: 0, v0: voz.inicio }); }}>
                {voz.tramos.map((tr, i) => (
                  <span key={i} className="tramo" style={{ left: tr.inicio * pps, width: Math.max(tr.duracion * pps - 1, 2) }} title={tr.texto} />
                ))}
                <span style={{ position: "relative" }}>{voz.duracion ? `${voz.modo === "archivo" ? "archivo" : "narracion"} · ${voz.duracion.toFixed(1)}s` : "sin generar"}</span>
              </div>
            )}
          </div>

          <div className="cabezal" style={{ left: t * pps }} onPointerDown={(e) => empezar(e, { tipo: "cabezal", x0: 0, v0: 0 })}>
            <div className="cabezalAsa" />
          </div>
        </div>
      </div>
    </section>
  );
}
