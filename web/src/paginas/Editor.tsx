import { useState } from "react";
import {
  aISO,
  api,
  type Catalogo,
  type Guion,
  type Idioma,
  type Miniserie,
  type ModoAudio,
  type ModoPublicacion,
  type Premisa,
  type Region,
  type Voz,
} from "../api";
import { mensajeDe } from "../App";
import {
  CampoFecha,
  CampoSegundos,
  SelectorAudio,
  SelectorBancos,
  SelectorCategoria,
  SelectorModo,
  SelectorMotor,
  motorInicial,
  SelectorMusica,
  SelectorRegion,
  SelectorVoz,
  nombreCategoria,
} from "./comunes";
import { SelectorClips } from "./SelectorClips";
import { GuionTexto } from "./GuionTexto";

export function Editor({ catalogo }: { catalogo: Catalogo }) {
  const [tipo, setTipo] = useState<"Reflexion" | "Historia">("Reflexion");
  const [tema, setTema] = useState("");
  const [duracion, setDuracion] = useState(65);
  const [motor, setMotor] = useState(motorInicial(catalogo));
  const [modelo, setModelo] = useState<string | null>(null);
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [region, setRegion] = useState<Region>("bolivia");
  const [modismos, setModismos] = useState(true);
  const [categoria, setCategoria] = useState<string | null>(catalogo.categoriaAleatoria ?? "aleatoria");
  const [subcategoria, setSubcategoria] = useState<string | null>(null);
  /** Planteamiento previo (título y lineamientos), editable antes de escribir. */
  const [premisa, setPremisa] = useState<Premisa | null>(null);
  /** Miniserie planeada de golpe y capítulo que se está escribiendo. */
  const [miniserie, setMiniserie] = useState<Miniserie | null>(null);
  const [capitulos, setCapitulos] = useState(4);
  const [capitulo, setCapitulo] = useState(1);
  /** Dónde buscar imagen; vacío = lo que use la categoría. */
  const [bancos, setBancos] = useState<string[]>([]);
  const [medios, setMedios] = useState<string[]>([]);
  const [musicaLista, setMusicaLista] = useState<string[]>(catalogo.musica);
  const [voz, setVoz] = useState<Voz>(catalogo.vozPorDefecto);
  const [musica, setMusica] = useState<string | null>(null);
  const [modoAudio, setModoAudio] = useState<ModoAudio>("VOZ");
  const [segundosEscena, setSegundosEscena] = useState<number | null>(null);
  const [modo, setModo] = useState<ModoPublicacion>("DESCARGA");
  const [publicarEn, setPublicarEn] = useState("");

  const [guion, setGuion] = useState<Guion | null>(null);
  /** Clip elegido a mano por escena; el 0 es el gancho. */
  const [clipsElegidos, setClipsElegidos] = useState<Record<number, string>>({});
  const [cargando, setCargando] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const tiktokListo = catalogo.tiktok.configurado && catalogo.tiktok.cuentasConectadas > 0;
  // La NASA no pide clave, así que siempre queda algo donde buscar; sin las
  // otras dos, eso sí, solo hay material de espacio y ciencia.
  const soloNasa = !catalogo.clips.pexels && !catalogo.clips.pixabay;
  const sinClips = soloNasa && !catalogo.clips.nasa;

  async function plantear() {
    setCargando("premisa");
    setError("");
    setOk("");
    try {
      const p = await api.post<Premisa>("/api/premisa", {
        motor,
        modelo,
        tema: tema || undefined,
        categoria,
        subcategoria,
        duracion,
        idioma,
        region,
        modismos,
      });
      setPremisa(p);
      if (p.avisoMotor) setOk(p.avisoMotor);
      setGuion(null);
      setMiniserie(null);
      setClipsElegidos({});
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setCargando("");
    }
  }

  /** Planea la miniserie entera: sinopsis y qué pasa en cada capítulo. */
  async function planearMiniserie() {
    setCargando("miniserie");
    setError("");
    setOk("");
    try {
      const plan = await api.post<Miniserie>("/api/miniserie", {
        motor,
        modelo,
        tema: tema || undefined,
        categoria,
        subcategoria,
        duracion,
        idioma,
        region,
        modismos,
        capitulos,
      });
      setMiniserie(plan);
      setCapitulo(1);
      setPremisa(null);
      setGuion(null);
      setOk(
        `Miniserie planeada: ${plan.capitulos.length} capítulos. Escribe el primero cuando quieras.` +
          (plan.avisoMotor ? ` ${plan.avisoMotor}` : ""),
      );
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setCargando("");
    }
  }

  async function escribirGuion() {
    setCargando("guion");
    setError("");
    setOk("");
    try {
      setClipsElegidos({});
      const g = await api.post<Guion>("/api/guion", {
          motor,
          modelo,
          tipo,
          tema: tema || undefined,
          categoria,
          subcategoria,
          premisa: miniserie ? null : premisa,
          miniserie,
          capitulo: miniserie ? capitulo : null,
          duracion,
          idioma,
        region,
        modismos,
        narrado: modoAudio === "VOZ",
      });
      setGuion(g);
      if (g.avisoMotor) setOk(g.avisoMotor);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setCargando("");
    }
  }

  async function producir() {
    setCargando("video");
    setError("");
    setOk("");
    try {
      await api.post("/api/historias", {
        motor,
        modelo,
        tipo,
        tema: tema || undefined,
        duracion,
        idioma,
        region,
        modismos,
        categoria,
        subcategoria,
        premisa: miniserie ? null : (guion?.premisa ?? premisa),
        miniserie,
        capitulo: miniserie ? capitulo : null,
        bancos,
        medios,
        voz,
        modoAudio,
        segundosEscena,
        musica,
        modoPublicacion: modo,
        guion: guion ?? undefined,
        clipsElegidos,
        publicarEn: modo === "DESCARGA" ? null : aISO(publicarEn),
      });
      setOk(
        modo !== "DESCARGA" && publicarEn
          ? `Historia encolada. La subida a TikTok esta programada para ${new Date(
              publicarEn,
            ).toLocaleString()}.`
          : "Historia encolada. Sigue su avance en la pestana Historias.",
      );
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setCargando("");
    }
  }

  function editarEscena(i: number, texto: string) {
    if (!guion) return;
    const escenas = guion.escenas.map((e, j) => (j === i ? { ...e, texto } : e));
    setGuion({ ...guion, escenas });
  }

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}
      {sinClips && (
        <p className="aviso error">
          No hay claves de Pexels ni de Pixabay: sin ellas no se pueden buscar clips.
        </p>
      )}
      {!sinClips && soloNasa && (
        <p className="aviso error">
          Sin claves de Pexels ni de Pixabay solo se puede buscar en la NASA: sirve para ciencia y espacio,
          no para el resto de temas.
        </p>
      )}

      <section className="tarjeta">
        <h2>1. Guion</h2>
        <div className="campos">
          <div>
            <label htmlFor="tipo">Tipo</label>
            <select
              id="tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as "Reflexion" | "Historia")}
            >
              <option value="Reflexion">Reflexion</option>
              <option value="Historia">Historia</option>
            </select>
          </div>
          <div>
            <label htmlFor="tema">Tema (vacio = libre)</label>
            <input id="tema" value={tema} onChange={(e) => setTema(e.target.value)} />
          </div>
          <SelectorCategoria
            catalogo={catalogo}
            categoria={categoria}
            subcategoria={subcategoria}
            alCambiar={(c, sc) => {
              setCategoria(c);
              setSubcategoria(sc);
              setPremisa(null);
            }}
          />
          <div>
            <label htmlFor="idioma">Idioma</label>
            <select
              id="idioma"
              value={idioma}
              onChange={(e) => setIdioma(e.target.value as Idioma)}
            >
              {catalogo.idiomas.map((i) => (
                <option key={i} value={i}>
                  {i === "es" ? "Espanol" : "Ingles"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="duracion">Duracion (segundos)</label>
            <input
              id="duracion"
              type="number"
              min={15}
              max={350}
              value={duracion}
              onChange={(e) => setDuracion(Number(e.target.value))}
            />
          </div>
          <SelectorRegion catalogo={catalogo} region={region} modismos={modismos} alCambiar={(r, m) => { setRegion(r); setModismos(m); }} />
          <SelectorBancos
            catalogo={catalogo}
            bancos={bancos}
            medios={medios}
            alCambiar={(b, m) => { setBancos(b); setMedios(m); }}
          />
          <SelectorMotor
            catalogo={catalogo}
            valor={motor}
            alCambiar={setMotor}
            modelo={modelo}
            alCambiarModelo={setModelo}
          />
        </div>
        <div className="pie">
          <button onClick={plantear} disabled={cargando !== ""}>
            {cargando === "premisa" ? "Planteando..." : "Plantear al azar (título y lineamientos)"}
          </button>
          <button onClick={escribirGuion} disabled={cargando !== ""}>
            {cargando === "guion"
              ? "Escribiendo..."
              : miniserie
                ? `Escribir el capítulo ${capitulo}`
                : premisa
                  ? "Escribir guion con este planteamiento"
                  : "Escribir guion"}
          </button>
          <span className="suave">
            {categoria
              ? "Con categoría, primero se decide título y lineamientos y después se escribe."
              : "Sin categoría se escribe directo, con tema libre."}
          </span>
        </div>
        <div className="pie">
          <button onClick={planearMiniserie} disabled={cargando !== ""}>
            {cargando === "miniserie" ? "Planeando..." : "Planear miniserie (formato largo)"}
          </button>
          <input
            type="number"
            style={{ width: 80 }}
            min={2}
            max={12}
            value={capitulos}
            aria-label="Capítulos de la miniserie"
            onChange={(e) => setCapitulos(Number(e.target.value) || 4)}
          />
          <span className="suave">
            capítulos. Una sola historia repartida, cada capítulo con su corte final. Para capítulos largos
            elige un formato de miniserie en el montaje y sube la duración.
          </span>
        </div>
      </section>

      {miniserie && (
        <section className="tarjeta">
          <div className="fila" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Miniserie · {miniserie.titulo}</h2>
            <span className="estado">{nombreCategoria(catalogo, miniserie.categoria, miniserie.subcategoria)}</span>
            <button onClick={planearMiniserie} disabled={cargando !== ""}>Otra al azar</button>
            <button onClick={() => setMiniserie(null)}>Descartar</button>
          </div>
          <p className="suave">{miniserie.sinopsis}</p>
          {miniserie.personajes.length > 0 && (
            <p className="suave">Personajes: {miniserie.personajes.join(" · ")}</p>
          )}
          <div className="lista" style={{ marginTop: 8 }}>
            {miniserie.capitulos.map((c) => (
              <div className="item" key={c.numero}>
                <div className="fila">
                  <span className={`estado ${c.numero === capitulo ? "LISTA" : ""}`}>Cap. {c.numero}</span>
                  <strong>{c.titulo}</strong>
                </div>
                <p className="suave">{c.resumen}</p>
                {c.cliffhanger && <p className="suave">Corta en: {c.cliffhanger}</p>}
                <div className="pie">
                  <button
                    onClick={() => {
                      setCapitulo(c.numero);
                      setGuion(null);
                    }}
                    disabled={cargando !== "" || c.numero === capitulo}
                  >
                    {c.numero === capitulo ? "Es el que toca" : "Escribir este"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="suave">
            Escribe el capítulo elegido con el botón de arriba y prodúcelo como cualquier historia; después
            pasa al siguiente. Cada capítulo recuerda en una frase dónde quedó el anterior.
          </p>
        </section>
      )}

      {premisa && (
        <section className="tarjeta">
          <div className="fila" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Planteamiento</h2>
            <span className="estado">{nombreCategoria(catalogo, premisa.categoria, premisa.subcategoria)}</span>
            <button onClick={plantear} disabled={cargando !== ""}>Otro al azar</button>
            <button onClick={() => setPremisa(null)}>Descartar</button>
          </div>
          <div>
            <label htmlFor="premisaTitulo">Título</label>
            <input
              id="premisaTitulo"
              value={premisa.titulo}
              onChange={(e) => setPremisa({ ...premisa, titulo: e.target.value })}
            />
          </div>
          {(premisa.fuente !== undefined || premisa.idea !== undefined) &&
            (premisa.fuente || premisa.idea) && (
              <div className="campos" style={{ marginTop: 12 }}>
                <div>
                  <label htmlFor="premisaFuente">De dónde sale (obra, autor o corriente)</label>
                  <input
                    id="premisaFuente"
                    value={premisa.fuente ?? ""}
                    onChange={(e) => setPremisa({ ...premisa, fuente: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="premisaIdea">La idea, en una frase</label>
                  <input
                    id="premisaIdea"
                    value={premisa.idea ?? ""}
                    onChange={(e) => setPremisa({ ...premisa, idea: e.target.value })}
                  />
                </div>
              </div>
            )}
          <div style={{ marginTop: 12 }}>
            <label htmlFor="lineamientos">Lineamientos (uno por línea)</label>
            <textarea
              id="lineamientos"
              value={premisa.lineamientos.join("\n")}
              onChange={(e) =>
                setPremisa({ ...premisa, lineamientos: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) })
              }
            />
          </div>
          <div className="campos" style={{ marginTop: 12 }}>
            <div>
              <label htmlFor="giro">{premisa.idea ? "Frase de cierre" : "Giro o remate final"}</label>
              <input id="giro" value={premisa.giro} onChange={(e) => setPremisa({ ...premisa, giro: e.target.value })} />
            </div>
            <div>
              <label htmlFor="criterios">Criterios de búsqueda de clips (inglés, separados por coma)</label>
              <input
                id="criterios"
                value={premisa.keywords.join(", ")}
                onChange={(e) =>
                  setPremisa({ ...premisa, keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })
                }
              />
            </div>
          </div>
          {premisa.personajes.length > 0 && (
            <p className="suave" style={{ marginTop: 8 }}>Personajes: {premisa.personajes.join(" · ")}</p>
          )}
        </section>
      )}

      {guion && (
        <section className="tarjeta">
          <h2>2. Escenas</h2>
          {guion.categoria && (
            <p className="suave">
              {nombreCategoria(catalogo, guion.categoria, guion.subcategoria ?? null)}
              {guion.keywords?.length ? ` · clips: ${guion.keywords.join(", ")}` : ""}
            </p>
          )}
          <div>
            <label htmlFor="titulo">Titulo</label>
            <input
              id="titulo"
              value={guion.titulo}
              onChange={(e) => setGuion({ ...guion, titulo: e.target.value })}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <label htmlFor="gancho">Gancho (primeros segundos, se rotula mas grande)</label>
            <input
              id="gancho"
              value={guion.gancho}
              onChange={(e) => setGuion({ ...guion, gancho: e.target.value })}
            />
          </div>
          <div className="lista" style={{ marginTop: 12 }}>
            {guion.escenas.map((e, i) => (
              <div className="item" key={i}>
                <label htmlFor={`escena-${i}`}>
                  Escena {i + 1} - clips: {e.keywords.join(", ")}
                </label>
                <textarea
                  id={`escena-${i}`}
                  value={e.texto}
                  onChange={(ev) => editarEscena(i, ev.target.value)}
                />
              </div>
            ))}
          </div>
          {(guion.ganchos ?? []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <label htmlFor="ganchos">
                Ganchos para la descripción (uno por línea; el primero encabeza la publicación)
              </label>
              <textarea
                id="ganchos"
                value={(guion.ganchos ?? []).join("\n")}
                onChange={(ev) =>
                  setGuion({
                    ...guion,
                    ganchos: ev.target.value.split("\n").map((g) => g.trim()).filter(Boolean),
                  })
                }
              />
              <p className="suave">
                No se narran: son el texto con el que se publica. Mueve el que prefieras a la primera línea
                para probar cuál rinde.
              </p>
            </div>
          )}
          {guion.hashtags.length > 0 && (
            <p className="suave" style={{ marginTop: 12 }}>
              Hashtags: {guion.hashtags.map((h) => `#${h}`).join(" ")}
            </p>
          )}
        </section>
      )}

      {guion && <GuionTexto guion={guion} alAplicar={setGuion} />}

      {guion && (
        <section className="tarjeta">
          <h2>3. Clips de cada escena</h2>
          <p className="suave">
            Por defecto los elige la app. Aqui puedes verlos y decidir cual aparece; solo se
            descarga al servidor el que acabe usandose.
          </p>
          <SelectorClips
            escenas={[
              { texto: guion.gancho, keywords: guion.escenas[0]?.keywords ?? [] },
              ...guion.escenas,
            ]}
            elegidos={clipsElegidos}
            alElegir={(indice, clipId) =>
              setClipsElegidos((previos) => {
                const copia = { ...previos };
                if (clipId) copia[indice] = clipId;
                else delete copia[indice];
                return copia;
              })
            }
          />
        </section>
      )}

      <section className="tarjeta">
        <h2>{guion ? "4" : "3"}. Voz y video</h2>
        <div className="campos">
          <SelectorAudio valor={modoAudio} alCambiar={setModoAudio} />
          {modoAudio === "VOZ" ? (
            <SelectorVoz catalogo={catalogo} valor={voz} alCambiar={setVoz} idioma={idioma} />
          ) : (
            <CampoSegundos valor={segundosEscena} alCambiar={setSegundosEscena} />
          )}
          {modoAudio !== "MUDO" && (
            <SelectorMusica
              catalogo={{ ...catalogo, musica: musicaLista }}
              valor={musica}
              alCambiar={setMusica}
              alAmpliar={setMusicaLista}
            />
          )}
          <SelectorModo valor={modo} alCambiar={setModo} tiktokListo={tiktokListo} />
          {modo !== "DESCARGA" && (
            <CampoFecha
              id="publicarEn"
              etiqueta="Subir a TikTok el (vacio = al terminar)"
              valor={publicarEn}
              alCambiar={setPublicarEn}
            />
          )}
        </div>
        <p className="suave">
          Limites: clips de {catalogo.limites.clipMB} MB y video compilado de{" "}
          {catalogo.limites.videoMB} MB.
        </p>
        <div className="pie">
          <button className="primario" onClick={producir} disabled={cargando !== "" || sinClips}>
            {cargando === "video" ? "Encolando..." : "Generar video"}
          </button>
          <span className="suave">
            {guion ? "Se usara el guion de arriba." : "Sin guion previo se escribira uno nuevo."}
          </span>
        </div>
      </section>
    </>
  );
}
