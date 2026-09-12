import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type Animacion,
  type Catalogo,
  type ClipCandidato,
  type ClipPista,
  type Efecto,
  type EstiloTexto,
  type Fuente,
  type Lectura,
  type MusicaCapa,
  type Preset,
  type Proyecto,
  type RotuloPista,
  type VozPista,
} from "../api";
import { mensajeDe } from "../App";
import { SelectorVoz } from "./comunes";
import { Lienzo } from "./Lienzo";
import { BuscadorClips } from "./BuscadorClips";
import { LineaDeTiempo, type Sel } from "./LineaDeTiempo";

const ANIMACIONES: [Animacion, string][] = [
  ["ninguna", "ninguna"], ["fundido", "fundido"], ["subir", "subir"], ["zoom", "zoom"],
  ["resaltar", "resaltar palabra a palabra"],
];
const EFECTOS: [Efecto, string][] = [
  ["ninguno", "ninguno"], ["zoomLento", "zoom lento"], ["fundido", "fundido a negro"],
  ["blancoYNegro", "blanco y negro"], ["vineta", "vineta"],
];
const LECTURAS: [Lectura, string][] = [
  ["todo", "todo el texto a la vez"], ["frases", "frase a frase"], ["bloques", "por bloques de 8 palabras"],
];
const POSICIONES = ["arriba", "centro", "abajo"] as const;
/** Escala de la linea de tiempo. */
const PPS = 36;

const ESTILO: EstiloTexto = {
  fuente: "DejaVu Serif", tamano: 66, color: "#FFFFFF", contorno: "#000000", posicion: "abajo", negrita: false,
};
const clipNuevo = (): ClipPista => ({
  id: crypto.randomUUID(), clip: null, color: "#111318", duracion: 4, recorte: 0, efecto: "ninguno",
});
const rotuloNuevo = (inicio: number): RotuloPista => ({
  id: crypto.randomUUID(), inicio, duracion: 4, texto: "", estilo: ESTILO, animacion: "fundido", lectura: "frases",
});

const inicioDe = (video: ClipPista[], i: number) => video.slice(0, i).reduce((s, c) => s + c.duracion, 0);
const durVideo = (video: ClipPista[]) => video.reduce((s, c) => s + c.duracion, 0);
const finVoz = (voz: VozPista) => (voz.modo === "ninguna" || !voz.duracion ? 0 : voz.inicio + voz.duracion);
const finTextos = (textos: RotuloPista[]) => textos.reduce((m, r) => Math.max(m, r.inicio + r.duracion), 0);
const red = (n: number) => Math.round(n * 10) / 10;


export function EditorMontaje({
  id, catalogo, alSalir,
}: { id: string; catalogo: Catalogo; alSalir: () => void }) {
  const [proyecto, setProyecto] = useState<Proyecto | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [musicaDisponible, setMusicaDisponible] = useState<string[]>([]);
  const [fuentes, setFuentes] = useState<Fuente[]>([]);
  const [sel, setSel] = useState<Sel>({ tipo: "clip" });
  const [panel, setPanel] = useState<"clip" | "texto" | "voz" | "musica" | "formato">("clip");
  const [t, setT] = useState(0);
  const [seek, setSeek] = useState({ t: 0, n: 0 });
  const [buscando, setBuscando] = useState(false);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [global, setGlobal] = useState<(EstiloTexto & { animacion: Animacion; lectura: Lectura }) | null>(null);
  const [reproducir, setReproducir] = useState({ n: 0 });

  const cargar = useCallback(async () => {
    try {
      const [p, lista] = await Promise.all([api.get<Proyecto>(`/api/proyectos/${id}`), api.get<Preset[]>("/api/presets")]);
      setProyecto(p);
      setPresets(lista);
      setMusicaDisponible(p.musicaDisponible ?? []);
      setFuentes(p.fuentes ?? []);
      if (p.video[0]) setSel({ tipo: "clip", id: p.video[0].id });
    } catch (err) {
      setError(mensajeDe(err));
    }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    if (proyecto?.estado !== "RENDER") return;
    const i = setInterval(cargar, 8000);
    return () => clearInterval(i);
  }, [proyecto?.estado, cargar]);

  useEffect(() => {
    if (!fuentes.length) return;
    const hoja = document.createElement("style");
    hoja.textContent = fuentes
      .map((f) => `@font-face{font-family:"${f.nombre}";src:url(/api/fuentes/${f.id}) format("truetype");font-display:swap}`)
      .join("\n");
    document.head.appendChild(hoja);
    return () => hoja.remove();
  }, [fuentes]);

  const alTiempo = useCallback((x: number) => setT(x), []);

  // Espacio reproduce/pausa, Supr borra lo seleccionado, S divide el clip.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") { e.preventDefault(); setReproducir((r) => ({ n: r.n + 1 })); }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); borrarSeleccion(); }
      if (e.key.toLowerCase() === "s") dividirClip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const ir = (x: number) => setSeek((s) => ({ t: Math.max(0, x), n: s.n + 1 }));

  if (!proyecto) return <p className="suave">{error || "Cargando proyecto..."}</p>;

  const preset = presets.find((p) => p.id === proyecto.formato) ?? presets[0];
  const { video, textos, voz } = proyecto;
  const musica: MusicaCapa = proyecto.musica ?? { archivo: null, subida: false, volumen: 0.25 };
  const total = Math.max(durVideo(video), finVoz(voz), finTextos(textos), 0.5);
  const clipSel = video.find((c) => c.id === sel.id) ?? null;
  const iClip = clipSel ? video.indexOf(clipSel) : -1;
  const textoSel = textos.find((r) => r.id === sel.id) ?? null;
  const urlVoz = voz.modo !== "ninguna" && voz.archivo ? `/api/proyectos/${proyecto.id}/voz?h=${voz.huella ?? ""}` : null;

  const act = (c: Partial<Proyecto>) => setProyecto({ ...proyecto, ...c });
  const actClip = (c: Partial<ClipPista>) =>
    clipSel && act({ video: video.map((x) => (x.id === clipSel.id ? { ...x, ...c } : x)) });
  const actTexto = (c: Partial<RotuloPista>) =>
    textoSel && act({ textos: textos.map((x) => (x.id === textoSel.id ? { ...x, ...c } : x)) });
  const actVoz = (c: Partial<VozPista>) => act({ voz: { ...voz, ...c } });

  /** Texto que cae encima de un clip, para buscarle un clip parecido. */
  const textoSobre = (i: number) => {
    const a = inicioDe(video, i), b = a + video[i].duracion;
    return textos.filter((r) => r.inicio < b && r.inicio + r.duracion > a).map((r) => r.texto).join(" ");
  };

  async function guardar(silencioso = false) {
    setOcupado("guardar");
    setError("");
    try {
      await api.put(`/api/proyectos/${proyecto!.id}`, { nombre: proyecto!.nombre, formato: proyecto!.formato, video, textos, voz, musica });
      if (!silencioso) setOk("Proyecto guardado.");
      return true;
    } catch (err) { setError(mensajeDe(err)); return false; } finally { setOcupado(""); }
  }
  async function renderizar() {
    if (!(await guardar(true))) return;
    try { await api.post(`/api/proyectos/${proyecto!.id}/render`); setOk("Render encolado. Esta pagina se actualiza sola."); await cargar(); }
    catch (err) { setError(mensajeDe(err)); }
  }
  async function generarVozAhora() {
    setOcupado("voz");
    setError("");
    try {
      const nueva = await api.post<VozPista>(`/api/proyectos/${proyecto!.id}/voz`, { voz });
      actVoz(nueva);
      setOk(`Narracion generada: ${nueva.duracion?.toFixed(1)} s con una sola voz.`);
    } catch (err) { setError(mensajeDe(err)); } finally { setOcupado(""); }
  }
  async function subir(archivo: File, destino: "voz" | "musica") {
    setError("");
    try {
      const r = await api.subir<{ archivo: string; duracion: number | null }>(`/api/proyectos/${proyecto!.id}/subir`, archivo);
      if (destino === "voz") actVoz({ modo: "archivo", archivo: r.archivo, duracion: r.duracion, huella: null });
      else act({ musica: { ...musica, archivo: r.archivo, subida: true } });
      setOk("Archivo subido.");
    } catch (err) { setError(mensajeDe(err)); }
  }
  async function textosDesdeVoz(lectura: "frases" | "bloques") {
    setOcupado("textos");
    setError("");
    try {
      const nuevos = await api.post<RotuloPista[]>(`/api/proyectos/${proyecto!.id}/textos-desde-voz`, { voz, video, lectura });
      act({ textos: nuevos });
      setOk(`${nuevos.length} rotulos repartidos sobre ${voz.duracion ? "la narracion" : "los clips"}.`);
    } catch (err) { setError(mensajeDe(err)); } finally { setOcupado(""); }
  }
  function alinearTextosConClips() {
    act({ textos: textos.map((r, i) => (video[i] ? { ...r, inicio: inicioDe(video, i), duracion: video[i].duracion } : r)) });
    setOk("Cada rotulo colocado sobre el clip del mismo orden.");
  }
  function ajustarClipsAVoz() {
    const objetivo = finVoz(voz);
    const actual = durVideo(video);
    if (!objetivo || !actual) { setError("Genera primero la narracion."); return; }
    const k = objetivo / actual;
    act({ video: video.map((c) => ({ ...c, duracion: Math.max(0.5, red(c.duracion * k)) })) });
    setOk(`Clips escalados x${k.toFixed(2)} para durar lo que la voz (${objetivo.toFixed(1)} s).`);
  }
  async function completarClips(soloVacias: boolean, soloEste = false) {
    setOcupado("clips");
    setError("");
    try {
      const objetivo = (soloEste && clipSel ? [clipSel] : video).map((c) => ({ id: c.id, texto: textoSobre(video.indexOf(c)) || proyecto!.nombre, tieneClip: Boolean(c.clip) }));
      const r = await api.post<{ clips: Record<string, ClipCandidato | null> }>(`/api/proyectos/${proyecto!.id}/clips-automaticos`, { escenas: objetivo, soloVacias });
      const n = Object.values(r.clips).filter(Boolean).length;
      act({ video: video.map((c) => (r.clips[c.id] ? { ...c, clip: r.clips[c.id], recorte: 0, duracion: r.clips[c.id]!.duracion ? Math.min(r.clips[c.id]!.duracion!, c.duracion) : c.duracion } : c)) });
      setOk(n ? `${n} clip(s) encontrados.` : "No habia clips que rellenar.");
    } catch (err) { setError(mensajeDe(err)); } finally { setOcupado(""); }
  }
  async function clipAlAzar() {
    if (!clipSel) return;
    try {
      const consulta = (textoSobre(iClip) || proyecto!.nombre).split(" ").slice(0, 3).join(" ");
      const lista = await api.get<ClipCandidato[]>(`/api/clips?keywords=${encodeURIComponent(consulta)}`);
      const otros = lista.filter((c) => c.id !== clipSel.clip?.id);
      if (!otros.length) { setError("No hay mas clips para ese texto."); return; }
      const elegido = otros[Math.floor(Math.random() * otros.length)];
      actClip({ clip: elegido, recorte: 0, duracion: elegido.duracion ? Math.min(elegido.duracion, clipSel.duracion) : clipSel.duracion });
    } catch (err) { setError(mensajeDe(err)); }
  }
  function borrarSeleccion() {
    if (sel.tipo === "clip" && clipSel && video.length > 1) { act({ video: video.filter((c) => c.id !== clipSel.id) }); setSel({ tipo: "clip", id: video[Math.max(0, iClip - 1)]?.id }); }
    if (sel.tipo === "texto" && textoSel) { act({ textos: textos.filter((r) => r.id !== textoSel.id) }); setSel({ tipo: "texto" }); }
  }
  /** Parte el clip que esta bajo el cabezal en dos, sin perder ni un fotograma. */
  function dividirClip() {
    for (const [i, c] of video.entries()) {
      const ini = inicioDe(video, i);
      if (t > ini + 0.3 && t < ini + c.duracion - 0.3) {
        const corte = red(t - ini);
        const a = { ...c, duracion: corte };
        const b = { ...c, id: crypto.randomUUID(), duracion: red(c.duracion - corte), recorte: red(c.recorte + corte), efecto: "ninguno" as Efecto };
        const copia = [...video];
        copia.splice(i, 1, a, b);
        act({ video: copia });
        setSel({ tipo: "clip", id: b.id });
        return;
      }
    }
  }
  async function escribirNarracion(estilo: "plano" | "expresivo" | "guion") {
    setOcupado("narracion");
    setError("");
    try {
      const { narracion } = await api.post<{ narracion: string }>(`/api/proyectos/${proyecto!.id}/narracion`, { estilo, texto: estilo === "guion" ? undefined : voz.texto || undefined });
      actVoz({ texto: narracion, archivo: null, duracion: null, huella: null, tramos: [] });
      setOk(estilo === "guion" ? "Guion cargado como narracion." : `Narracion ${estilo} redactada. Genera la voz para medirla.`);
    } catch (err) { setError(mensajeDe(err)); } finally { setOcupado(""); }
  }
  async function ensamblar() {
    if (!(await guardar(true))) return;
    setOcupado("ensamblar");
    setError("");
    try {
      await api.post(`/api/proyectos/${proyecto!.id}/ensamblar`, { preferirLargos: true, ganchoSeg: 4 });
      await cargar();
      setOk("Ensamblado: la voz manda, los textos caen donde suenan y el video se rellena con clips largos.");
    } catch (err) { setError(mensajeDe(err)); } finally { setOcupado(""); }
  }
  function moverClip(desde: number, hacia: number) {
    if (hacia < 0 || hacia >= video.length) return;
    const copia = [...video];
    const [x] = copia.splice(desde, 1);
    copia.splice(hacia, 0, x);
    act({ video: copia });
  }
  function aplicarGlobal(g: NonNullable<typeof global>) {
    const { animacion, lectura, ...estilo } = g;
    act({ textos: textos.map((r) => ({ ...r, estilo: { ...estilo, posicion: r.estilo.posicion }, animacion, lectura })) });
    setOk("Estilo aplicado a todos los rotulos.");
  }

  const ancho = Math.max(total, 10) * PPS + 60;

  return (
    <>
      <div className="fila" style={{ marginBottom: 12 }}>
        <button onClick={alSalir}>Volver</button>
        <input style={{ maxWidth: 300 }} value={proyecto.nombre} onChange={(e) => act({ nombre: e.target.value })} />
        <button onClick={() => guardar()} disabled={ocupado === "guardar"}>Guardar</button>
        <button className="primario" onClick={renderizar} disabled={proyecto.estado === "RENDER"}>
          {proyecto.estado === "RENDER" ? "Renderizando..." : "Renderizar MP4"}
        </button>
        <button onClick={ensamblar} disabled={ocupado === "ensamblar" || !voz.texto.trim()} title="La voz manda: genera la narracion, coloca los textos donde suenan y rellena el video con clips largos al azar">
          {ocupado === "ensamblar" ? "Ensamblando..." : "Ensamblar con la narracion"}
        </button>
        <button onClick={() => completarClips(true)} disabled={ocupado === "clips"}>
          {ocupado === "clips" ? "Buscando clips..." : "Completar clips vacios"}
        </button>
        {proyecto.estado === "LISTO" && proyecto.archivo && (
          <a className="boton" href={`/api/proyectos/${proyecto.id}/descargar`}>MP4 listo: descargar</a>
        )}
      </div>

      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}
      {proyecto.estado === "ERROR" && proyecto.error && <pre>{proyecto.error}</pre>}

      <div className="montaje">
        <div>
          {preset && (
            <Lienzo video={video} textos={textos} preset={preset} duracionTotal={total}
              urlVoz={urlVoz} vozInicio={voz.inicio} seek={seek} alTiempo={alTiempo} alternar={reproducir} />
          )}
          <p className="suave">
            Video {durVideo(video).toFixed(1)}s · voz {finVoz(voz) ? `hasta ${finVoz(voz).toFixed(1)}s` : "sin generar"} ·
            textos hasta {finTextos(textos).toFixed(1)}s
            {total > durVideo(video) + 0.05 ? " · el ultimo clip se congela para cubrir el resto" : ""}
          </p>
        </div>

        <div>
          <nav style={{ marginBottom: 8 }}>
            {(["clip", "texto", "voz", "musica", "formato"] as const).map((p) => (
              <button key={p} className={panel === p ? "activo" : ""} onClick={() => setPanel(p)}>
                {{ clip: "Clip", texto: "Texto", voz: "Voz", musica: "Musica", formato: "Formato" }[p]}
              </button>
            ))}
          </nav>

          {panel === "clip" && (
            <section className="tarjeta">
              {!clipSel ? <p className="suave">Pulsa un clip en la pista de video.</p> : (
                <>
                  <div className="campos">
                    <div>
                      <label htmlFor="dur">Duracion (s){clipSel.clip?.duracion ? ` · origen ${clipSel.clip.duracion.toFixed(0)} s` : ""}</label>
                      <input id="dur" type="number" min={0.5} max={clipSel.clip?.duracion ?? 180} step="0.5" value={clipSel.duracion}
                        onChange={(e) => actClip({ duracion: Math.min(clipSel.clip?.duracion ?? 180, Number(e.target.value) || 0.5) })} />
                    </div>
                    <div>
                      <label htmlFor="rec">Empieza en el segundo</label>
                      <input id="rec" type="number" min={0} max={3600} step="0.5" value={clipSel.recorte}
                        onChange={(e) => actClip({ recorte: Number(e.target.value) || 0 })} />
                    </div>
                    <div>
                      <label htmlFor="ef">Efecto de imagen</label>
                      <select id="ef" value={clipSel.efecto} onChange={(e) => actClip({ efecto: e.target.value as Efecto })}>
                        {EFECTOS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                      </select>
                    </div>
                    {!clipSel.clip && (
                      <div>
                        <label htmlFor="col">Color de fondo</label>
                        <input id="col" type="color" value={clipSel.color} onChange={(e) => actClip({ color: e.target.value })} />
                      </div>
                    )}
                  </div>
                  <div className="pie">
                    <button onClick={() => setBuscando(!buscando)}>{buscando ? "Cerrar" : clipSel.clip ? "Cambiar clip" : "Elegir clip"}</button>
                    <button onClick={() => completarClips(false, true)} disabled={ocupado === "clips"}>Buscar clip parecido</button>
                    <button onClick={clipAlAzar}>Otro al azar</button>
                    <button onClick={() => moverClip(iClip, iClip - 1)} disabled={iClip <= 0}>Mover antes</button>
                    <button onClick={() => moverClip(iClip, iClip + 1)} disabled={iClip >= video.length - 1}>Mover despues</button>
                    <button onClick={() => { const c = [...video]; c.splice(iClip + 1, 0, { ...clipSel, id: crypto.randomUUID() }); act({ video: c }); }}>Duplicar</button>
                    <button disabled={video.length <= 1} onClick={() => { act({ video: video.filter((c) => c.id !== clipSel.id) }); setSel({ tipo: "clip", id: video[Math.max(0, iClip - 1)]?.id }); }}>Quitar</button>
                  </div>
                  {clipSel.clip && <p className="suave">{clipSel.clip.autor} · {clipSel.clip.fuente}</p>}
                  {buscando && (
                    <BuscadorClips sugerencia={(textoSobre(iClip) || proyecto.nombre).split(" ").slice(0, 3).join(" ")}
                      alElegir={(clip) => { actClip({ clip, recorte: 0, duracion: clip?.duracion ? Math.min(clip.duracion, clipSel.duracion) : clipSel.duracion }); setBuscando(false); }} />
                  )}
                </>
              )}
            </section>
          )}

          {panel === "texto" && (
            <section className="tarjeta">
              <div className="pie" style={{ marginTop: 0, marginBottom: 12 }}>
                <button onClick={() => { const r = rotuloNuevo(red(t)); act({ textos: [...textos, r] }); setSel({ tipo: "texto", id: r.id }); }}>
                  Nuevo texto en {t.toFixed(1)}s
                </button>
                <button onClick={() => textosDesdeVoz("frases")} disabled={ocupado === "textos" || !voz.texto.trim()}>Textos desde la narracion</button>
                <button onClick={alinearTextosConClips} disabled={!textos.length}>Alinear con los clips</button>
              </div>
              {!textoSel ? <p className="suave">Pulsa un rotulo en la pista de textos, o crea uno.</p> : (
                <>
                  <label htmlFor="tx">Texto</label>
                  <textarea id="tx" value={textoSel.texto} onChange={(e) => actTexto({ texto: e.target.value })} />
                  <div className="campos" style={{ marginTop: 12 }}>
                    <div>
                      <label htmlFor="ini">Empieza en (s)</label>
                      <input id="ini" type="number" min={0} step="0.1" value={textoSel.inicio} onChange={(e) => actTexto({ inicio: Number(e.target.value) || 0 })} />
                    </div>
                    <div>
                      <label htmlFor="tdur">Duracion (s)</label>
                      <input id="tdur" type="number" min={0.2} step="0.1" value={textoSel.duracion} onChange={(e) => actTexto({ duracion: Number(e.target.value) || 0.2 })} />
                    </div>
                    <div>
                      <label htmlFor="lect">Como se va leyendo</label>
                      <select id="lect" value={textoSel.lectura} onChange={(e) => actTexto({ lectura: e.target.value as Lectura })}>
                        {LECTURAS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="anim">Animacion</label>
                      <select id="anim" value={textoSel.animacion} onChange={(e) => actTexto({ animacion: e.target.value as Animacion })}>
                        {ANIMACIONES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="fu">Tipo de letra</label>
                      <select id="fu" value={textoSel.estilo.fuente} onChange={(e) => actTexto({ estilo: { ...textoSel.estilo, fuente: e.target.value } })}>
                        {(fuentes.length ? fuentes : [{ id: "x", nombre: textoSel.estilo.fuente, estilo: "serif" as const }]).map((f) => (
                          <option key={f.id} value={f.nombre}>{f.nombre}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="pos">Posicion</label>
                      <select id="pos" value={textoSel.estilo.posicion} onChange={(e) => actTexto({ estilo: { ...textoSel.estilo, posicion: e.target.value as EstiloTexto["posicion"] } })}>
                        {POSICIONES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="tam">Tamano</label>
                      <input id="tam" type="number" min={20} max={200} value={textoSel.estilo.tamano} onChange={(e) => actTexto({ estilo: { ...textoSel.estilo, tamano: Number(e.target.value) || 66 } })} />
                    </div>
                    <div>
                      <label htmlFor="c1">Color</label>
                      <input id="c1" type="color" value={textoSel.estilo.color} onChange={(e) => actTexto({ estilo: { ...textoSel.estilo, color: e.target.value } })} />
                    </div>
                    <div>
                      <label htmlFor="c2">Contorno</label>
                      <input id="c2" type="color" value={textoSel.estilo.contorno} onChange={(e) => actTexto({ estilo: { ...textoSel.estilo, contorno: e.target.value } })} />
                    </div>
                  </div>
                  <div className="pie">
                    <label className="suave">
                      <input type="checkbox" style={{ width: "auto", marginRight: 6 }} checked={textoSel.estilo.negrita}
                        onChange={(e) => actTexto({ estilo: { ...textoSel.estilo, negrita: e.target.checked } })} /> Negrita
                    </label>
                    <button onClick={() => actTexto({ inicio: Math.max(0, red(textoSel.inicio - 0.5)) })}>-0,5 s</button>
                    <button onClick={() => actTexto({ inicio: red(textoSel.inicio + 0.5) })}>+0,5 s</button>
                    <button onClick={() => { const r = { ...textoSel, id: crypto.randomUUID(), inicio: red(textoSel.inicio + textoSel.duracion) }; act({ textos: [...textos, r] }); setSel({ tipo: "texto", id: r.id }); }}>Duplicar a continuacion</button>
                    <button onClick={() => { act({ textos: textos.filter((r) => r.id !== textoSel.id) }); setSel({ tipo: "texto" }); }}>Quitar</button>
                  </div>
                </>
              )}
            </section>
          )}

          {panel === "voz" && (
            <section className="tarjeta">
              <div>
                <label htmlFor="modoVoz">Narracion</label>
                <select id="modoVoz" value={voz.modo} onChange={(e) => actVoz({ modo: e.target.value as VozPista["modo"] })}>
                  <option value="ninguna">Sin voz</option>
                  <option value="servidor">Leida por el servidor, una sola voz</option>
                  <option value="archivo">Un archivo que subo</option>
                </select>
              </div>
              {voz.modo === "servidor" && (
                <>
                  <div className="pie" style={{ marginTop: 12, marginBottom: 4 }}>
                    <button onClick={() => escribirNarracion("plano")} disabled={ocupado === "narracion"}>Redactar narracion (texto plano)</button>
                    <button onClick={() => escribirNarracion("expresivo")} disabled={ocupado === "narracion"}>Redactar expresiva (marcas para Gemini)</button>
                    {proyecto.historiaId && <button onClick={() => escribirNarracion("guion")} disabled={ocupado === "narracion"}>Cargar el guion tal cual</button>}
                  </div>
                  <label htmlFor="narr">Texto de la narracion (todo seguido, una sola voz)</label>
                  <textarea id="narr" style={{ minHeight: 160 }} value={voz.texto} onChange={(e) => actVoz({ texto: e.target.value })} />
                  <div className="campos" style={{ marginTop: 12 }}>
                    <SelectorVoz catalogo={catalogo} valor={voz.config ?? catalogo.vozPorDefecto} alCambiar={(config) => actVoz({ config })} />
                    <div>
                      <label htmlFor="vini">Empieza en (s)</label>
                      <input id="vini" type="number" min={0} step="0.1" value={voz.inicio} onChange={(e) => actVoz({ inicio: Number(e.target.value) || 0 })} />
                    </div>
                  </div>
                  <div className="pie">
                    <button className="primario" onClick={generarVozAhora} disabled={ocupado === "voz" || !voz.texto.trim()}>
                      {ocupado === "voz" ? "Generando..." : voz.archivo ? "Volver a generar la voz" : "Generar la voz ahora"}
                    </button>
                    <button onClick={ajustarClipsAVoz} disabled={!voz.duracion}>Ajustar clips a la voz</button>
                    <span className="suave">{voz.duracion ? `${voz.duracion.toFixed(1)} s generados` : "sin generar: se genera al renderizar"}</span>
                  </div>
                  <p className="suave">
                    Se genera frase a frase y se mide cada una: los textos pueden caer exactamente donde se leen.
                    Las marcas entre corchetes ([pausa], [susurrando]) solo las interpreta Gemini; las voces locales las ignoran.
                    {voz.tramos.length ? ` ${voz.tramos.length} frases medidas.` : ""}
                  </p>
                </>
              )}
              {voz.modo === "archivo" && (
                <div style={{ marginTop: 12 }}>
                  <label htmlFor="subirVoz">Archivo de voz (mp3, m4a, wav, ogg; 40 MB)</label>
                  <input id="subirVoz" type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && subir(e.target.files[0], "voz")} />
                  {voz.archivo && <p className="suave">Subido: {voz.archivo}{voz.duracion ? ` · ${voz.duracion.toFixed(1)} s` : ""}</p>}
                  <div className="campos" style={{ marginTop: 12 }}>
                    <div>
                      <label htmlFor="vini2">Empieza en (s)</label>
                      <input id="vini2" type="number" min={0} step="0.1" value={voz.inicio} onChange={(e) => actVoz({ inicio: Number(e.target.value) || 0 })} />
                    </div>
                  </div>
                  <div className="pie"><button onClick={ajustarClipsAVoz} disabled={!voz.duracion}>Ajustar clips a la voz</button></div>
                </div>
              )}
            </section>
          )}

          {panel === "musica" && (
            <section className="tarjeta">
              <div className="campos">
                <div>
                  <label htmlFor="pista">Pista de la biblioteca</label>
                  <select id="pista" value={musica.subida ? "" : (musica.archivo ?? "")} onChange={(e) => act({ musica: { ...musica, archivo: e.target.value || null, subida: false } })}>
                    <option value="">Sin musica</option>
                    {musicaDisponible.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="vol">Volumen ({Math.round(musica.volumen * 100)}%)</label>
                  <input id="vol" type="range" min={0} max={1} step={0.05} value={musica.volumen} onChange={(e) => act({ musica: { ...musica, volumen: Number(e.target.value) } })} />
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label htmlFor="subirMus">O sube tu propia pista</label>
                <input id="subirMus" type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && subir(e.target.files[0], "musica")} />
                {musica.subida && musica.archivo && <p className="suave">Subida: {musica.archivo}</p>}
              </div>
              <p className="suave">Con voz, la musica se agacha sola cuando alguien habla. La vista previa no la reproduce.</p>
            </section>
          )}

          {panel === "formato" && (
            <section className="tarjeta">
              <div>
                <label htmlFor="formato">Formato de salida</label>
                <select id="formato" value={proyecto.formato} onChange={(e) => act({ formato: e.target.value })}>
                  {presets.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.ancho}x{p.alto}</option>)}
                </select>
              </div>
              {preset && (
                <>
                  <p className="suave" style={{ marginTop: 8 }}>{preset.nota}</p>
                  <p className={total > preset.maxSegundos ? "aviso error" : "suave"}>Duracion total: {total.toFixed(1)} s (recomendado hasta {preset.maxSegundos} s)</p>
                </>
              )}
              <h3 style={{ marginTop: 20 }}>Estilo para todos los rotulos</h3>
              {(() => {
                const g = global ?? { ...(textoSel?.estilo ?? textos[0]?.estilo ?? ESTILO), animacion: textoSel?.animacion ?? "fundido", lectura: textoSel?.lectura ?? "frases" };
                const set = (c: Partial<typeof g>) => setGlobal({ ...g, ...c });
                return (
                  <>
                    <div className="campos">
                      <div><label htmlFor="gF">Tipo de letra</label>
                        <select id="gF" value={g.fuente} onChange={(e) => set({ fuente: e.target.value })}>
                          {(fuentes.length ? fuentes : [{ id: "x", nombre: g.fuente, estilo: "serif" as const }]).map((f) => <option key={f.id} value={f.nombre}>{f.nombre}</option>)}
                        </select></div>
                      <div><label htmlFor="gT">Tamano</label><input id="gT" type="number" min={20} max={200} value={g.tamano} onChange={(e) => set({ tamano: Number(e.target.value) || 66 })} /></div>
                      <div><label htmlFor="gC">Color de letra</label><input id="gC" type="color" value={g.color} onChange={(e) => set({ color: e.target.value })} /></div>
                      <div><label htmlFor="gK">Contorno</label><input id="gK" type="color" value={g.contorno} onChange={(e) => set({ contorno: e.target.value })} /></div>
                      <div><label htmlFor="gA">Animacion</label>
                        <select id="gA" value={g.animacion} onChange={(e) => set({ animacion: e.target.value as Animacion })}>{ANIMACIONES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></div>
                      <div><label htmlFor="gL">Como se va leyendo</label>
                        <select id="gL" value={g.lectura} onChange={(e) => set({ lectura: e.target.value as Lectura })}>{LECTURAS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></div>
                    </div>
                    <div className="pie">
                      <label className="suave"><input type="checkbox" style={{ width: "auto", marginRight: 6 }} checked={g.negrita} onChange={(e) => set({ negrita: e.target.checked })} /> Negrita</label>
                      <button className="primario" onClick={() => { setGlobal(g); aplicarGlobal(g); }}>Aplicar a todos los rotulos</button>
                    </div>
                  </>
                );
              })()}
            </section>
          )}
        </div>
      </div>

      <LineaDeTiempo video={video} textos={textos} voz={voz} total={total} t={t} sel={sel}
        alSeleccionar={(x) => { setSel(x); setPanel(x.tipo === "clip" ? "clip" : x.tipo === "texto" ? "texto" : "voz"); }}
        alSaltar={ir}
        alCambiarVideo={(v) => act({ video: v })}
        alCambiarTextos={(r) => act({ textos: r })}
        alCambiarVoz={actVoz}
        alDividir={dividirClip} />
    </>
  );
}
