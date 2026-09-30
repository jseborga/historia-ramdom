import { useEffect, useState } from "react";
import {
  api,
  type Catalogo,
  type EstadoPlano,
  type Idioma,
  type LineaDialogo,
  type ObraProduccion,
  type ParteTrailer,
  type Personaje,
  type Plano,
  type Preset,
  type Produccion,
  type ProduccionResumen,
} from "../api";
import { mensajeDe } from "../App";
import { Muestra, SelectorMotor, SelectorMusica, motorInicial, nombreIdioma } from "./comunes";
import { EditorMontaje } from "./EditorMontaje";

/**
 * Tráiler de concepto: la promo de una obra que todavía no existe.
 *
 * La app escribe la biblia, los personajes y los planos, y arma para cada
 * plano el prompt de Veo. Los vídeos se generan fuera (Gemini o Flow), a lo
 * largo de varios días, y se suben aquí plano a plano. Con lo que haya se
 * monta el tráiler, un avance o el teaser de un personaje.
 */

const OBRAS: { id: ObraProduccion; nombre: string }[] = [
  { id: "pelicula", nombre: "Película" },
  { id: "serie", nombre: "Serie" },
  { id: "anime", nombre: "Anime" },
  { id: "documental", nombre: "Documental" },
  { id: "videojuego", nombre: "Videojuego" },
];

const PARTES: { id: ParteTrailer; nombre: string }[] = [
  { id: "gancho", nombre: "Gancho en frío" },
  { id: "mundo", nombre: "El mundo" },
  { id: "personaje", nombre: "Personaje" },
  { id: "conflicto", nombre: "Conflicto" },
  { id: "escalada", nombre: "Escalada" },
  { id: "silencio", nombre: "Silencio" },
  { id: "titulo", nombre: "Título" },
  { id: "proximamente", nombre: "Próximamente" },
];

const ESTADOS: Record<EstadoPlano, string> = {
  PENDIENTE: "Por generar",
  PROMPT_COPIADO: "Prompt copiado",
  SUBIDO: "Subido, por revisar",
  APROBADO: "Aprobado",
  REGENERAR: "Hay que repetirlo",
};

const CLASE_ESTADO: Record<EstadoPlano, string> = {
  PENDIENTE: "",
  PROMPT_COPIADO: "MONTAJE",
  SUBIDO: "MONTAJE",
  APROBADO: "LISTA",
  REGENERAR: "ERROR",
};

/** Lo que Veo 3.1 sabe hacer por plano: 4, 6 u 8 s (8 con referencias). */
const DURACIONES_VEO = [4, 6, 8];
const MAX_REFERENCIAS = 3;

/** Copia al portapapeles; sin https el navegador no deja, y se tira del viejo truco. */
async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = texto;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const hecho = document.execCommand("copy");
    area.remove();
    return hecho;
  }
}

function progreso(planos: { estado: EstadoPlano; tipo: string }[]) {
  const veo = planos.filter((p) => p.tipo === "veo");
  return {
    total: veo.length,
    subidos: veo.filter((p) => p.estado === "SUBIDO" || p.estado === "APROBADO").length,
    aprobados: veo.filter((p) => p.estado === "APROBADO").length,
  };
}

export function Trailer({ catalogo }: { catalogo: Catalogo }) {
  const [lista, setLista] = useState<ProduccionResumen[]>([]);
  const [actual, setActual] = useState<Produccion | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  async function cargarLista() {
    try {
      setLista(await api.get<ProduccionResumen[]>("/api/producciones"));
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  useEffect(() => {
    cargarLista();
  }, []);

  async function abrir(id: string) {
    setError("");
    setOk("");
    try {
      setActual(await api.get<Produccion>(`/api/producciones/${id}`));
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  async function borrar(p: ProduccionResumen) {
    if (!window.confirm(`¿Borrar "${p.titulo}"? Los vídeos y las imágenes se quedan en la Galería.`)) return;
    try {
      await api.borrar(`/api/producciones/${p.id}`);
      await cargarLista();
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  if (abierto) {
    return <EditorMontaje id={abierto} catalogo={catalogo} alSalir={() => setAbierto(null)} />;
  }

  if (actual) {
    return (
      <Produccion_
        catalogo={catalogo}
        inicial={actual}
        alVolver={() => {
          setActual(null);
          cargarLista();
        }}
        alMontar={setAbierto}
      />
    );
  }

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}
      <NuevaProduccion
        catalogo={catalogo}
        alCrear={(p) => {
          setOk(
            `Tráiler escrito con ${p.motorUsado ?? "la IA"}: ${p.personajes.length} personajes y ${p.planos.length} planos.` +
              (p.avisoMotor ? ` ${p.avisoMotor}` : ""),
          );
          setActual(p);
        }}
      />

      <section className="tarjeta">
        <h2>Producciones</h2>
        {!lista.length ? (
          <p className="suave">Todavía no hay ninguna. Escribe una idea arriba.</p>
        ) : (
          <div className="lista">
            {lista.map((p) => {
              const g = progreso(p.planos);
              return (
                <div className="item" key={p.id}>
                  <div className="fila">
                    <strong>{p.titulo}</strong>
                    <span className="estado">{OBRAS.find((o) => o.id === p.obra)?.nombre ?? p.obra}</span>
                    {p.genero && <span className="suave">{p.genero}</span>}
                  </div>
                  {p.logline && <p className="suave">{p.logline}</p>}
                  <p className="suave">
                    {g.subidos} de {g.total} planos con vídeo · {g.aprobados} aprobados · {p._count.personajes}{" "}
                    personajes
                  </p>
                  <div className="pie">
                    <button className="primario" onClick={() => abrir(p.id)}>
                      Abrir
                    </button>
                    <button onClick={() => borrar(p)}>Borrar</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function NuevaProduccion({ catalogo, alCrear }: { catalogo: Catalogo; alCrear: (p: Produccion) => void }) {
  const [idea, setIdea] = useState("");
  const [obra, setObra] = useState<ObraProduccion>("pelicula");
  const [genero, setGenero] = useState("");
  const [duracion, setDuracion] = useState<30 | 60 | 90>(60);
  const [formato, setFormato] = useState("tiktok");
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [motor, setMotor] = useState(motorInicial(catalogo));
  const [modelo, setModelo] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<Preset[]>("/api/presets").then(setPresets).catch(() => {});
  }, []);

  async function generar() {
    setOcupado(true);
    setError("");
    try {
      alCrear(
        await api.post<Produccion>("/api/producciones", { idea, obra, genero, duracion, formato, idioma, motor, modelo }),
      );
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="tarjeta">
      <h2>Tráiler de concepto</h2>
      <p className="suave">
        La promo de una obra que no existe, para vender la idea. La IA escribe la biblia, los personajes y los
        planos; tú generas cada plano en Veo con el prompt que te da la app y lo subes aquí. Se puede montar en
        cualquier momento con lo que haya.
      </p>
      {error && <p className="aviso error">{error}</p>}
      <div className="campos">
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="ideaTr">La idea</label>
          <textarea
            id="ideaTr"
            rows={3}
            value={idea}
            placeholder="Una cartera de El Alto descubre que las cartas que reparte cambian el pasado de quien las lee..."
            onChange={(e) => setIdea(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="obraTr">Qué es</label>
          <select id="obraTr" value={obra} onChange={(e) => setObra(e.target.value as ObraProduccion)}>
            {OBRAS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="generoTr">Género (opcional)</label>
          <input id="generoTr" value={genero} placeholder="thriller, ciencia ficción..." onChange={(e) => setGenero(e.target.value)} />
        </div>
        <div>
          <label htmlFor="durTr">Duración del tráiler</label>
          <select id="durTr" value={duracion} onChange={(e) => setDuracion(Number(e.target.value) as 30 | 60 | 90)}>
            <option value={30}>30 s (teaser, 4-5 planos)</option>
            <option value={60}>60 s (7-8 planos)</option>
            <option value={90}>90 s (10-11 planos)</option>
          </select>
        </div>
        <div>
          <label htmlFor="fmtTr">Formato</label>
          <select id="fmtTr" value={formato} onChange={(e) => setFormato(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="idiomaTr">Idioma de los diálogos</label>
          <select id="idiomaTr" value={idioma} onChange={(e) => setIdioma(e.target.value as Idioma)}>
            {catalogo.idiomas.map((i) => (
              <option key={i} value={i}>
                {nombreIdioma(catalogo, i)}
              </option>
            ))}
          </select>
        </div>
        <SelectorMotor catalogo={catalogo} valor={motor} alCambiar={setMotor} modelo={modelo} alCambiarModelo={setModelo} />
      </div>
      <div className="pie">
        <button className="primario" onClick={generar} disabled={ocupado || idea.trim().length < 10}>
          {ocupado ? "Escribiendo el tráiler..." : "Escribir el tráiler"}
        </button>
      </div>
    </section>
  );
}

function Produccion_({
  catalogo,
  inicial,
  alVolver,
  alMontar,
}: {
  catalogo: Catalogo;
  inicial: Produccion;
  alVolver: () => void;
  alMontar: (proyectoId: string) => void;
}) {
  const [pr, setPr] = useState(inicial);
  const [biblia, setBiblia] = useState(() => ({
    titulo: inicial.titulo,
    logline: inicial.logline,
    genero: inicial.genero,
    estilo: inicial.estilo,
  }));
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  /** Cualquier cambio devuelve la producción entera: prompts ya rehechos. */
  async function hacer(que: string, accion: () => Promise<Produccion>, aviso?: string) {
    setOcupado(que);
    setError("");
    setOk("");
    try {
      setPr(await accion());
      if (aviso) setOk(aviso);
      return true;
    } catch (err) {
      setError(mensajeDe(err));
      return false;
    } finally {
      setOcupado("");
    }
  }

  const base = `/api/producciones/${pr.id}`;
  const cambiosBiblia =
    biblia.titulo !== pr.titulo || biblia.logline !== pr.logline || biblia.genero !== pr.genero || biblia.estilo !== pr.estilo;
  const g = progreso(pr.planos);

  async function mover(i: number, paso: -1 | 1) {
    const ids = pr.planos.map((p) => p.id);
    const j = i + paso;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await hacer("orden", () => api.post<Produccion>(`${base}/planos/orden`, { ids }));
  }

  return (
    <>
      <div className="pie" style={{ marginTop: 0, marginBottom: 12 }}>
        <button onClick={alVolver}>← Producciones</button>
        <span className="suave">
          {g.subidos} de {g.total} planos con vídeo · {g.aprobados} aprobados
        </span>
      </div>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>1. La biblia</h2>
        <div className="campos">
          <div>
            <label htmlFor="tituloPr">Título</label>
            <input id="tituloPr" value={biblia.titulo} onChange={(e) => setBiblia({ ...biblia, titulo: e.target.value })} />
          </div>
          <div>
            <label htmlFor="generoPr">Género</label>
            <input id="generoPr" value={biblia.genero} onChange={(e) => setBiblia({ ...biblia, genero: e.target.value })} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="loglinePr">Logline</label>
            <textarea
              id="loglinePr"
              rows={2}
              value={biblia.logline}
              onChange={(e) => setBiblia({ ...biblia, logline: e.target.value })}
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="estiloPr">Estilo visual (en inglés; va igual al principio de todos los prompts)</label>
            <textarea
              id="estiloPr"
              rows={3}
              value={biblia.estilo}
              onChange={(e) => setBiblia({ ...biblia, estilo: e.target.value })}
            />
          </div>
        </div>
        <div className="pie">
          <button
            className="primario"
            disabled={!cambiosBiblia || !biblia.titulo.trim() || Boolean(ocupado)}
            onClick={() => hacer("biblia", () => api.put<Produccion>(base, biblia), "Guardado. Los prompts ya llevan el cambio.")}
          >
            Guardar la biblia
          </button>
        </div>

        {pr.pitch && (
          <details style={{ marginTop: 12 }}>
            <summary>El pitch (para vender la idea)</summary>
            <div className="lista" style={{ marginTop: 8 }}>
              {pr.pitch.sinopsis && (
                <p>
                  <strong>Sinopsis.</strong> {pr.pitch.sinopsis}
                </p>
              )}
              {pr.pitch.publico && (
                <p>
                  <strong>Público.</strong> {pr.pitch.publico}
                </p>
              )}
              {pr.pitch.formato && (
                <p>
                  <strong>Formato.</strong> {pr.pitch.formato}
                </p>
              )}
              {pr.pitch.referencias.length > 0 && (
                <p>
                  <strong>Referencias.</strong> {pr.pitch.referencias.join(" · ")}
                </p>
              )}
              {pr.pitch.porQueAhora && (
                <p>
                  <strong>Por qué ahora.</strong> {pr.pitch.porQueAhora}
                </p>
              )}
              {pr.hashtags.length > 0 && <p className="suave">{pr.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>}
            </div>
          </details>
        )}
      </section>

      <section className="tarjeta">
        <h2>2. Personajes</h2>
        <p className="suave">
          Primero la imagen de referencia de cada uno: copia su prompt, genera la imagen (Gemini, Imagen o la que
          uses) y súbela. Veo la usa para que el personaje tenga la misma cara en todos los planos. La ficha va
          literal en cada prompt: si la cambias, cambia en todos.
        </p>
        <div className="lista">
          {pr.personajes.map((pj) => (
            <TarjetaPersonaje
              key={pj.id}
              personaje={pj}
              base={base}
              ocupado={Boolean(ocupado)}
              hacer={hacer}
            />
          ))}
        </div>
        <div className="pie">
          <button
            disabled={Boolean(ocupado)}
            onClick={() => {
              const nombre = window.prompt("Nombre del personaje");
              if (nombre?.trim()) hacer("personaje", () => api.post<Produccion>(`${base}/personajes`, { nombre: nombre.trim() }));
            }}
          >
            Añadir personaje
          </button>
        </div>
      </section>

      <section className="tarjeta">
        <h2>3. Planos</h2>
        <p className="suave">
          Uno por generación de Veo. Copia el prompt, pégalo en Veo 3.1 con las imágenes de referencia de quien
          salga (8 s, hasta 3), y sube el vídeo que salga. Si el plano continúa del anterior, usa su último
          fotograma como primer fotograma. Los cartones (título, próximamente) los pone la app.
        </p>
        <div className="lista">
          {pr.planos.map((pl, i) => (
            <TarjetaPlano
              key={pl.id}
              plano={pl}
              personajes={pr.personajes}
              base={base}
              ocupado={Boolean(ocupado)}
              hacer={hacer}
              alSubir={i > 0 ? () => mover(i, -1) : null}
              alBajar={i < pr.planos.length - 1 ? () => mover(i, 1) : null}
            />
          ))}
        </div>
        <div className="pie">
          <button
            disabled={Boolean(ocupado)}
            onClick={() => hacer("plano", () => api.post<Produccion>(`${base}/planos`, { tipo: "veo", duracion: 8 }))}
          >
            Añadir plano
          </button>
          <button
            disabled={Boolean(ocupado)}
            onClick={() =>
              hacer("plano", () =>
                api.post<Produccion>(`${base}/planos`, { tipo: "carton", parte: "titulo", duracion: 3, rotulo: pr.titulo }),
              )
            }
          >
            Añadir cartón
          </button>
        </div>
      </section>

      <Montar catalogo={catalogo} pr={pr} alMontar={alMontar} />
    </>
  );
}

type Hacer = (que: string, accion: () => Promise<Produccion>, aviso?: string) => Promise<boolean>;

function TarjetaPersonaje({
  personaje,
  base,
  ocupado,
  hacer,
}: {
  personaje: Personaje;
  base: string;
  ocupado: boolean;
  hacer: Hacer;
}) {
  const [b, setB] = useState(personaje);
  useEffect(() => setB(personaje), [personaje]);
  const [copiado, setCopiado] = useState(false);
  const ruta = `${base}/personajes/${personaje.id}`;
  const cambiado =
    b.nombre !== personaje.nombre || b.papel !== personaje.papel || b.ficha !== personaje.ficha || b.voz !== personaje.voz;

  return (
    <div className="item">
      <div className="fila" style={{ alignItems: "flex-start" }}>
        <div className="miniatura" style={{ width: 96, flex: "0 0 96px" }}>
          {personaje.medioId ? (
            <Muestra url={`/api/medios/${personaje.medioId}/miniatura`} alt={personaje.nombre} />
          ) : (
            <div className="sinImagen">sin imagen</div>
          )}
        </div>
        <div className="campos" style={{ flex: 1 }}>
          <div>
            <label htmlFor={`nom-${b.id}`}>Nombre</label>
            <input id={`nom-${b.id}`} value={b.nombre} onChange={(e) => setB({ ...b, nombre: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`pap-${b.id}`}>Papel</label>
            <input id={`pap-${b.id}`} value={b.papel} onChange={(e) => setB({ ...b, papel: e.target.value })} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label htmlFor={`fic-${b.id}`}>Ficha visual (en inglés, fija)</label>
            <textarea id={`fic-${b.id}`} rows={3} value={b.ficha} onChange={(e) => setB({ ...b, ficha: e.target.value })} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label htmlFor={`voz-${b.id}`}>Voz (cómo habla; Veo pone la voz)</label>
            <input id={`voz-${b.id}`} value={b.voz} onChange={(e) => setB({ ...b, voz: e.target.value })} />
          </div>
        </div>
      </div>
      <div className="pie">
        <button
          className="primario"
          disabled={!cambiado || !b.nombre.trim() || ocupado}
          onClick={() =>
            hacer("personaje", () =>
              api.put<Produccion>(ruta, { nombre: b.nombre, papel: b.papel, ficha: b.ficha, voz: b.voz }),
            )
          }
        >
          Guardar
        </button>
        <button
          onClick={async () => {
            setCopiado(await copiar(personaje.promptImagen));
            window.setTimeout(() => setCopiado(false), 2000);
          }}
        >
          {copiado ? "Copiado" : "Copiar prompt de la imagen"}
        </button>
        <label className="boton" style={{ margin: 0 }}>
          {personaje.medioId ? "Cambiar imagen" : "Subir imagen"}
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={ocupado}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) hacer("imagen", () => api.subir<Produccion>(`${ruta}/imagen`, f), `Imagen de ${personaje.nombre} guardada.`);
            }}
          />
        </label>
        {personaje.medioId && (
          <a className="boton" href={`/api/medios/${personaje.medioId}/ver`} download>
            Descargar referencia
          </a>
        )}
        <button
          disabled={ocupado}
          onClick={() => {
            if (window.confirm(`¿Quitar a ${personaje.nombre}? Sale también de los planos y sus diálogos.`)) {
              hacer("personaje", () => api.borrar<Produccion>(ruta));
            }
          }}
        >
          Quitar
        </button>
      </div>
      <details style={{ marginTop: 8 }}>
        <summary className="suave">Ver el prompt de la imagen</summary>
        <pre>{personaje.promptImagen}</pre>
      </details>
    </div>
  );
}

function TarjetaPlano({
  plano,
  personajes,
  base,
  ocupado,
  hacer,
  alSubir,
  alBajar,
}: {
  plano: Plano;
  personajes: Personaje[];
  base: string;
  ocupado: boolean;
  hacer: Hacer;
  alSubir: (() => void) | null;
  alBajar: (() => void) | null;
}) {
  const [b, setB] = useState(plano);
  useEffect(() => setB(plano), [plano]);
  const [copiado, setCopiado] = useState(false);
  const [abierto, setAbierto] = useState(plano.estado !== "APROBADO");
  const ruta = `${base}/planos/${plano.id}`;
  const esVeo = b.tipo === "veo";

  const campos = [
    "tipo",
    "parte",
    "duracion",
    "accion",
    "camara",
    "sonido",
    "dialogo",
    "personajes",
    "continua",
    "rotulo",
    "momentoTrailer",
    "nota",
  ] as const;
  const cambiado = campos.some((c) => JSON.stringify(b[c]) !== JSON.stringify(plano[c]));

  function guardar(extra: Partial<Plano> = {}) {
    const cuerpo: Record<string, unknown> = {};
    for (const c of campos) cuerpo[c] = b[c];
    // Solo las líneas con texto, y de quien sale en el plano.
    cuerpo.dialogo = b.dialogo.filter((l) => l.texto.trim() && l.personajeId);
    return hacer("plano", () => api.put<Produccion>(ruta, { ...cuerpo, ...extra }));
  }

  function estado(e: EstadoPlano, aviso?: string) {
    return hacer("estado", () => api.put<Produccion>(ruta, { estado: e }), aviso);
  }

  function linea(i: number, cambio: Partial<LineaDialogo>) {
    setB({ ...b, dialogo: b.dialogo.map((l, j) => (j === i ? { ...l, ...cambio } : l)) });
  }

  function alternarPersonaje(id: string) {
    const dentro = b.personajes.includes(id);
    const lista = dentro ? b.personajes.filter((x) => x !== id) : [...b.personajes, id];
    // Con referencias, Veo solo hace planos de 8 s.
    setB({
      ...b,
      personajes: lista,
      duracion: lista.length && esVeo ? 8 : b.duracion,
      dialogo: dentro ? b.dialogo.filter((l) => l.personajeId !== id) : b.dialogo,
    });
  }

  const enPlano = personajes.filter((p) => b.personajes.includes(p.id));
  const palabras = b.dialogo.reduce((n, l) => n + l.texto.trim().split(/\s+/).filter(Boolean).length, 0);

  return (
    <div className="item">
      <div className="fila">
        <strong>
          {plano.numero}. {plano.nombreParte}
        </strong>
        <span className="suave">
          {esVeo ? "Veo" : "Cartón"} · {plano.duracion} s{plano.momentoTrailer ? "" : " · solo avance"}
        </span>
        {esVeo && <span className={`estado ${CLASE_ESTADO[plano.estado]}`}>{ESTADOS[plano.estado]}</span>}
        <span style={{ marginLeft: "auto" }} />
        <button onClick={() => alSubir?.()} disabled={!alSubir || ocupado} aria-label="Subir plano">
          ↑
        </button>
        <button onClick={() => alBajar?.()} disabled={!alBajar || ocupado} aria-label="Bajar plano">
          ↓
        </button>
        <button onClick={() => setAbierto(!abierto)}>{abierto ? "Plegar" : "Abrir"}</button>
      </div>
      {!abierto && esVeo && plano.accion && <p className="suave">{plano.accion}</p>}
      {!abierto && !esVeo && plano.rotulo && <p className="suave">«{plano.rotulo}»</p>}

      {abierto && (
        <>
          {plano.avisos.length > 0 && (
            <div className="aviso error" style={{ marginTop: 8 }}>
              {plano.avisos.map((a) => (
                <div key={a}>{a}</div>
              ))}
            </div>
          )}
          <div className="campos" style={{ marginTop: 8 }}>
            <div>
              <label htmlFor={`tipo-${b.id}`}>Tipo</label>
              <select
                id={`tipo-${b.id}`}
                value={b.tipo}
                onChange={(e) => {
                  const tipo = e.target.value as Plano["tipo"];
                  setB({ ...b, tipo, duracion: tipo === "veo" ? 8 : Math.min(b.duracion, 4) });
                }}
              >
                <option value="veo">Plano de Veo</option>
                <option value="carton">Cartón (texto sobre negro)</option>
              </select>
            </div>
            <div>
              <label htmlFor={`parte-${b.id}`}>Parte del tráiler</label>
              <select id={`parte-${b.id}`} value={b.parte} onChange={(e) => setB({ ...b, parte: e.target.value as ParteTrailer })}>
                {PARTES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`dur-${b.id}`}>Duración (s)</label>
              {esVeo ? (
                <select id={`dur-${b.id}`} value={b.duracion} onChange={(e) => setB({ ...b, duracion: Number(e.target.value) })}>
                  {DURACIONES_VEO.map((d) => (
                    <option key={d} value={d} disabled={b.personajes.length > 0 && d !== 8}>
                      {d} s{b.personajes.length > 0 && d !== 8 ? " (no con referencias)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`dur-${b.id}`}
                  type="number"
                  min={1}
                  max={8}
                  value={b.duracion}
                  onChange={(e) => setB({ ...b, duracion: Math.min(8, Math.max(1, Math.round(Number(e.target.value) || 3))) })}
                />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, justifyContent: "flex-end" }}>
              <label className="casilla">
                <input
                  type="checkbox"
                  checked={b.momentoTrailer}
                  onChange={(e) => setB({ ...b, momentoTrailer: e.target.checked })}
                />
                Entra en el tráiler
              </label>
              {esVeo && (
                <label className="casilla">
                  <input type="checkbox" checked={b.continua} onChange={(e) => setB({ ...b, continua: e.target.checked })} />
                  Continúa del anterior
                </label>
              )}
            </div>

            {esVeo && (
              <>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor={`acc-${b.id}`}>Acción (en inglés: qué se ve)</label>
                  <textarea id={`acc-${b.id}`} rows={2} value={b.accion} onChange={(e) => setB({ ...b, accion: e.target.value })} />
                </div>
                <div>
                  <label htmlFor={`cam-${b.id}`}>Cámara</label>
                  <input id={`cam-${b.id}`} value={b.camara} onChange={(e) => setB({ ...b, camara: e.target.value })} />
                </div>
                <div>
                  <label htmlFor={`son-${b.id}`}>Sonido (ambiente, efectos)</label>
                  <input id={`son-${b.id}`} value={b.sonido} onChange={(e) => setB({ ...b, sonido: e.target.value })} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>Quién sale (hasta {MAX_REFERENCIAS}: son sus imágenes de referencia)</label>
                  <div className="fila">
                    {personajes.map((p) => (
                      <label className="casilla" key={p.id}>
                        <input
                          type="checkbox"
                          checked={b.personajes.includes(p.id)}
                          disabled={!b.personajes.includes(p.id) && b.personajes.length >= MAX_REFERENCIAS}
                          onChange={() => alternarPersonaje(p.id)}
                        />
                        {p.nombre}
                        {!p.medioId && <span className="suave">(sin imagen)</span>}
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>
                    Diálogo · {palabras} palabras{" "}
                    <span className="suave">(en {b.duracion} s caben unas {Math.round((15 * b.duracion) / 8)} dichas con calma)</span>
                  </label>
                  <div className="lista">
                    {b.dialogo.map((l, i) => (
                      <div className="fila" key={i}>
                        <select
                          aria-label="Quién lo dice"
                          value={l.personajeId}
                          onChange={(e) => linea(i, { personajeId: e.target.value })}
                          style={{ width: "auto" }}
                        >
                          {enPlano.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nombre}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label="Lo que dice"
                          value={l.texto}
                          style={{ flex: 1, width: "auto" }}
                          onChange={(e) => linea(i, { texto: e.target.value })}
                        />
                        <button onClick={() => setB({ ...b, dialogo: b.dialogo.filter((_, j) => j !== i) })}>Quitar</button>
                      </div>
                    ))}
                  </div>
                  <div className="pie" style={{ marginTop: 6 }}>
                    <button
                      disabled={!enPlano.length || b.dialogo.length >= 2}
                      onClick={() => setB({ ...b, dialogo: [...b.dialogo, { personajeId: enPlano[0].id, texto: "" }] })}
                    >
                      Añadir línea
                    </button>
                    {!enPlano.length && <span className="suave">Marca antes quién sale.</span>}
                  </div>
                </div>
              </>
            )}

            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor={`rot-${b.id}`}>
                {esVeo ? "Rótulo encima (p. ej. el nombre del personaje; vacío si nada)" : "Texto del cartón"}
              </label>
              <input id={`rot-${b.id}`} value={b.rotulo} onChange={(e) => setB({ ...b, rotulo: e.target.value })} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor={`nota-${b.id}`}>Nota (para ti: qué falló, qué repetir)</label>
              <input id={`nota-${b.id}`} value={b.nota} onChange={(e) => setB({ ...b, nota: e.target.value })} />
            </div>
          </div>

          <div className="pie">
            <button className="primario" disabled={!cambiado || ocupado} onClick={() => guardar()}>
              Guardar plano
            </button>
            <button
              disabled={ocupado}
              onClick={() => {
                if (window.confirm(`¿Quitar el plano ${plano.numero}?`)) hacer("plano", () => api.borrar<Produccion>(ruta));
              }}
            >
              Quitar
            </button>
          </div>

          {esVeo && (
            <>
              <h3 style={{ marginTop: 12 }}>Generarlo en Veo</h3>
              {cambiado && <p className="suave">Guarda antes: el prompt es el de lo guardado.</p>}
              <pre>{plano.promptVeo}</pre>
              <div className="pie">
                <button
                  className="primario"
                  onClick={async () => {
                    const hecho = await copiar(plano.promptVeo);
                    setCopiado(hecho);
                    window.setTimeout(() => setCopiado(false), 2000);
                    if (hecho && (plano.estado === "PENDIENTE" || plano.estado === "REGENERAR")) estado("PROMPT_COPIADO");
                  }}
                >
                  {copiado ? "Copiado" : "Copiar prompt de Veo"}
                </button>
                {enPlano
                  .filter((p) => p.medioId)
                  .map((p) => (
                    <a key={p.id} className="boton" href={`/api/medios/${p.medioId}/ver`} download>
                      Referencia: {p.nombre}
                    </a>
                  ))}
                {plano.primerFotograma && (
                  <a className="boton" href={plano.primerFotograma} download>
                    Primer fotograma (del plano anterior)
                  </a>
                )}
              </div>

              <h3 style={{ marginTop: 12 }}>El vídeo</h3>
              {plano.medioId ? (
                <video
                  src={`/api/medios/${plano.medioId}/ver`}
                  controls
                  preload="metadata"
                  style={{ width: "100%", maxHeight: 360, background: "#000", borderRadius: 8 }}
                />
              ) : (
                <p className="suave">Todavía no hay vídeo.</p>
              )}
              <div className="pie">
                <label className="boton" style={{ margin: 0 }}>
                  {plano.medioId ? "Subir otra versión" : "Subir el vídeo de Veo"}
                  <input
                    type="file"
                    accept="video/*"
                    hidden
                    disabled={ocupado}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) hacer("video", () => api.subir<Produccion>(`${ruta}/video`, f), `Vídeo del plano ${plano.numero} subido.`);
                    }}
                  />
                </label>
                {plano.medioId && plano.estado !== "APROBADO" && (
                  <button className="primario" disabled={ocupado} onClick={() => estado("APROBADO", `Plano ${plano.numero} aprobado.`)}>
                    Aprobar
                  </button>
                )}
                {plano.medioId && plano.estado !== "REGENERAR" && (
                  <button disabled={ocupado} onClick={() => estado("REGENERAR")}>
                    Hay que repetirlo
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Montar({
  catalogo,
  pr,
  alMontar,
}: {
  catalogo: Catalogo;
  pr: Produccion;
  alMontar: (proyectoId: string) => void;
}) {
  const [que, setQue] = useState<"trailer" | "avance" | "personaje">("trailer");
  const [personajeId, setPersonajeId] = useState(pr.personajes[0]?.id ?? "");
  const [musica, setMusica] = useState<string | null>(null);
  const [volumen, setVolumen] = useState(0.35);
  const [musicas, setMusicas] = useState(catalogo.musica);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  const conVideo = pr.planos.filter((p) => p.tipo === "veo" && p.medioId);
  const delTrailer = conVideo.filter((p) => p.momentoTrailer);
  const dePersonaje = conVideo.filter((p) => p.personajes.includes(personajeId));
  const hay = que === "trailer" ? delTrailer.length : que === "avance" ? pr.planos.length : dePersonaje.length;

  async function montar() {
    setOcupado(true);
    setError("");
    try {
      const p = await api.post<{ id: string }>(`/api/producciones/${pr.id}/montar`, {
        que,
        personajeId: que === "personaje" ? personajeId : undefined,
        musica,
        volumenMusica: volumen,
      });
      alMontar(p.id);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="tarjeta">
      <h2>4. Montar</h2>
      <p className="suave">
        Crea un proyecto en el editor con lo que haya ahora; se puede repetir cuando lleguen más planos. El
        tráiler usa los planos con vídeo marcados para el tráiler (subidos o aprobados). El avance enseña todos
        en orden, con un cartón gris donde falta el vídeo: sirve para ver cómo va. El teaser de un personaje
        junta sus planos.
      </p>
      {error && <p className="aviso error">{error}</p>}
      <div className="campos">
        <div>
          <label htmlFor="queMontar">Qué montar</label>
          <select id="queMontar" value={que} onChange={(e) => setQue(e.target.value as typeof que)}>
            <option value="trailer">Tráiler ({delTrailer.length} planos con vídeo)</option>
            <option value="avance">Avance de la producción</option>
            <option value="personaje" disabled={!pr.personajes.length}>
              Teaser de un personaje
            </option>
          </select>
        </div>
        {que === "personaje" && (
          <div>
            <label htmlFor="pjMontar">Personaje</label>
            <select id="pjMontar" value={personajeId} onChange={(e) => setPersonajeId(e.target.value)}>
              {pr.personajes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
        <SelectorMusica
          catalogo={{ ...catalogo, musica: musicas }}
          valor={musica}
          alCambiar={setMusica}
          alAmpliar={setMusicas}
        />
        {musica && (
          <div>
            <label htmlFor="volMontar">Volumen de la música ({Math.round(volumen * 100)} %)</label>
            <input
              id="volMontar"
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={volumen}
              onChange={(e) => setVolumen(Number(e.target.value))}
            />
          </div>
        )}
      </div>
      <p className="suave">
        El sonido de cada plano (diálogo y ambiente de Veo) se conserva; la música baja sola cuando alguien habla.
      </p>
      <div className="pie">
        <button className="primario" onClick={montar} disabled={ocupado || !hay}>
          {ocupado ? "Montando..." : "Montar y abrir en el editor"}
        </button>
        {!hay && <span className="suave">Todavía no hay vídeos para esto.</span>}
      </div>
    </section>
  );
}
