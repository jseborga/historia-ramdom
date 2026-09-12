import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Catalogo,
  type EscenaMontaje,
  type MusicaCapa,
  type Preset,
  type Proyecto,
  type VozCapa,
} from "../api";
import { mensajeDe } from "../App";
import { SelectorVoz } from "./comunes";
import { Lienzo } from "./Lienzo";
import { BuscadorClips } from "./BuscadorClips";

const ANIMACIONES = ["ninguna", "fundido", "subir", "zoom"] as const;
const POSICIONES = ["arriba", "centro", "abajo"] as const;

const nuevaEscena = (): EscenaMontaje => ({
  id: crypto.randomUUID(),
  clip: null,
  color: "#111318",
  duracion: 4,
  texto: "",
  estilo: { tamano: 66, color: "#FFFFFF", contorno: "#000000", posicion: "abajo", negrita: false },
  animacion: "fundido",
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
  const [indice, setIndice] = useState(0);
  const [panel, setPanel] = useState<"escena" | "capas" | "salida">("escena");
  const [buscando, setBuscando] = useState(false);
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
    } catch (err) {
      setError(mensajeDe(err));
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

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
      </div>

      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}
      {proyecto.estado === "ERROR" && proyecto.error && (
        <pre>{proyecto.error}</pre>
      )}

      {proyecto.estado === "LISTO" && proyecto.archivo && (
        <section className="tarjeta">
          <h2>Video listo</h2>
          <video className="reproductor" src={`/api/proyectos/${proyecto.id}/ver`} controls />
          <div className="pie">
            <a className="boton" href={`/api/proyectos/${proyecto.id}/descargar`}>
              Descargar MP4
            </a>
            <span className="suave">
              {proyecto.duracionSeg?.toFixed(1)} s · {preset?.nombre}
            </span>
          </div>
        </section>
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
                  <label htmlFor="anim">Animacion</label>
                  <select
                    id="anim"
                    value={escena.animacion}
                    onChange={(e) =>
                      cambiarEscena({ animacion: e.target.value as EscenaMontaje["animacion"] })
                    }
                  >
                    {ANIMACIONES.map((a) => (
                      <option key={a} value={a}>
                        {a}
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
                <button onClick={() => setBuscando(!buscando)}>
                  {buscando ? "Cerrar clips" : escena.clip ? "Cambiar clip" : "Elegir clip"}
                </button>
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
                  <option value="ia">Generada con IA</option>
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
