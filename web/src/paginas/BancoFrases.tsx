import { useCallback, useEffect, useState } from "react";
import { api, type Catalogo, type Frase, type Idioma, type LineaPegada, type TemaBanco, type TonoSadButTrue } from "../api";
import { mensajeDe } from "../App";
import { nombreIdioma } from "./comunes";

/**
 * El banco de frases de "Sad but true".
 *
 * Es una vista aparte de la de hacer vídeos porque son dos trabajos
 * distintos: aquí se junta material —de una sentada, pegando una lista— y
 * allí se monta. Lo que entra aquí es de lo que salen los sorteos sin gastar
 * IA, así que cuanto más hay, menos se repite.
 *
 * Nada se guarda a ciegas: lo pegado se enseña primero partido en columnas, y
 * ahí se ve de un vistazo qué entendió la app por palabra, por frase y por
 * remate. Guardar un texto pegado sin mirarlo es la forma más rápida de
 * llenar el banco de basura.
 */

const EJEMPLO = `# Lo que ibas a empezar
El gimnasio ; Pagaste enero entero para ir cuatro veces.
Ese libro ; Vas por la pagina 40 desde hace dos años. ; Nadie fracasa el primer dia.
Nadie te va a dar permiso. Ese es el tramite que no existe.`;

const TONOS: [TonoSadButTrue, string][] = [
  ["reflexiva", "reflexiva"],
  ["feliz", "feliz"],
  ["triste", "triste"],
  ["desmotivadora", "desmotivadora"],
];

export function BancoFrases({ catalogo }: { catalogo: Catalogo }) {
  const [texto, setTexto] = useState("");
  const [tema, setTema] = useState("");
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [tono, setTono] = useState<TonoSadButTrue>("reflexiva");
  const [lineas, setLineas] = useState<LineaPegada[] | null>(null);
  const [listas, setListas] = useState(0);
  const [frases, setFrases] = useState<Frase[]>([]);
  const [temas, setTemas] = useState<TemaBanco[]>([]);
  const [filtroTema, setFiltroTema] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [buscar, setBuscar] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const cargar = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (filtroTema) q.set("tema", filtroTema);
      if (filtroTipo) q.set("tipo", filtroTipo);
      if (buscar.trim()) q.set("buscar", buscar.trim());
      const r = await api.get<{ frases: Frase[]; temas: TemaBanco[] }>(`/api/frases?${q}`);
      setFrases(r.frases);
      setTemas(r.temas);
    } catch (err) {
      setError(mensajeDe(err));
    }
  }, [filtroTema, filtroTipo, buscar]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /** Sin guardar nada: solo qué ha entendido de cada linea. */
  async function revisar() {
    if (!texto.trim()) return;
    setOcupado("revisar");
    setError("");
    setOk("");
    try {
      const r = await api.post<{ lineas: LineaPegada[]; listas: number }>("/api/frases/pegar", {
        texto,
        tema,
        idioma,
        tono,
        guardar: false,
      });
      setLineas(r.lineas);
      setListas(r.listas);
      const malas = r.lineas.filter((l) => l.error).length;
      setOk(
        `${r.listas} entrada(s) listas para guardar${malas ? `, y ${malas} linea(s) con algo raro` : ""}.` +
          " Mira las columnas antes de guardar.",
      );
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  async function guardar() {
    setOcupado("guardar");
    setError("");
    setOk("");
    try {
      const r = await api.post<{ nuevas: number; repetidas: number; listas: number }>("/api/frases/pegar", {
        texto,
        tema,
        idioma,
        tono,
        guardar: true,
      });
      setOk(
        `Guardadas ${r.nuevas}${r.repetidas ? `, y ${r.repetidas} ya estaban` : ""}. ` +
          "Ya pueden salir sorteadas.",
      );
      setTexto("");
      setLineas(null);
      await cargar();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  async function borrar(id: string) {
    try {
      await api.borrar(`/api/frases/${id}`);
      setFrases(frases.filter((f) => f.id !== id));
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  const parejas = temas.reduce((s, t) => s + t.cuantas, 0);

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>Pegar frases</h2>
        <p className="suave">
          Una por linea, y el <strong>;</strong> separa los campos:
        </p>
        <pre>{`palabra ; frase             una pareja del sorteo
palabra ; frase ; remate    la pareja, y ademas ese remate
remate                      un remate suelto (sin ningun ;)`}</pre>
        <p className="suave">
          Por eso dentro de un texto no puede haber otro <strong>;</strong>: es lo que distingue cual
          es cual. Las lineas vacias y las que empiezan por <code>#</code> se saltan, asi que puedes
          pegar una lista con sus titulos dentro.
        </p>

        <div className="campos">
          <div>
            <label htmlFor="temaBanco">Tema (la familia de estas palabras)</label>
            <input
              id="temaBanco"
              value={tema}
              placeholder="lo que ibas a empezar"
              list="temas-banco"
              onChange={(e) => setTema(e.target.value)}
            />
            <datalist id="temas-banco">
              {temas.map((t) => (
                <option key={t.tema} value={t.tema} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="idiomaBanco">Idioma</label>
            <select id="idiomaBanco" value={idioma} onChange={(e) => setIdioma(e.target.value as Idioma)}>
              {catalogo.idiomas.map((i) => (
                <option key={i} value={i}>
                  {nombreIdioma(catalogo, i)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="tonoBanco">Tono de los remates que vengan</label>
            <select id="tonoBanco" value={tono} onChange={(e) => setTono(e.target.value as TonoSadButTrue)}>
              {TONOS.map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label htmlFor="pegado">Pega aqui</label>
        <textarea
          id="pegado"
          rows={10}
          value={texto}
          placeholder={EJEMPLO}
          onChange={(e) => {
            setTexto(e.target.value);
            setLineas(null);
          }}
        />

        <div className="pie">
          <button onClick={revisar} disabled={ocupado !== "" || !texto.trim()}>
            {ocupado === "revisar" ? "Mirando..." : "Ver que entiende"}
          </button>
          <button className="primario" onClick={guardar} disabled={ocupado !== "" || !lineas || !listas}>
            {ocupado === "guardar" ? "Guardando..." : `Guardar ${listas || ""}`}
          </button>
        </div>
        {!lineas && texto.trim() && (
          <p className="suave">Primero mira que ha entendido: se guarda lo que se ve en la tabla.</p>
        )}

        {lineas && (
          <table className="tabla">
            <thead>
              <tr>
                <th>Linea</th>
                <th>Palabra del bombo</th>
                <th>Frase</th>
                <th>Remate</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => (
                <tr key={l.numero} className={l.error ? "mala" : ""}>
                  <td>{l.numero}</td>
                  <td>{l.palabra || <span className="suave">—</span>}</td>
                  <td>{l.frase || <span className="suave">—</span>}</td>
                  <td>{l.remate || <span className="suave">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {lineas?.some((l) => l.error) && (
          <ul className="suave">
            {lineas
              .filter((l) => l.error)
              .map((l) => (
                <li key={l.numero}>
                  Linea {l.numero}: {l.error}
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="tarjeta">
        <h2>Lo que hay</h2>
        <p className="suave">
          {parejas} parejas en {temas.length} temas. Un tema necesita <strong>4 palabras</strong> para
          poder sortearse; con menos no parece un sorteo.
        </p>
        <div className="campos">
          <div>
            <label htmlFor="fTema">Tema</label>
            <select id="fTema" value={filtroTema} onChange={(e) => setFiltroTema(e.target.value)}>
              <option value="">todos</option>
              {temas.map((t) => (
                <option key={t.tema} value={t.tema}>
                  {t.tema} ({t.cuantas})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fTipo">Que</label>
            <select id="fTipo" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
              <option value="">todo</option>
              <option value="SORTEO">parejas del sorteo</option>
              <option value="REMATE">remates</option>
            </select>
          </div>
          <div>
            <label htmlFor="fBuscar">Buscar</label>
            <input id="fBuscar" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
          </div>
        </div>

        <div className="lista">
          {frases.map((f) => (
            <div className="item" key={f.id}>
              <div className="fila">
                <span className="estado">{f.tipo === "REMATE" ? "REMATE" : "SORTEO"}</span>
                {f.palabra && <strong>{f.palabra}</strong>}
                <span className="suave">
                  {f.tema || (f.tipo === "REMATE" ? f.tono : "sin tema")} · {f.fuente === "IA" ? "IA" : "a mano"}
                  {f.usos ? ` · usada ${f.usos}` : ""}
                </span>
                <button onClick={() => borrar(f.id)}>Borrar</button>
              </div>
              <p style={{ margin: "2px 0 0" }}>{f.texto}</p>
            </div>
          ))}
          {!frases.length && <p className="suave">Nada por aqui todavia.</p>}
        </div>
      </section>
    </>
  );
}
