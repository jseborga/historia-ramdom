import { useState } from "react";
import { api, type ClipCandidato } from "../api";
import { mensajeDe } from "../App";

/** Busca clips por palabras libres y devuelve el elegido. */
export function BuscadorClips({
  sugerencia,
  alElegir,
}: {
  sugerencia: string;
  alElegir: (clip: ClipCandidato | null) => void;
}) {
  const [consulta, setConsulta] = useState(sugerencia);
  const [lista, setLista] = useState<ClipCandidato[]>([]);
  const [viendo, setViendo] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  async function buscar() {
    if (!consulta.trim()) return;
    setCargando(true);
    setError("");
    try {
      setLista(
        await api.get<ClipCandidato[]>(`/api/clips?keywords=${encodeURIComponent(consulta)}`),
      );
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setCargando(false);
    }
  }

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      <div className="fila">
        <input
          value={consulta}
          placeholder="rain window, city night"
          onChange={(e) => setConsulta(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && buscar()}
        />
        <button onClick={buscar} disabled={cargando}>
          {cargando ? "Buscando..." : "Buscar"}
        </button>
        <button onClick={() => alElegir(null)}>Quitar clip</button>
      </div>

      <div className="rejilla">
        {lista.map((c) => (
          <div className="miniatura" key={c.id}>
            {viendo === c.id ? (
              <video src={c.url} controls muted autoPlay playsInline />
            ) : c.imagen ? (
              <img src={c.imagen} alt="" loading="lazy" />
            ) : (
              <div className="sinImagen">sin muestra</div>
            )}
            <div className="fila">
              <button onClick={() => alElegir(c)}>Usar</button>
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
  );
}
