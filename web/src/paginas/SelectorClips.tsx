import { useState } from "react";
import { api, type Busqueda, type ClipCandidato } from "../api";
import { mensajeDe } from "../App";
import { Muestra } from "./comunes";

/**
 * Deja elegir a mano el clip de cada escena. Las vistas previas se ven
 * directamente desde el CDN de Pexels o Pixabay: el servidor solo descarga
 * el clip que acabe eligiendose.
 */
export function SelectorClips({
  escenas,
  elegidos,
  alElegir,
}: {
  escenas: { texto: string; keywords: string[] }[];
  elegidos: Record<number, string>;
  alElegir: (indice: number, clipId: string | null) => void;
}) {
  const [abierta, setAbierta] = useState<number | null>(null);
  const [candidatos, setCandidatos] = useState<Record<number, ClipCandidato[]>>({});
  const [viendo, setViendo] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  async function abrir(indice: number, keywords: string[]) {
    if (abierta === indice) {
      setAbierta(null);
      return;
    }
    setAbierta(indice);
    setViendo(null);
    if (candidatos[indice]) return;

    setCargando(true);
    setError("");
    try {
      const r = await api.get<Busqueda>(`/api/clips?keywords=${encodeURIComponent(keywords.join(","))}`);
      setCandidatos((c) => ({ ...c, [indice]: r.clips }));
      const fallo = (r.bancos ?? []).filter((b) => b.error);
      if (fallo.length) setError(fallo.map((b) => `${b.banco}: ${b.error}`).join(" · "));
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setCargando(false);
    }
  }

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      <div className="lista">
        {escenas.map((e, i) => {
          const elegido = elegidos[i];
          const lista = candidatos[i] ?? [];
          return (
            <div className="item" key={i}>
              <div className="fila">
                <strong>{i === 0 ? "Gancho" : `Escena ${i}`}</strong>
                <span className="suave">{e.texto.slice(0, 70)}</span>
              </div>
              <div className="fila" style={{ marginTop: 6 }}>
                <span className="suave">
                  Clip: {elegido ? `elegido (${elegido})` : "automatico"}
                </span>
                <button onClick={() => abrir(i, e.keywords)}>
                  {abierta === i ? "Cerrar" : "Elegir clip"}
                </button>
                {elegido && <button onClick={() => alElegir(i, null)}>Volver a automatico</button>}
              </div>

              {abierta === i && (
                <>
                  {cargando && !lista.length && <p className="suave">Buscando clips...</p>}
                  {!cargando && !lista.length && (
                    <p className="suave">Sin resultados para: {e.keywords.join(", ")}</p>
                  )}
                  <div className="rejilla">
                    {lista.map((c) => (
                      <div
                        key={c.id}
                        className={`miniatura ${elegido === c.id ? "elegida" : ""}`}
                      >
                        {viendo === c.id ? (
                          <video src={c.url} controls muted autoPlay playsInline />
                        ) : (
                          <Muestra url={c.imagen ?? c.url} respaldo={c.tipo === "imagen" ? c.url : undefined} />
                        )}
                        <div className="fila">
                          <button onClick={() => alElegir(i, c.id)}>
                            {elegido === c.id ? "Elegido" : "Usar"}
                          </button>
                          <button onClick={() => setViendo(viendo === c.id ? null : c.id)}>
                            {viendo === c.id ? "Parar" : "Ver"}
                          </button>
                        </div>
                        <span className="suave">
                          {c.autor} · {c.fuente}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
