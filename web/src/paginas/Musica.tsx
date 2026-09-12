import { useCallback, useEffect, useState } from "react";
import { api, type Catalogo, type Preset, type Proyecto } from "../api";
import { mensajeDe } from "../App";
import { ImportarSuno } from "./comunes";
import { EditorMontaje } from "./EditorMontaje";

type Resumen = Pick<Proyecto, "id" | "nombre" | "tipo" | "formato" | "estado" | "archivo" | "duracionSeg" | "error" | "editadoEn">;

/**
 * Videoclip musical: el mismo editor de montaje, pero manda la cancion.
 * La letra decide que se ve en cada tramo; si el tema es instrumental, lo
 * deciden los lineamientos que escribas.
 */
export function Musica({ catalogo }: { catalogo: Catalogo }) {
  const [proyectos, setProyectos] = useState<Resumen[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [musicaLista, setMusicaLista] = useState<string[]>(catalogo.musica);
  const [abierto, setAbierto] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [formato, setFormato] = useState("tiktok");
  const [origen, setOrigen] = useState<"suno" | "biblioteca">("suno");
  const [enlaceSuno, setEnlaceSuno] = useState("");
  const [pista, setPista] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [letra, setLetra] = useState("");
  const [lineamientos, setLineamientos] = useState("");
  const [mostrarLetra, setMostrarLetra] = useState(true);

  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const cargar = useCallback(async () => {
    try {
      const [p, pr] = await Promise.all([
        api.get<Resumen[]>("/api/proyectos"),
        api.get<Preset[]>("/api/presets"),
      ]);
      setProyectos(p.filter((x) => x.tipo === "MUSICA"));
      setPresets(pr);
    } catch (err) {
      setError(mensajeDe(err));
    }
  }, []);

  useEffect(() => {
    if (!abierto) cargar();
  }, [cargar, abierto]);

  if (abierto) {
    return <EditorMontaje id={abierto} catalogo={catalogo} alSalir={() => setAbierto(null)} />;
  }

  const listo =
    (origen === "suno" ? /suno\.(com|ai)\//.test(enlaceSuno) : Boolean(pista)) &&
    (instrumental ? lineamientos.trim().length > 10 : letra.trim().length > 20);

  async function crear() {
    setOcupado(true);
    setError("");
    setOk("");
    try {
      const p = await api.post<Proyecto>("/api/proyectos/musical", {
        nombre: nombre.trim() || undefined,
        formato,
        enlaceSuno: origen === "suno" ? enlaceSuno.trim() : undefined,
        musica: origen === "biblioteca" ? pista : undefined,
        letra: instrumental ? undefined : letra,
        lineamientos: lineamientos.trim() || undefined,
        instrumental,
        mostrarLetra,
      });
      setOk("Videoclip en montaje: la cancion manda la duracion y los clips se buscan solos.");
      setAbierto(p.id);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado(false);
    }
  }

  async function borrar(id: string) {
    if (!confirm("Borrar este videoclip?")) return;
    try {
      await api.borrar(`/api/proyectos/${id}`);
      await cargar();
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>Nuevo videoclip</h2>
        <p className="suave">
          La cancion decide cuanto dura el video. Con letra, cada tramo (intro, verso, coro) busca
          sus propias imagenes; si es instrumental, escribe tu que quieres ver. Despues, en el
          editor, sacas la version completa y los cortes de 30 segundos en cada formato.
        </p>

        <div className="campos">
          <div>
            <label htmlFor="nombreVc">Titulo</label>
            <input
              id="nombreVc"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="El nombre de la cancion"
            />
          </div>
          <div>
            <label htmlFor="fmtVc">Formato principal</label>
            <select id="fmtVc" value={formato} onChange={(e) => setFormato(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="origenVc">De donde sale la cancion</label>
            <select
              id="origenVc"
              value={origen}
              onChange={(e) => setOrigen(e.target.value as "suno" | "biblioteca")}
            >
              <option value="suno">Enlace de Suno</option>
              <option value="biblioteca">Pista de la biblioteca</option>
            </select>
          </div>
          {origen === "biblioteca" && (
            <div>
              <label htmlFor="pistaVc">Pista</label>
              <select id="pistaVc" value={pista} onChange={(e) => setPista(e.target.value)}>
                <option value="">Elige una</option>
                {musicaLista.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="tipoLetra">La cancion</label>
            <select
              id="tipoLetra"
              value={instrumental ? "instrumental" : "letra"}
              onChange={(e) => setInstrumental(e.target.value === "instrumental")}
            >
              <option value="letra">Tiene letra</option>
              <option value="instrumental">Es instrumental</option>
            </select>
          </div>
          {!instrumental && (
            <div>
              <label htmlFor="quemar">Letra en pantalla</label>
              <select
                id="quemar"
                value={mostrarLetra ? "si" : "no"}
                onChange={(e) => setMostrarLetra(e.target.value === "si")}
              >
                <option value="si">Mostrar la letra sobre el video</option>
                <option value="no">Solo imagen, sin letra</option>
              </select>
            </div>
          )}
        </div>

        {origen === "suno" && (
          <div style={{ marginTop: 12 }}>
            <label htmlFor="enlaceVc">Enlace de la cancion en Suno</label>
            <input
              id="enlaceVc"
              placeholder="https://suno.com/song/..."
              value={enlaceSuno}
              onChange={(e) => setEnlaceSuno(e.target.value)}
            />
            <p className="suave">
              Se descarga al proyecto y sus creditos se añaden solos. Si Suno no la deja bajar,
              descargala tu y subela en el editor, en la pestaña Musica.
            </p>
          </div>
        )}

        {origen === "biblioteca" && (
          <div style={{ marginTop: 12 }}>
            <ImportarSuno
              alImportar={(archivo, musica) => {
                if (musica) setMusicaLista(musica);
                setPista(archivo);
              }}
            />
          </div>
        )}

        {!instrumental && (
          <div style={{ marginTop: 12 }}>
            <label htmlFor="letraVc">Letra (pegala tal cual, con sus etiquetas si las trae)</label>
            <textarea
              id="letraVc"
              style={{ minHeight: 200 }}
              value={letra}
              onChange={(e) => setLetra(e.target.value)}
              placeholder={"[Verso 1]\nCamino solo por la avenida\n...\n\n[Coro]\n..."}
            />
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <label htmlFor="lineaVc">
            {instrumental
              ? "Lineamientos: que quieres ver (obligatorio en instrumentales)"
              : "Lineamientos de imagen (opcional): ambiente, colores, que evitar"}
          </label>
          <textarea
            id="lineaVc"
            value={lineamientos}
            onChange={(e) => setLineamientos(e.target.value)}
            placeholder={
              instrumental
                ? "Paisajes de montaña al amanecer, niebla, camara lenta, nada de ciudad ni gente."
                : "Noche urbana, lluvia y neones; planos largos, sin gente mirando a camara."
            }
          />
        </div>

        <div className="pie">
          <button className="primario" onClick={crear} disabled={!listo || ocupado}>
            {ocupado ? "Montando..." : "Crear videoclip"}
          </button>
          <span className="suave">
            {listo
              ? "Se monta en segundo plano; el editor se abre enseguida."
              : instrumental
                ? "Falta la cancion o los lineamientos."
                : "Falta la cancion o la letra."}
          </span>
        </div>
      </section>

      <section className="tarjeta">
        <h2>Videoclips</h2>
        {proyectos.length === 0 && <p className="suave">Todavia no hay ninguno.</p>}
        <div className="lista">
          {proyectos.map((p) => (
            <div className="item" key={p.id}>
              <div className="fila">
                <span className={`estado ${p.estado === "LISTO" ? "LISTA" : p.estado}`}>{p.estado}</span>
                <strong>{p.nombre}</strong>
                <span className="suave">
                  {p.formato}
                  {p.duracionSeg ? ` · ${p.duracionSeg.toFixed(1)}s` : ""} ·{" "}
                  {new Date(p.editadoEn).toLocaleString()}
                </span>
              </div>
              {p.error && <pre>{p.error}</pre>}
              <div className="pie">
                <button onClick={() => setAbierto(p.id)}>Abrir editor</button>
                {p.archivo && (
                  <a className="boton" href={`/api/proyectos/${p.id}/descargar`}>
                    Descargar MP4
                  </a>
                )}
                <button onClick={() => borrar(p.id)}>Borrar</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
