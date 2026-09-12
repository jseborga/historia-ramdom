import { useState } from "react";
import { api, type ParteMusica } from "../api";
import { mensajeDe } from "../App";
import { ListaCanciones, entradaVacia, entradaLista, prepararFuentes, type EntradaCancion } from "./ListaCanciones";

const reloj = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/**
 * Las canciones del videoclip: se pueden encadenar varias para que dure más.
 * La lista de arriba edita lo que ya está montado (título y letra, sin tocar
 * el audio); la de abajo rehace la pista entera.
 */
export function PanelCanciones({
  proyectoId,
  partes,
  musicaDisponible,
  alCambiar,
  alMontar,
}: {
  proyectoId: string;
  partes: ParteMusica[];
  musicaDisponible: string[];
  alCambiar: (partes: ParteMusica[]) => void;
  alMontar: () => void;
}) {
  const [edicion, setEdicion] = useState<ParteMusica[]>(partes);
  const [nuevas, setNuevas] = useState<EntradaCancion[]>([]);
  const [cruce, setCruce] = useState(1.5);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const listas = nuevas.filter(entradaLista);

  async function guardarPartes() {
    setOcupado("guardar");
    setError("");
    setOk("");
    try {
      const r = await api.patch<{ partes: ParteMusica[] }>(`/api/proyectos/${proyectoId}/canciones`, {
        partes: edicion.map((p) => ({ archivo: p.archivo, titulo: p.titulo, letra: p.letra })),
      });
      alCambiar(r.partes);
      setOk("Guardado. Para que cada cancion use su letra nueva, vuelve a montar.");
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  /** Rehace la pista entera con la lista de abajo (más lo que ya había). */
  async function unir(conLasDeAhora: boolean) {
    setOcupado("unir");
    setError("");
    setOk("");
    try {
      const subidas = await prepararFuentes(proyectoId, nuevas);
      const previas = conLasDeAhora
        ? edicion.map((p) => ({ tipo: "proyecto" as const, valor: p.archivo, titulo: p.titulo, letra: p.letra }))
        : [];
      const fuentes = [...previas, ...subidas];
      if (!fuentes.length) {
        setError("No hay ninguna cancion en la lista.");
        return;
      }
      await api.post(`/api/proyectos/${proyectoId}/canciones`, { fuentes, cruce });
      setNuevas([]);
      setOk("Encadenando las canciones y montando encima. Esta pagina se actualiza sola.");
      alMontar();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  return (
    <section className="tarjeta">
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      {partes.length > 0 ? (
        <>
          <p className="suave">
            {partes.length === 1
              ? "El videoclip tiene una cancion. Añade mas abajo para alargarlo."
              : `${partes.length} canciones encadenadas. Cada una reparte sus propios tramos.`}
          </p>
          <div className="lista">
            {edicion.map((p, i) => (
              <div className="item" key={p.archivo}>
                <div className="fila">
                  <strong>
                    {reloj(p.inicio)} → {reloj(p.inicio + p.duracion)}
                  </strong>
                  <input
                    aria-label={`Titulo de la cancion ${i + 1}`}
                    style={{ maxWidth: 260 }}
                    value={p.titulo}
                    onChange={(e) =>
                      setEdicion(edicion.map((x) => (x.archivo === p.archivo ? { ...x, titulo: e.target.value } : x)))
                    }
                  />
                  {p.enlace && (
                    <a className="suave" href={p.enlace} target="_blank" rel="noreferrer">
                      ver en Suno
                    </a>
                  )}
                </div>
                <textarea
                  aria-label={`Letra de la cancion ${i + 1}`}
                  placeholder="Letra de esta cancion (vacio = tramos por los lineamientos)"
                  value={p.letra}
                  onChange={(e) =>
                    setEdicion(edicion.map((x) => (x.archivo === p.archivo ? { ...x, letra: e.target.value } : x)))
                  }
                />
              </div>
            ))}
          </div>
          <div className="pie">
            <button onClick={guardarPartes} disabled={ocupado !== ""}>
              {ocupado === "guardar" ? "Guardando..." : "Guardar titulos y letras"}
            </button>
          </div>
        </>
      ) : (
        <p className="suave">
          Este videoclip usa una sola pista suelta. Si añades canciones aqui, se encadenan en una
          sola y cada una llevara su letra.
        </p>
      )}

      <h3 style={{ marginTop: 16 }}>Añadir canciones</h3>
      {nuevas.length === 0 ? (
        <div className="pie">
          <button onClick={() => setNuevas([entradaVacia()])}>Añadir una cancion</button>
          <span className="suave">De Suno, de la biblioteca o subiendo el archivo.</span>
        </div>
      ) : (
        <>
          <ListaCanciones entradas={nuevas} alCambiar={setNuevas} musicaDisponible={musicaDisponible} />
          <div className="campos" style={{ marginTop: 12 }}>
            <div>
              <label htmlFor="cruce">Cruce entre canciones ({cruce.toFixed(1)} s)</label>
              <input
                id="cruce"
                type="range"
                min={0}
                max={6}
                step={0.5}
                value={cruce}
                onChange={(e) => setCruce(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="pie">
            <button className="primario" onClick={() => unir(true)} disabled={ocupado !== "" || !listas.length}>
              {ocupado === "unir" ? "Uniendo..." : `Añadir al final y montar (${listas.length})`}
            </button>
            <button onClick={() => unir(false)} disabled={ocupado !== "" || !listas.length}>
              Sustituir la pista por estas
            </button>
            <button onClick={() => setNuevas([])} disabled={ocupado !== ""}>
              Cancelar
            </button>
          </div>
          <p className="suave">
            Al unir se rehace la pista de audio y se vuelve a montar la imagen. Los cortes ya hechos
            no se tocan, pero conviene rehacerlos porque el tiempo cambia.
          </p>
        </>
      )}
    </section>
  );
}
