import { useCallback, useEffect, useState } from "react";
import { aISO, api, type Catalogo, type Historia, type Metrica } from "../api";
import { mensajeDe } from "../App";
import { nombreCategoria } from "./comunes";

const EN_PROCESO = ["GUION", "CLIPS", "VOZ", "RENDER"];

const CAMPOS: [keyof FormMetrica, string][] = [
  ["vistas", "Vistas"],
  ["likes", "Likes"],
  ["comentarios", "Comentarios"],
  ["compartidos", "Compartidos"],
  ["guardados", "Guardados"],
  ["tiempoPromedioSeg", "Permanencia media (s)"],
];

type FormMetrica = {
  vistas: string;
  likes: string;
  comentarios: string;
  compartidos: string;
  guardados: string;
  tiempoPromedioSeg: string;
};

const desdeMetrica = (m: Metrica | null): FormMetrica => ({
  vistas: String(m?.vistas ?? ""),
  likes: String(m?.likes ?? ""),
  comentarios: String(m?.comentarios ?? ""),
  compartidos: String(m?.compartidos ?? ""),
  guardados: String(m?.guardados ?? ""),
  tiempoPromedioSeg: m?.tiempoPromedioSeg != null ? String(m.tiempoPromedioSeg) : "",
});

/**
 * TikTok no entrega la permanencia media por API: se copia de TikTok Studio.
 * El resto de cifras se rellenan solas si la subida fue por API.
 */
function FormularioMetrica({
  historia,
  alGuardar,
}: {
  historia: Historia;
  alGuardar: (datos: Record<string, number | null>) => void;
}) {
  const [form, setForm] = useState<FormMetrica>(desdeMetrica(historia.metrica));

  return (
    <div>
      <div className="campos">
        {CAMPOS.map(([campo, etiqueta]) => (
          <div key={campo}>
            <label htmlFor={`${campo}-${historia.id}`}>{etiqueta}</label>
            <input
              id={`${campo}-${historia.id}`}
              type="number"
              min={0}
              step={campo === "tiempoPromedioSeg" ? "0.1" : "1"}
              value={form[campo]}
              onChange={(e) => setForm({ ...form, [campo]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div className="pie">
        <button
          className="primario"
          onClick={() =>
            alGuardar({
              vistas: Number(form.vistas || 0),
              likes: Number(form.likes || 0),
              comentarios: Number(form.comentarios || 0),
              compartidos: Number(form.compartidos || 0),
              guardados: Number(form.guardados || 0),
              tiempoPromedioSeg: form.tiempoPromedioSeg
                ? Number(form.tiempoPromedioSeg)
                : null,
            })
          }
        >
          Guardar metricas
        </button>
      </div>
    </div>
  );
}

export function Historias({ catalogo }: { catalogo?: Catalogo | null }) {
  const [historias, setHistorias] = useState<Historia[]>([]);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  /** Fecha elegida por historia para programar su subida a TikTok. */
  const [fechas, setFechas] = useState<Record<string, string>>({});
  /** Historia cuyo formulario de metricas esta abierto. */
  const [midiendo, setMidiendo] = useState<string | null>(null);
  /** Historia que se esta viendo en el reproductor. */
  const [viendo, setViendo] = useState<string | null>(null);

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

  /** Saca el guion en texto para llevarlo a otra IA. */
  async function copiarGuion(id: string) {
    setError("");
    try {
      const { texto, instrucciones } = await api.get<{ texto: string; instrucciones: string }>(
        `/api/historias/${id}/texto`,
      );
      await copiar(`${instrucciones}\n\n${texto}`, "Guion");
    } catch (err) {
      setError(mensajeDe(err));
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
                <strong>{h.parte > 1 ? `Parte ${h.parte} · ` : ""}{h.titulo ?? "(sin titulo aun)"}</strong>
                {h.categoria && <span className="estado">{nombreCategoria(catalogo, h.categoria, h.subcategoria)}</span>}
                <span className="suave">{new Date(h.creadaEn).toLocaleString()}</span>
              </div>

              {EN_PROCESO.includes(h.estado) && (
                <p className="suave">En proceso; esta pagina se actualiza sola.</p>
              )}
              {h.ganchoTexto && <p className="suave">Gancho: {h.ganchoTexto}</p>}
              {h.metrica && h.metrica.vistas > 0 && (
                <p className="suave">
                  {h.metrica.vistas} vistas · {h.metrica.likes} likes
                  {h.metrica.tiempoPromedioSeg
                    ? ` · ${h.metrica.tiempoPromedioSeg}s de permanencia`
                    : ""}
                  {h.metrica.puntuacion !== null
                    ? ` · ${h.metrica.puntuacion} pts`
                    : " · sin puntuacion (pocas vistas)"}
                </p>
              )}
              {h.publicarEn && h.estado !== "SUBIDA" && (
                <p className="suave">
                  Subida programada para {new Date(h.publicarEn).toLocaleString()}.
                </p>
              )}
              {h.error && <pre>{h.error}</pre>}
              {h.descripcion && <pre>{h.descripcion}</pre>}

              {viendo === h.id && h.archivo && (
                <video
                  className="reproductor"
                  src={`/api/historias/${h.id}/ver`}
                  controls
                  autoPlay
                  playsInline
                />
              )}

              <div className="pie">
                {h.archivo && (
                  <button onClick={() => setViendo(viendo === h.id ? null : h.id)}>
                    {viendo === h.id ? "Cerrar" : "Ver video"}
                  </button>
                )}
                {h.archivo && (
                  <a className="boton" href={`/api/historias/${h.id}/descargar`}>
                    Descargar MP4
                  </a>
                )}
                {h.descripcion && (
                  <button onClick={() => copiar(h.descripcion!)}>Copiar descripcion</button>
                )}
                <button onClick={() => copiarCreditos(h.id)}>Copiar creditos</button>
                <button onClick={() => copiarGuion(h.id)}>Copiar guion</button>
                {h.titulo && (
                  <button
                    onClick={() =>
                      accion(
                        () => api.post(`/api/historias/${h.id}/continuar`),
                        `Parte ${h.parte + 1} encolada: retoma justo donde quedó esta.`,
                      )
                    }
                  >
                    Continuar (parte {h.parte + 1})
                  </button>
                )}
                {h.titulo && (
                  <button
                    onClick={() =>
                      accion(
                        () => api.post("/api/proyectos", { historiaId: h.id }),
                        "Montaje creado. Abrelo en la pestana Montaje.",
                      )
                    }
                  >
                    Abrir en el editor
                  </button>
                )}
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
                <button onClick={() => setMidiendo(midiendo === h.id ? null : h.id)}>
                  {midiendo === h.id ? "Cerrar metricas" : "Metricas"}
                </button>
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

              {midiendo === h.id && (
                <FormularioMetrica
                  historia={h}
                  alGuardar={(datos) =>
                    accion(
                      () => api.put(`/api/historias/${h.id}/metrica`, datos),
                      "Metricas guardadas.",
                    ).then(() => setMidiendo(null))
                  }
                />
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
