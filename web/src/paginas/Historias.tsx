import { useCallback, useEffect, useState } from "react";
import { aISO, api, type Historia } from "../api";
import { mensajeDe } from "../App";

const EN_PROCESO = ["GUION", "CLIPS", "VOZ", "RENDER"];

export function Historias() {
  const [historias, setHistorias] = useState<Historia[]>([]);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  /** Fecha elegida por historia para programar su subida a TikTok. */
  const [fechas, setFechas] = useState<Record<string, string>>({});

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

  async function copiar(texto: string, que = "Descripcion") {
    try {
      await navigator.clipboard.writeText(texto);
      setOk(`${que} copiada.`);
    } catch {
      setError("El navegador no dejo copiar; selecciona el texto a mano.");
    }
  }

  async function copiarCreditos(id: string) {
    setError("");
    try {
      const { creditos } = await api.get<{ creditos: string }>(
        `/api/historias/${id}/creditos`,
      );
      if (!creditos) {
        setError("Esta historia todavia no tiene clips con creditos.");
        return;
      }
      await copiar(creditos, "Lista de creditos");
    } catch (err) {
      setError(mensajeDe(err));
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
              {h.publicarEn && h.estado !== "SUBIDA" && (
                <p className="suave">
                  Subida programada para {new Date(h.publicarEn).toLocaleString()}.
                </p>
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
                <button onClick={() => copiarCreditos(h.id)}>Copiar creditos</button>
                {h.archivo && h.estado !== "SUBIDA" && (
                  <>
                    <input
                      type="datetime-local"
                      style={{ width: "auto" }}
                      aria-label="Fecha de subida"
                      value={fechas[h.id] ?? ""}
                      onChange={(e) => setFechas({ ...fechas, [h.id]: e.target.value })}
                    />
                    <button
                      onClick={() =>
                        accion(
                          () =>
                            api.post(`/api/historias/${h.id}/publicar`, {
                              publicarEn: aISO(fechas[h.id] ?? ""),
                            }),
                          fechas[h.id]
                            ? `Subida programada para ${new Date(
                                fechas[h.id],
                              ).toLocaleString()}.`
                            : "Subida a TikTok encolada.",
                        )
                      }
                    >
                      {fechas[h.id] ? "Programar subida" : "Enviar a TikTok"}
                    </button>
                  </>
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
