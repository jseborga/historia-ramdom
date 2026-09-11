import { useCallback, useEffect, useState } from "react";
import { api, type Historia } from "../api";
import { mensajeDe } from "../App";

const EN_PROCESO = ["GUION", "CLIPS", "VOZ", "RENDER"];

export function Historias() {
  const [historias, setHistorias] = useState<Historia[]>([]);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const cargar = useCallback(async () => {
    try {
      setHistorias(await api.get<Historia[]>("/api/historias"));
    } catch (err) {
      setError(mensajeDe(err));
    }
  }, []);

  useEffect(() => {
    cargar();
    // Mientras haya historias en proceso conviene refrescar solo.
    const t = setInterval(cargar, 15_000);
    return () => clearInterval(t);
  }, [cargar]);

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setOk("Descripcion copiada.");
    } catch {
      setError("El navegador no dejo copiar; selecciona el texto a mano.");
    }
  }

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

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <div className="fila" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Historias</h2>
          <button onClick={cargar}>Actualizar</button>
        </div>

        {historias.length === 0 && <p className="suave">Todavia no hay ninguna.</p>}

        <div className="lista">
          {historias.map((h) => (
            <div className="item" key={h.id}>
              <div className="fila">
                <span className={`estado ${h.estado}`}>{h.estado}</span>
                <strong>{h.titulo ?? "(sin titulo aun)"}</strong>
                <span className="suave">{new Date(h.creadaEn).toLocaleString()}</span>
              </div>

              {EN_PROCESO.includes(h.estado) && (
                <p className="suave">En proceso; esta pagina se actualiza sola.</p>
              )}
              {h.error && <pre>{h.error}</pre>}
              {h.descripcion && <pre>{h.descripcion}</pre>}

              <div className="pie">
                {h.archivo && (
                  <a className="boton" href={`/api/historias/${h.id}/descargar`}>
                    Descargar MP4
                  </a>
                )}
                {h.descripcion && (
                  <button onClick={() => copiar(h.descripcion!)}>Copiar descripcion</button>
                )}
                {h.archivo && h.estado !== "SUBIDA" && (
                  <button
                    onClick={() =>
                      accion(
                        () => api.post(`/api/historias/${h.id}/publicar`),
                        "Subida a TikTok encolada.",
                      )
                    }
                  >
                    Enviar a TikTok
                  </button>
                )}
                <button
                  onClick={() => {
                    if (confirm("Borrar esta historia?")) {
                      accion(() => api.borrar(`/api/historias/${h.id}`), "Historia borrada.");
                    }
                  }}
                >
                  Borrar
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
