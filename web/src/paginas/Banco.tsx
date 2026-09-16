import { useCallback, useEffect, useState } from "react";
import { api, type Catalogo, type Gancho, type Idea, type Idioma, type Rendimiento } from "../api";
import { mensajeDe } from "../App";
import { nombreIdioma } from "./comunes";

const nota = (v: number | null) => (v === null ? "sin datos" : `${v} pts`);

export function Banco({ catalogo }: { catalogo: Catalogo }) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [ganchos, setGanchos] = useState<Gancho[]>([]);
  const [rendimiento, setRendimiento] = useState<Rendimiento | null>(null);
  const [filtro, setFiltro] = useState<"PENDIENTE" | "USADA" | "DESCARTADA" | "">("PENDIENTE");
  const [nuevas, setNuevas] = useState("");
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const cargar = useCallback(async () => {
    try {
      const [i, g, r] = await Promise.all([
        api.get<Idea[]>(`/api/ideas${filtro ? `?estado=${filtro}` : ""}`),
        api.get<Gancho[]>("/api/ganchos"),
        api.get<Rendimiento>("/api/rendimiento"),
      ]);
      setIdeas(i);
      setGanchos(g);
      setRendimiento(r);
    } catch (err) {
      setError(mensajeDe(err));
    }
  }, [filtro]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function accion(fn: () => Promise<unknown>, mensaje: string) {
    setError("");
    setOk("");
    try {
      await fn();
      setOk(mensaje);
      await cargar();
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  function agregar() {
    // Una idea por linea; con "titulo | tema" se separan los dos campos.
    const lote = nuevas
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((linea) => {
        const [titulo, tema] = linea.split("|").map((t) => t.trim());
        return { titulo, tema: tema || titulo, idioma };
      });
    if (!lote.length) return;
    accion(() => api.post("/api/ideas", lote), `${lote.length} ideas anadidas.`).then(() =>
      setNuevas(""),
    );
  }

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>Anadir ideas al banco</h2>
        <p className="suave">
          Una por linea. Si escribes <code>titulo | tema</code> se guardan por separado.
        </p>
        <textarea value={nuevas} onChange={(e) => setNuevas(e.target.value)} />
        <div className="pie">
          <select
            value={idioma}
            style={{ width: "auto" }}
            onChange={(e) => setIdioma(e.target.value as Idioma)}
          >
            {catalogo.idiomas.map((i) => (
              <option key={i} value={i}>
                {nombreIdioma(catalogo, i)}
              </option>
            ))}
          </select>
          <button className="primario" onClick={agregar} disabled={!nuevas.trim()}>
            Anadir
          </button>
          {catalogo.reddit.configurado ? (
            <button
              onClick={() =>
                accion(() => api.post("/api/ideas/buscar"), "Busqueda de temas encolada.")
              }
            >
              Buscar temas en Reddit
            </button>
          ) : (
            <span className="suave">Reddit desactivado (REDDIT_ACTIVO=false)</span>
          )}
        </div>
      </section>

      <section className="tarjeta">
        <div className="fila" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Banco de historias</h2>
          <select
            value={filtro}
            style={{ width: "auto" }}
            onChange={(e) => setFiltro(e.target.value as typeof filtro)}
          >
            <option value="PENDIENTE">Pendientes</option>
            <option value="USADA">Usadas</option>
            <option value="DESCARTADA">Descartadas</option>
            <option value="">Todas</option>
          </select>
        </div>

        {ideas.length === 0 && <p className="suave">No hay ideas con ese filtro.</p>}
        <div className="lista">
          {ideas.map((i) => (
            <div className="item" key={i.id}>
              <div className="fila">
                <span className="estado">{i.estado}</span>
                <strong>{i.titulo}</strong>
                <span className="suave">
                  {i.idioma} · {i.fuente} · {nota(i.puntuacion)} · {i.usos} usos
                </span>
              </div>
              {i.notas && <p className="suave">{i.notas}</p>}
              {i.refExterna && (
                <p className="suave">
                  <a href={i.refExterna} target="_blank" rel="noreferrer noopener">
                    origen
                  </a>
                </p>
              )}
              <div className="pie">
                {i.estado !== "DESCARTADA" && (
                  <button
                    onClick={() =>
                      accion(
                        () => api.patch(`/api/ideas/${i.id}`, { estado: "DESCARTADA" }),
                        "Idea descartada.",
                      )
                    }
                  >
                    Descartar
                  </button>
                )}
                {i.estado !== "PENDIENTE" && (
                  <button
                    onClick={() =>
                      accion(
                        () => api.patch(`/api/ideas/${i.id}`, { estado: "PENDIENTE" }),
                        "Idea reactivada.",
                      )
                    }
                  >
                    Volver a pendiente
                  </button>
                )}
                <button
                  onClick={() => accion(() => api.borrar(`/api/ideas/${i.id}`), "Idea borrada.")}
                >
                  Borrar
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="tarjeta">
        <div className="fila" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Ganchos</h2>
          <button
            onClick={() =>
              accion(() => api.post("/api/metricas/sincronizar"), "Sincronizacion encolada.")
            }
          >
            Sincronizar metricas de TikTok
          </button>
        </div>
        <p className="suave">
          Los ganchos con 60 puntos o mas se reutilizan solos en historias nuevas.
        </p>
        {ganchos.length === 0 && <p className="suave">Todavia no hay ninguno.</p>}
        <div className="lista">
          {ganchos.map((g) => (
            <div className="item" key={g.id}>
              <div className="fila">
                <span className="estado">{nota(g.puntuacion)}</span>
                <strong>{g.texto}</strong>
                <span className="suave">
                  {g.idioma} · {g.usos} usos
                </span>
              </div>
              <div className="pie">
                <button
                  onClick={() => accion(() => api.borrar(`/api/ganchos/${g.id}`), "Gancho borrado.")}
                >
                  Borrar
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {rendimiento && rendimiento.historias.length > 0 && (
        <section className="tarjeta">
          <h2>Ultimas metricas</h2>
          <div className="lista">
            {rendimiento.historias.map((m) => (
              <div className="item" key={m.historiaId}>
                <div className="fila">
                  <span className="estado">{nota(m.puntuacion)}</span>
                  <strong>{m.historia.titulo ?? "(sin titulo)"}</strong>
                  <span className="suave">
                    {m.vistas} vistas · {m.likes} likes
                    {m.tiempoPromedioSeg ? ` · ${m.tiempoPromedioSeg}s de permanencia` : ""}
                  </span>
                </div>
                {m.historia.ganchoTexto && <p className="suave">{m.historia.ganchoTexto}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
