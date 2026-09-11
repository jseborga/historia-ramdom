import { useState } from "react";
import {
  aISO,
  api,
  type Catalogo,
  type Guion,
  type Idioma,
  type ModoPublicacion,
  type Voz,
} from "../api";
import { mensajeDe } from "../App";
import { CampoFecha, SelectorModo, SelectorMotor, SelectorMusica, SelectorVoz } from "./comunes";

export function Editor({ catalogo }: { catalogo: Catalogo }) {
  const [tipo, setTipo] = useState<"Reflexion" | "Historia">("Reflexion");
  const [tema, setTema] = useState("");
  const [duracion, setDuracion] = useState(65);
  const [motor, setMotor] = useState(
    catalogo.motores.find((m) => m.disponible)?.id ?? "groq",
  );
  const [modelo, setModelo] = useState<string | null>(null);
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [voz, setVoz] = useState<Voz>(catalogo.vozPorDefecto);
  const [musica, setMusica] = useState<string | null>(null);
  const [modo, setModo] = useState<ModoPublicacion>("DESCARGA");
  const [publicarEn, setPublicarEn] = useState("");

  const [guion, setGuion] = useState<Guion | null>(null);
  const [cargando, setCargando] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const tiktokListo = catalogo.tiktok.configurado && catalogo.tiktok.cuentasConectadas > 0;
  const sinClips = !catalogo.clips.pexels && !catalogo.clips.pixabay;

  async function escribirGuion() {
    setCargando("guion");
    setError("");
    setOk("");
    try {
      setGuion(
        await api.post<Guion>("/api/guion", {
          motor,
          modelo,
          tipo,
          tema: tema || undefined,
          duracion,
          idioma,
        }),
      );
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
        voz,
        musica,
        modoPublicacion: modo,
        guion: guion ?? undefined,
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
              max={180}
              value={duracion}
              onChange={(e) => setDuracion(Number(e.target.value))}
            />
          </div>
          <SelectorMotor
            catalogo={catalogo}
            valor={motor}
            alCambiar={setMotor}
            modelo={modelo}
            alCambiarModelo={setModelo}
          />
        </div>
        <div className="pie">
          <button onClick={escribirGuion} disabled={cargando !== ""}>
            {cargando === "guion" ? "Escribiendo..." : "Escribir guion"}
          </button>
        </div>
      </section>

      {guion && (
        <section className="tarjeta">
          <h2>2. Escenas</h2>
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
          {guion.hashtags.length > 0 && (
            <p className="suave" style={{ marginTop: 12 }}>
              Hashtags: {guion.hashtags.map((h) => `#${h}`).join(" ")}
            </p>
          )}
        </section>
      )}

      <section className="tarjeta">
        <h2>3. Voz y video</h2>
        <div className="campos">
          <SelectorVoz catalogo={catalogo} valor={voz} alCambiar={setVoz} />
          <SelectorMusica catalogo={catalogo} valor={musica} alCambiar={setMusica} />
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
