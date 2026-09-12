import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Animacion,
  type Catalogo,
  type ClipCandidato,
  type Efecto,
  type EscenaMontaje,
  type EstiloTexto,
  type Fuente,
  type MusicaCapa,
  type Preset,
  type Proyecto,
  type VozCapa,
} from "../api";
import { mensajeDe } from "../App";
import { SelectorVoz } from "./comunes";
import { Lienzo } from "./Lienzo";
import { BuscadorClips } from "./BuscadorClips";

const ANIMACIONES: [Animacion, string][] = [
  ["ninguna", "ninguna"],
  ["fundido", "fundido"],
  ["subir", "subir"],
  ["zoom", "zoom"],
  ["resaltar", "resaltar palabra a palabra"],
];
const EFECTOS: [Efecto, string][] = [
  ["ninguno", "ninguno"],
  ["zoomLento", "zoom lento"],
  ["fundido", "fundido a negro"],
  ["blancoYNegro", "blanco y negro"],
  ["vineta", "vineta"],
];
const LECTURAS: [EscenaMontaje["lectura"], string][] = [
  ["todo", "todo el texto a la vez"],
  ["frases", "frase a frase"],
  ["bloques", "por bloques de 8 palabras"],
];
const POSICIONES = ["arriba", "centro", "abajo"] as const;

const nuevaEscena = (): EscenaMontaje => ({
  id: crypto.randomUUID(),
  clip: null,
  color: "#111318",
  duracion: 4,
  texto: "",
  estilo: {
    fuente: "DejaVu Serif",
    tamano: 66,
    color: "#FFFFFF",
    contorno: "#000000",
    posicion: "abajo",
    negrita: false,
  },
  animacion: "fundido",
  lectura: "frases",
  efecto: "ninguno",
  esGancho: false,
});

export function EditorMontaje({
  id,
  catalogo,
  alSalir,
}: {
  id: string;
  catalogo: Catalogo;
  alSalir: () => void;
}) {
  const [proyecto, setProyecto] = useState<Proyecto | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [musicaDisponible, setMusicaDisponible] = useState<string[]>([]);
  const [fuentes, setFuentes] = useState<Fuente[]>([]);
  const [indice, setIndice] = useState(0);
  const [panel, setPanel] = useState<"escena" | "capas" | "salida">("escena");
  const [buscando, setBuscando] = useState(false);
  const [completando, setCompletando] = useState(false);
  /** Estilo global del panel Formato: se aplica a todas y a las escenas nuevas. */
  const [global, setGlobal] = useState<EstiloTexto & { animacion: Animacion; lectura: EscenaMontaje["lectura"]; efecto: Efecto } | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [p, lista] = await Promise.all([
        api.get<Proyecto>(`/api/proyectos/${id}`),
        api.get<Preset[]>("/api/presets"),
      ]);
      setProyecto(p);
      setPresets(lista);
      setMusicaDisponible(p.musicaDisponible ?? []);
      setFuentes(p.fuentes ?? []);
    } catch (err) {
      setError(mensajeDe(err));
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Las fuentes del servidor se cargan en el navegador para que la vista previa
  // use la misma letra que quemara ffmpeg.
  useEffect(() => {
    if (!fuentes.length) return;
    const hoja = document.createElement("style");
    hoja.textContent = fuentes
      .map((f) => `@font-face{font-family:"${f.nombre}";src:url(/api/fuentes/${f.id}) format("truetype");font-display:swap}`)
      .join("\n");
    document.head.appendChild(hoja);
    return () => hoja.remove();
  }, [fuentes]);

  // Mientras renderiza, refrescar para ver cuando termina.
  useEffect(() => {
    if (proyecto?.estado !== "RENDER") return;
    const t = setInterval(cargar, 8000);
    return () => clearInterval(t);
  }, [proyecto?.estado, cargar]);

  if (!proyecto) return <p className="suave">{error || "Cargando proyecto..."}</p>;

  const preset = presets.find((p) => p.id === proyecto.formato) ?? presets[0];
  const escenas = proyecto.escenas;
  const escena = escenas[indice];
  const total = escenas.reduce((s, e) => s + e.duracion, 0);
  const voz: VozCapa = proyecto.voz ?? { modo: "ninguna", archivo: null, config: null };
  const musica: MusicaCapa = proyecto.musica ?? { archivo: null, subida: false, volumen: 0.25 };

  const actualizar = (cambios: Partial<Proyecto>) =>
    setProyecto({ ...proyecto, ...cambios } as Proyecto);

  const cambiarEscena = (cambios: Partial<EscenaMontaje>) =>
    actualizar({
      escenas: escenas.map((e, i) => (i === indice ? { ...e, ...cambios } : e)),
    });

  /** Copia tipografia, tamano, colores y animacion de esta escena al resto. */
  function aplicarEstiloATodas() {
    if (!escena) return;
    actualizar({
      escenas: escenas.map((e) => ({
        ...e,
        estilo: { ...escena.estilo, posicion: e.estilo.posicion },
        animacion: escena.animacion,
      })),
    });
    setOk("Estilo aplicado a todas las escenas.");
  }

  /**
   * Clips automaticos: saca palabras clave visuales de cada texto (LLM si hay,
   * heuristica si no) y elige un clip parecido. Por defecto solo las vacias.
   */
  async function completarClips(soloVacias: boolean, soloEsta = false) {
    setCompletando(true);
    setError("");
    try {
      const objetivo = soloEsta && escena ? [escena] : escenas;
      const r = await api.post<{ clips: Record<string, ClipCandidato | null> }>(
        `/api/proyectos/${proyecto!.id}/clips-automaticos`,
        {
          escenas: objetivo.map((e) => ({ id: e.id, texto: e.texto, tieneClip: Boolean(e.clip) })),
          soloVacias,
        },
      );
      const cuantos = Object.values(r.clips).filter(Boolean).length;
      actualizar({
        escenas: escenas.map((e) => (r.clips[e.id] ? { ...e, clip: r.clips[e.id] } : e)),
      });
      setOk(cuantos ? `${cuantos} clip(s) encontrados.` : "No habia escenas que rellenar.");
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setCompletando(false);
    }
  }

  function aplicarGlobal(valor = global) {
    if (!valor) return;
    const { animacion, lectura, efecto, ...estilo } = valor;
    actualizar({
      escenas: escenas.map((e) => ({
        ...e,
        estilo: { ...estilo, posicion: e.estilo.posicion },
        animacion,
        lectura,
        efecto,
      })),
    });
    setOk("Estilo global aplicado a todas las escenas.");
  }

  /** Otro clip al azar para la escena, buscando con su propio texto. */
  async function clipAlAzar() {
    if (!escena) return;
    setError("");
    const consulta = (escena.texto || proyecto!.nombre).split(" ").slice(0, 3).join(" ");
    try {
      const lista = await api.get<ClipCandidato[]>(
        `/api/clips?keywords=${encodeURIComponent(consulta)}`,
      );
      const otros = lista.filter((c) => c.id !== escena.clip?.id);
      if (!otros.length) {
        setError("No hay mas clips para ese texto; prueba a buscar con otras palabras.");
        return;
      }
      cambiarEscena({ clip: otros[Math.floor(Math.random() * otros.length)] });
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  function moverEscena(desde: number, hacia: number) {
    if (hacia < 0 || hacia >= escenas.length) return;
    const copia = [...escenas];
    const [fuera] = copia.splice(desde, 1);
    copia.splice(hacia, 0, fuera);
    actualizar({ escenas: copia });
    setIndice(hacia);
  }

  async function guardar(silencioso = false) {
    setGuardando(true);
    setError("");
    if (!silencioso) setOk("");
    try {
      await api.put(`/api/proyectos/${proyecto!.id}`, {
        nombre: proyecto!.nombre,
        formato: proyecto!.formato,
        escenas,
        voz,
        musica,
      });
      if (!silencioso) setOk("Proyecto guardado.");
      return true;
    } catch (err) {
      setError(mensajeDe(err));
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function renderizar() {
    if (!(await guardar(true))) return;
    try {
      await api.post(`/api/proyectos/${proyecto!.id}/render`);
      setOk("Render encolado. Esta pagina se actualiza sola.");
      await cargar();
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  async function subir(archivo: File, destino: "voz" | "musica") {
    setError("");
    try {
      const { archivo: nombre } = await api.subir<{ archivo: string }>(
        `/api/proyectos/${proyecto!.id}/subir`,
        archivo,
      );
      if (destino === "voz") actualizar({ voz: { ...voz, modo: "archivo", archivo: nombre } });
      else actualizar({ musica: { ...musica, archivo: nombre, subida: true } });
      setOk("Archivo subido.");
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  return (
    <>
      <div className="fila" style={{ marginBottom: 12 }}>
        <button onClick={alSalir}>Volver</button>
        <input
          style={{ maxWidth: 320 }}
          value={proyecto.nombre}
          onChange={(e) => actualizar({ nombre: e.target.value })}
        />
        <button onClick={() => guardar()} disabled={guardando}>
          {guardando ? "Guardando..." : "Guardar"}
        </button>
        <button className="primario" onClick={renderizar} disabled={proyecto.estado === "RENDER"}>
          {proyecto.estado === "RENDER" ? "Renderizando..." : "Renderizar MP4"}
        </button>
        <button onClick={() => completarClips(true)} disabled={completando}>
          {completando ? "Buscando clips..." : "Completar clips automaticos"}
        </button>
        {proyecto.estado === "LISTO" && proyecto.archivo && (
          <a className="boton" href={`/api/proyectos/${proyecto.id}/descargar`}>
            MP4 listo: descargar
          </a>
        )}
      </div>

      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}
      {proyecto.estado === "ERROR" && proyecto.error && (
        <pre>{proyecto.error}</pre>
      )}

      <div className="montaje">
        <div>
          {preset && (
            <Lienzo
              escenas={escenas}
              preset={preset}
              indice={Math.min(indice, escenas.length - 1)}
              alCambiarIndice={setIndice}
            />
          )}
        </div>

        <div>
          <nav style={{ marginBottom: 8 }}>
            {(["escena", "capas", "salida"] as const).map((p) => (
              <button key={p} className={panel === p ? "activo" : ""} onClick={() => setPanel(p)}>
                {p === "escena" ? "Escena" : p === "capas" ? "Voz y musica" : "Formato"}
              </button>
            ))}
          </nav>

          {panel === "escena" && escena && (
            <section className="tarjeta">
              <div>
                <label htmlFor="texto">Texto en pantalla</label>
                <textarea
                  id="texto"
                  value={escena.texto}
                  onChange={(e) => cambiarEscena({ texto: e.target.value })}
                />
              </div>

              <div className="campos" style={{ marginTop: 12 }}>
                <div>
                  <label htmlFor="fuente">Tipo de letra</label>
                  <select
                    id="fuente"
                    value={escena.estilo.fuente}
                    style={{ fontFamily: `"${escena.estilo.fuente}"` }}
                    onChange={(e) =>
                      cambiarEscena({ estilo: { ...escena.estilo, fuente: e.target.value } })
                    }
                  >
                    {(fuentes.length ? fuentes : [{ id: "x", nombre: escena.estilo.fuente, estilo: "serif" as const }]).map((f) => (
                      <option key={f.id} value={f.nombre} style={{ fontFamily: `"${f.nombre}"` }}>
                        {f.nombre} ({f.estilo})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="dur">Duracion (s)</label>
                  <input
                    id="dur"
                    type="number"
                    min={0.5}
                    max={60}
                    step="0.5"
                    value={escena.duracion}
                    onChange={(e) => cambiarEscena({ duracion: Number(e.target.value) || 0.5 })}
                  />
                </div>
                <div>
                  <label htmlFor="anim">Animacion del texto</label>
                  <select
                    id="anim"
                    value={escena.animacion}
                    onChange={(e) => cambiarEscena({ animacion: e.target.value as Animacion })}
                  >
                    {ANIMACIONES.map(([v, n]) => (
                      <option key={v} value={v}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="lectura">Como se va leyendo</label>
                  <select
                    id="lectura"
                    value={escena.lectura}
                    onChange={(e) =>
                      cambiarEscena({ lectura: e.target.value as EscenaMontaje["lectura"] })
                    }
                  >
                    {LECTURAS.map(([v, n]) => (
                      <option key={v} value={v}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="efecto">Efecto de imagen</label>
                  <select
                    id="efecto"
                    value={escena.efecto}
                    onChange={(e) => cambiarEscena({ efecto: e.target.value as Efecto })}
                  >
                    {EFECTOS.map(([v, n]) => (
                      <option key={v} value={v}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="pos">Posicion</label>
                  <select
                    id="pos"
                    value={escena.estilo.posicion}
                    onChange={(e) =>
                      cambiarEscena({
                        estilo: {
                          ...escena.estilo,
                          posicion: e.target.value as EscenaMontaje["estilo"]["posicion"],
                        },
                      })
                    }
                  >
                    {POSICIONES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="tam">Tamano</label>
                  <input
                    id="tam"
                    type="number"
                    min={20}
                    max={200}
                    value={escena.estilo.tamano}
                    onChange={(e) =>
                      cambiarEscena({
                        estilo: { ...escena.estilo, tamano: Number(e.target.value) || 66 },
                      })
                    }
                  />
                </div>
                <div>
                  <label htmlFor="col">Color</label>
                  <input
                    id="col"
                    type="color"
                    value={escena.estilo.color}
                    onChange={(e) =>
                      cambiarEscena({ estilo: { ...escena.estilo, color: e.target.value } })
                    }
                  />
                </div>
                <div>
                  <label htmlFor="cont">Contorno</label>
                  <input
                    id="cont"
                    type="color"
                    value={escena.estilo.contorno}
                    onChange={(e) =>
                      cambiarEscena({ estilo: { ...escena.estilo, contorno: e.target.value } })
                    }
                  />
                </div>
              </div>

              <div className="pie">
                <label className="suave">
                  <input
                    type="checkbox"
                    style={{ width: "auto", marginRight: 6 }}
                    checked={escena.estilo.negrita}
                    onChange={(e) =>
                      cambiarEscena({ estilo: { ...escena.estilo, negrita: e.target.checked } })
                    }
                  />
                  Negrita
                </label>
                <button onClick={aplicarEstiloATodas}>Aplicar estilo a todas</button>
                <button onClick={() => setBuscando(!buscando)}>
                  {buscando ? "Cerrar clips" : escena.clip ? "Cambiar clip" : "Elegir clip"}
                </button>
                <button onClick={() => completarClips(false, true)} disabled={completando}>
                  Buscar clip parecido
                </button>
                <button onClick={clipAlAzar}>Otro clip al azar</button>
                {!escena.clip && (
                  <input
                    type="color"
                    style={{ width: 60 }}
                    value={escena.color}
                    onChange={(e) => cambiarEscena({ color: e.target.value })}
                  />
                )}
              </div>

              {buscando && (
                <BuscadorClips
                  sugerencia={escena.texto.split(" ").slice(0, 3).join(" ")}
                  alElegir={(clip) => {
                    cambiarEscena({ clip });
                    setBuscando(false);
                  }}
                />
              )}
            </section>
          )}

          {panel === "capas" && (
            <section className="tarjeta">
              <h3>Voz</h3>
              <div>
                <label htmlFor="modoVoz">De donde sale</label>
                <select
                  id="modoVoz"
                  value={voz.modo}
                  onChange={(e) =>
                    actualizar({ voz: { ...voz, modo: e.target.value as VozCapa["modo"] } })
                  }
                >
                  <option value="ninguna">Sin voz</option>
                  <option value="ia">Generada en el servidor (voz local o IA)</option>
                  <option value="archivo">Archivo que yo subo</option>
                </select>
              </div>

              {voz.modo === "ia" && (
                <div className="campos" style={{ marginTop: 12 }}>
                  <SelectorVoz
                    catalogo={catalogo}
                    valor={voz.config ?? catalogo.vozPorDefecto}
                    alCambiar={(config) => actualizar({ voz: { ...voz, config } })}
                  />
                </div>
              )}

              {voz.modo === "ia" && (
                <p className="suave" style={{ marginTop: 8 }}>
                  Por defecto habla la voz local del servidor: robotica, pero gratis e inmediata.
                  Si la frase dura mas que la escena, la escena se estira para no cortarla.
                </p>
              )}

              {voz.modo === "archivo" && (
                <div style={{ marginTop: 12 }}>
                  <label htmlFor="subirVoz">Archivo de voz (mp3, m4a, wav, ogg; 40 MB)</label>
                  <input
                    id="subirVoz"
                    type="file"
                    accept="audio/*"
                    onChange={(e) => e.target.files?.[0] && subir(e.target.files[0], "voz")}
                  />
                  {voz.archivo && <p className="suave">Subido: {voz.archivo}</p>}
                </div>
              )}

              <h3 style={{ marginTop: 20 }}>Musica de fondo</h3>
              <div className="campos">
                <div>
                  <label htmlFor="pista">Pista de la biblioteca</label>
                  <select
                    id="pista"
                    value={musica.subida ? "" : (musica.archivo ?? "")}
                    onChange={(e) =>
                      actualizar({
                        musica: { ...musica, archivo: e.target.value || null, subida: false },
                      })
                    }
                  >
                    <option value="">Sin musica</option>
                    {musicaDisponible.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="vol">Volumen ({Math.round(musica.volumen * 100)}%)</label>
                  <input
                    id="vol"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={musica.volumen}
                    onChange={(e) =>
                      actualizar({ musica: { ...musica, volumen: Number(e.target.value) } })
                    }
                  />
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label htmlFor="subirMus">O sube tu propia pista</label>
                <input
                  id="subirMus"
                  type="file"
                  accept="audio/*"
                  onChange={(e) => e.target.files?.[0] && subir(e.target.files[0], "musica")}
                />
                {musica.subida && musica.archivo && (
                  <p className="suave">Subida: {musica.archivo}</p>
                )}
              </div>
            </section>
          )}

          {panel === "salida" && (
            <section className="tarjeta">
              <div>
                <label htmlFor="formato">Formato de salida</label>
                <select
                  id="formato"
                  value={proyecto.formato}
                  onChange={(e) => actualizar({ formato: e.target.value })}
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} · {p.ancho}x{p.alto}
                    </option>
                  ))}
                </select>
              </div>
              {preset && (
                <>
                  <p className="suave" style={{ marginTop: 8 }}>
                    {preset.nota}
                  </p>
                  <p className={total > preset.maxSegundos ? "aviso error" : "suave"}>
                    Duracion total: {total.toFixed(1)} s (recomendado hasta {preset.maxSegundos} s)
                  </p>
                </>
              )}

              <h3 style={{ marginTop: 20 }}>Estilo para todas las escenas</h3>
              <p className="suave">
                Letra, colores, animacion, lectura y efecto iguales en todo el video. La posicion de
                cada escena se respeta.
              </p>
              {(() => {
                const g = global ?? {
                  ...(escena?.estilo ?? nuevaEscena().estilo),
                  animacion: escena?.animacion ?? "fundido",
                  lectura: escena?.lectura ?? "frases",
                  efecto: escena?.efecto ?? "ninguno",
                };
                const set = (c: Partial<typeof g>) => setGlobal({ ...g, ...c });
                return (
                  <>
                    <div className="campos">
                      <div>
                        <label htmlFor="gFuente">Tipo de letra</label>
                        <select id="gFuente" value={g.fuente} onChange={(e) => set({ fuente: e.target.value })}>
                          {(fuentes.length ? fuentes : [{ id: "x", nombre: g.fuente, estilo: "serif" as const }]).map((f) => (
                            <option key={f.id} value={f.nombre}>{f.nombre}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="gTam">Tamano</label>
                        <input id="gTam" type="number" min={20} max={200} value={g.tamano}
                          onChange={(e) => set({ tamano: Number(e.target.value) || 66 })} />
                      </div>
                      <div>
                        <label htmlFor="gCol">Color de letra</label>
                        <input id="gCol" type="color" value={g.color} onChange={(e) => set({ color: e.target.value })} />
                      </div>
                      <div>
                        <label htmlFor="gCont">Contorno</label>
                        <input id="gCont" type="color" value={g.contorno} onChange={(e) => set({ contorno: e.target.value })} />
                      </div>
                      <div>
                        <label htmlFor="gAnim">Animacion del texto</label>
                        <select id="gAnim" value={g.animacion} onChange={(e) => set({ animacion: e.target.value as Animacion })}>
                          {ANIMACIONES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="gLect">Como se va leyendo</label>
                        <select id="gLect" value={g.lectura} onChange={(e) => set({ lectura: e.target.value as EscenaMontaje["lectura"] })}>
                          {LECTURAS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="gEf">Efecto de imagen</label>
                        <select id="gEf" value={g.efecto} onChange={(e) => set({ efecto: e.target.value as Efecto })}>
                          {EFECTOS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="pie">
                      <label className="suave">
                        <input type="checkbox" style={{ width: "auto", marginRight: 6 }} checked={g.negrita}
                          onChange={(e) => set({ negrita: e.target.checked })} />
                        Negrita
                      </label>
                      <button className="primario" onClick={() => { setGlobal(g); aplicarGlobal(g); }}>
                        Aplicar a todas las escenas
                      </button>
                    </div>
                  </>
                );
              })()}
            </section>
          )}
        </div>
      </div>

      <section className="tarjeta">
        <div className="fila" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Linea de tiempo</h2>
          <button onClick={() => actualizar({ escenas: [...escenas, nuevaEscena()] })}>
            Anadir escena
          </button>
          <button onClick={() => moverEscena(indice, indice - 1)} disabled={indice === 0}>
            Mover izquierda
          </button>
          <button
            onClick={() => moverEscena(indice, indice + 1)}
            disabled={indice >= escenas.length - 1}
          >
            Mover derecha
          </button>
          <button
            onClick={() => {
              const copia = [...escenas];
              copia.splice(indice + 1, 0, { ...escena, id: crypto.randomUUID() });
              actualizar({ escenas: copia });
            }}
          >
            Duplicar
          </button>
          <button
            disabled={escenas.length <= 1}
            onClick={() => {
              actualizar({ escenas: escenas.filter((_, i) => i !== indice) });
              setIndice(Math.max(0, indice - 1));
            }}
          >
            Borrar escena
          </button>
        </div>

        <div className="pistas">
          {escenas.map((e, i) => (
            <div
              key={e.id}
              className={`bloque ${i === indice ? "sel" : ""}`}
              style={{ width: Math.max(56, e.duracion * 18) }}
              onClick={() => setIndice(i)}
            >
              {e.clip?.imagen ? (
                <img className="mini" src={e.clip.imagen} alt="" loading="lazy" />
              ) : (
                <div className="mini" style={{ background: e.color }} />
              )}
              <span>
                {i + 1} · {e.duracion}s
              </span>
              <span>{e.texto.slice(0, 18) || "(sin texto)"}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
