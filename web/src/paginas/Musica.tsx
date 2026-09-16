import { useCallback, useEffect, useState } from "react";
import { api, type Catalogo, type Preset, type Proyecto, type Sugerencia } from "../api";
import { mensajeDe } from "../App";
import { EditorMontaje } from "./EditorMontaje";
import { Remix } from "./Remix";
import {
  ListaCanciones,
  entradaVacia,
  entradaLista,
  prepararFuentes,
  type EntradaCancion,
} from "./ListaCanciones";

type Resumen = Pick<Proyecto, "id" | "nombre" | "tipo" | "formato" | "estado" | "archivo" | "duracionSeg" | "error" | "editadoEn">;

/**
 * Videoclip musical: el mismo editor de montaje, pero manda la cancion (o
 * varias encadenadas). La letra decide que se ve en cada tramo; si el tema es
 * instrumental, lo deciden los lineamientos, que la IA puede proponer.
 */
export function Musica({ catalogo }: { catalogo: Catalogo }) {
  /** Las dos mitades del area: montar el videoclip, o escribir la cancion. */
  const [seccion, setSeccion] = useState<"videoclip" | "remix">("videoclip");
  const [proyectos, setProyectos] = useState<Resumen[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [formato, setFormato] = useState("tiktok");
  const [canciones, setCanciones] = useState<EntradaCancion[]>([entradaVacia()]);
  const [cruce, setCruce] = useState(1.5);
  const [instrumental, setInstrumental] = useState(false);
  const [lineamientos, setLineamientos] = useState("");
  const [mostrarLetra, setMostrarLetra] = useState(true);
  const [sugerencia, setSugerencia] = useState<Sugerencia | null>(null);

  const [ocupado, setOcupado] = useState("");
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
    if (!abierto && seccion === "videoclip") cargar();
  }, [cargar, abierto, seccion]);

  // Mientras algo se monta o se renderiza, la lista se actualiza sola.
  useEffect(() => {
    if (abierto || !proyectos.some((p) => p.estado === "MONTAJE" || p.estado === "RENDER")) return;
    const t = setInterval(cargar, 6000);
    return () => clearInterval(t);
  }, [abierto, proyectos, cargar]);

  if (abierto) {
    return <EditorMontaje id={abierto} catalogo={catalogo} alSalir={() => setAbierto(null)} />;
  }

  /** Una version del remix pasa a ser la cancion del videoclip. */
  function usarLetra(tituloVersion: string, letraVersion: string) {
    setNombre(tituloVersion);
    setInstrumental(false);
    setCanciones([{ ...(canciones[0] ?? entradaVacia()), titulo: tituloVersion, letra: letraVersion }]);
    setSeccion("videoclip");
    setOk("Letra puesta en el videoclip. Falta la cancion: generala en Suno y pega su enlace.");
  }

  const submenu = (
    <div className="fila" style={{ marginBottom: 12 }}>
      <button className={seccion === "videoclip" ? "primario" : ""} onClick={() => setSeccion("videoclip")}>
        Videoclip
      </button>
      <button className={seccion === "remix" ? "primario" : ""} onClick={() => setSeccion("remix")}>
        Remix de canciones
      </button>
      <span className="suave">
        {seccion === "videoclip"
          ? "Monta el video sobre una cancion que ya tienes."
          : "Escribe la cancion en otros ritmos, lista para pedirsela a Suno."}
      </span>
    </div>
  );

  if (seccion === "remix") {
    return (
      <>
        {submenu}
        <Remix catalogo={catalogo} alUsarLetra={usarLetra} />
      </>
    );
  }

  const listas = canciones.filter(entradaLista);
  const conLetra = listas.some((c) => c.letra.trim().length > 20);
  const listo = listas.length > 0 && (instrumental ? lineamientos.trim().length > 10 : conLetra || lineamientos.trim().length > 10);

  /** La IA propone el ambiente y los criterios de imagen antes de crear nada. */
  async function sugerir() {
    setOcupado("sugerir");
    setError("");
    setOk("");
    try {
      const r = await api.post<Sugerencia>("/api/lineamientos", {
        titulo: nombre,
        letra: listas.map((c) => c.letra).filter(Boolean).join("\n\n"),
        lineamientos,
        instrumental,
      });
      setSugerencia(r);
      setLineamientos(r.lineamientos);
      setOk("Propuesta puesta en los lineamientos. Cambiala a gusto antes de crear.");
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  async function crear() {
    setOcupado("crear");
    setError("");
    setOk("");
    try {
      const primera = listas[0];
      const unaSola = listas.length === 1;

      const p = await api.post<Proyecto>("/api/proyectos/musical", {
        nombre: nombre.trim() || undefined,
        formato,
        // Con una sola cancion de Suno o de la biblioteca, el montaje arranca
        // en la misma llamada; en los demas casos hace falta subir o mezclar.
        enlaceSuno: unaSola && primera.tipo === "suno" ? primera.valor.trim() : undefined,
        musica: unaSola && primera.tipo === "biblioteca" ? primera.valor : undefined,
        letra: instrumental ? undefined : listas.map((c) => c.letra).filter(Boolean).join("\n\n"),
        lineamientos: lineamientos.trim() || undefined,
        instrumental,
        mostrarLetra,
      });

      if (unaSola && primera.tipo === "archivo" && primera.archivo) {
        // Al llegar la cancion, el montaje arranca solo.
        await api.subir(`/api/proyectos/${p.id}/musica-archivo`, primera.archivo);
      } else if (!unaSola) {
        const fuentes = await prepararFuentes(p.id, listas);
        await api.post(`/api/proyectos/${p.id}/canciones`, { fuentes, cruce });
      }

      setOk(
        unaSola
          ? "Videoclip en montaje: la cancion manda la duracion y los clips se buscan solos."
          : `Encadenando ${listas.length} canciones y montando encima.`,
      );
      setAbierto(p.id);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
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
      {submenu}
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>Nuevo videoclip</h2>
        <p className="suave">
          La cancion decide cuanto dura el video, y puedes encadenar varias para que dure mas. Con
          letra, cada tramo (intro, verso, coro) busca sus propias imagenes; si es instrumental,
          escribe tu que quieres ver o pideselo a la IA. Todo queda guardado en el proyecto y se
          cambia luego en las pestañas Letra y Canciones del editor.
        </p>

        <div className="campos">
          <div>
            <label htmlFor="nombreVc">Titulo del videoclip</label>
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
            <label htmlFor="tipoLetra">Las canciones</label>
            <select
              id="tipoLetra"
              value={instrumental ? "instrumental" : "letra"}
              onChange={(e) => setInstrumental(e.target.value === "instrumental")}
            >
              <option value="letra">Tienen letra</option>
              <option value="instrumental">Son instrumentales</option>
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
          {listas.length > 1 && (
            <div>
              <label htmlFor="cruceVc">Cruce entre canciones ({cruce.toFixed(1)} s)</label>
              <input
                id="cruceVc"
                type="range"
                min={0}
                max={6}
                step={0.5}
                value={cruce}
                onChange={(e) => setCruce(Number(e.target.value))}
              />
            </div>
          )}
        </div>

        <h3 style={{ marginTop: 16 }}>Canciones</h3>
        <ListaCanciones
          entradas={canciones}
          alCambiar={setCanciones}
          musicaDisponible={catalogo.musica}
          conLetra={!instrumental}
        />

        <div style={{ marginTop: 16 }}>
          <div className="fila">
            <label htmlFor="lineaVc" style={{ margin: 0 }}>
              {instrumental
                ? "Lineamientos: que quieres ver (obligatorio en instrumentales)"
                : "Lineamientos de imagen (opcional): ambiente, colores, que evitar"}
            </label>
            <button onClick={sugerir} disabled={ocupado !== ""}>
              {ocupado === "sugerir" ? "Pensando..." : "Proponer con IA"}
            </button>
          </div>
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
          {sugerencia && (
            <div className="item" style={{ marginTop: 8 }}>
              <p className="suave">
                <strong>Estilo:</strong> {sugerencia.estiloVisual || "(sin resumen)"}
              </p>
              <p className="suave">
                <strong>Busqueda de clips:</strong> {sugerencia.keywords.join(", ") || "(ninguna)"}
              </p>
              {sugerencia.prompt && (
                <p className="suave">
                  <strong>Prompt de imagen:</strong> {sugerencia.prompt}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="pie">
          <button className="primario" onClick={crear} disabled={!listo || ocupado !== ""}>
            {ocupado === "crear" ? "Creando..." : "Crear videoclip"}
          </button>
          <span className="suave">
            {listo
              ? "Se monta en segundo plano; el editor se abre enseguida."
              : !listas.length
                ? "Falta la cancion: pega el enlace de Suno, sube un archivo o elige una pista."
                : instrumental
                  ? "Faltan los lineamientos: di que quieres ver."
                  : "Falta la letra de alguna cancion, o unos lineamientos."}
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
                <span className={`estado ${p.estado === "LISTO" ? "LISTA" : p.estado}`}>
                  {p.estado === "MONTAJE" ? "MONTANDO" : p.estado}
                </span>
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
