import { useCallback, useEffect, useState } from "react";
import { api, type Calidad, type Catalogo, type Momento, type Preset, type Variante } from "../api";
import { mensajeDe } from "../App";

const reloj = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};

/**
 * Cortes y formatos del mismo montaje: la version completa para YouTube, los
 * 30 segundos del coro para TikTok... Cada uno se renderiza aparte y se
 * descarga aparte; el montaje no se toca.
 */
const mb = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

export function Cortes({
  proyectoId,
  presets,
  formato,
  total,
  esVideoclip,
  catalogo,
}: {
  proyectoId: string;
  presets: Preset[];
  catalogo: Catalogo;
  /** Formato del proyecto, el que se propone por defecto. */
  formato: string;
  /** Duracion del montaje, para acotar los cortes. */
  total: number;
  /** En videoclips se pueden sugerir momentos analizando la cancion. */
  esVideoclip: boolean;
}) {
  const [variantes, setVariantes] = useState<Variante[]>([]);
  const [momentos, setMomentos] = useState<Momento[]>([]);
  const [ventana, setVentana] = useState(30);
  const [nombre, setNombre] = useState("Corte");
  const [fmt, setFmt] = useState(formato);
  const [inicio, setInicio] = useState(0);
  const [duracion, setDuracion] = useState(30);
  const [completa, setCompleta] = useState(false);
  /** Vacía = la calidad del proyecto. */
  const [calidad, setCalidad] = useState<Calidad | "">("");
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const cargar = useCallback(async () => {
    try {
      setVariantes(await api.get<Variante[]>(`/api/proyectos/${proyectoId}/variantes`));
    } catch (err) {
      setError(mensajeDe(err));
    }
  }, [proyectoId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Mientras haya cortes renderizando, la lista se refresca sola.
  useEffect(() => {
    if (!variantes.some((v) => v.estado === "RENDER")) return;
    const t = setInterval(cargar, 8000);
    return () => clearInterval(t);
  }, [variantes, cargar]);

  async function accion(clave: string, fn: () => Promise<unknown>, mensaje: string) {
    setOcupado(clave);
    setError("");
    setOk("");
    try {
      await fn();
      setOk(mensaje);
      await cargar();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  const crear = (
    lista: { nombre: string; formato: string; inicio: number; duracion: number | null; calidad?: Calidad | null }[],
    mensaje: string,
  ) =>
    accion("crear", () => api.post(`/api/proyectos/${proyectoId}/variantes`, { variantes: lista }), mensaje);

  async function sugerir() {
    setOcupado("momentos");
    setError("");
    try {
      const r = await api.get<{ duracion: number; momentos: Momento[] }>(
        `/api/proyectos/${proyectoId}/momentos?ventana=${ventana}`,
      );
      setMomentos(r.momentos);
      if (!r.momentos.length) setError("No se pudo sacar ningun momento de la cancion.");
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  /** El paquete de siempre: la completa en horizontal y el mejor trozo en vertical. */
  async function paquete() {
    setOcupado("paquete");
    setError("");
    try {
      let arranque = 0;
      if (esVideoclip) {
        const r = await api
          .get<{ momentos: Momento[] }>(`/api/proyectos/${proyectoId}/momentos?ventana=30&cuantos=1`)
          .catch(() => ({ momentos: [] as Momento[] }));
        arranque = r.momentos[0]?.inicio ?? 0;
        setMomentos(r.momentos);
      }
      const corte = Math.min(30, Math.max(5, total - arranque));
      await api.post(`/api/proyectos/${proyectoId}/variantes`, {
        variantes: [
          { nombre: "Completa YouTube", formato: "youtube", inicio: 0, duracion: null },
          { nombre: "Completa vertical", formato: "tiktok", inicio: 0, duracion: null },
          { nombre: `Corte 30 s (${reloj(arranque)})`, formato: "tiktok", inicio: arranque, duracion: corte },
        ],
      });
      setOk("Tres salidas encoladas: completa en 16:9, completa vertical y el corte de 30 s.");
      await cargar();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  const tope = Math.max(total, 1);

  return (
    <section className="tarjeta">
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <p className="suave">
        El montaje dura {reloj(total)}. Cada corte sale del mismo material, recortado a su tramo y
        encajado en su formato; se renderizan por separado y no tocan el MP4 principal.
      </p>

      <div className="pie" style={{ marginBottom: 12 }}>
        <button className="primario" onClick={paquete} disabled={ocupado !== ""}>
          {ocupado === "paquete" ? "Preparando..." : "Paquete para redes (completa + 30 s)"}
        </button>
        {esVideoclip && (
          <>
            <button onClick={sugerir} disabled={ocupado !== ""}>
              {ocupado === "momentos" ? "Analizando..." : "Buscar los mejores momentos"}
            </button>
            <input
              type="number"
              style={{ width: 90 }}
              min={5}
              max={120}
              value={ventana}
              aria-label="Segundos del corte"
              onChange={(e) => setVentana(Number(e.target.value))}
            />
            <span className="suave">segundos por corte</span>
          </>
        )}
      </div>

      {momentos.length > 0 && (
        <div className="lista" style={{ marginBottom: 12 }}>
          {momentos.map((m) => (
            <div className="item" key={m.inicio}>
              <div className="fila">
                <strong>
                  {reloj(m.inicio)} → {reloj(m.inicio + m.duracion)}
                </strong>
                <span className="suave">
                  {m.motivo} · fuerza {Math.round(m.puntuacion * 100)}%
                </span>
              </div>
              <div className="pie">
                <button
                  onClick={() => {
                    setInicio(Math.round(m.inicio));
                    setDuracion(Math.round(m.duracion));
                    setCompleta(false);
                    setNombre(`Corte ${reloj(m.inicio)}`);
                  }}
                >
                  Usar este tramo
                </button>
                <button
                  onClick={() =>
                    crear(
                      [
                        { nombre: `Corte ${reloj(m.inicio)}`, formato: "tiktok", inicio: m.inicio, duracion: m.duracion },
                      ],
                      "Corte vertical encolado.",
                    )
                  }
                  disabled={ocupado !== ""}
                >
                  Cortar en vertical
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="campos">
        <div>
          <label htmlFor="nombreCorte">Nombre</label>
          <input id="nombreCorte" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div>
          <label htmlFor="fmtCorte">Formato</label>
          <select id="fmtCorte" value={fmt} onChange={(e) => setFmt(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="calidadCorte">Calidad</label>
          <select id="calidadCorte" value={calidad} onChange={(e) => setCalidad(e.target.value as Calidad | "")}>
            <option value="">La del proyecto</option>
            {(catalogo.calidades ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tramoCorte">Tramo</label>
          <select
            id="tramoCorte"
            value={completa ? "completa" : "parcial"}
            onChange={(e) => setCompleta(e.target.value === "completa")}
          >
            <option value="completa">La version completa</option>
            <option value="parcial">Solo un tramo</option>
          </select>
        </div>
        {!completa && (
          <>
            <div>
              <label htmlFor="iniCorte">Empieza en el segundo ({reloj(inicio)})</label>
              <input
                id="iniCorte"
                type="range"
                min={0}
                max={Math.max(0, Math.floor(tope - 1))}
                value={Math.min(inicio, tope - 1)}
                onChange={(e) => setInicio(Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="durCorte">Dura (segundos)</label>
              <input
                id="durCorte"
                type="number"
                min={1}
                max={Math.ceil(tope)}
                value={duracion}
                onChange={(e) => setDuracion(Number(e.target.value))}
              />
            </div>
          </>
        )}
      </div>

      <div className="pie">
        <button
          onClick={() =>
            crear(
              [
                {
                  nombre: nombre.trim() || "Corte",
                  formato: fmt,
                  inicio: completa ? 0 : inicio,
                  duracion: completa ? null : Math.max(1, Math.min(duracion, tope - inicio)),
                  calidad: calidad || null,
                },
              ],
              "Corte encolado; se renderiza en segundo plano.",
            )
          }
          disabled={ocupado !== ""}
        >
          Crear y renderizar este corte
        </button>
      </div>

      <div className="lista" style={{ marginTop: 12 }}>
        {variantes.length === 0 && <p className="suave">Todavia no hay cortes.</p>}
        {variantes.map((v) => (
          <div className="item" key={v.id}>
            <div className="fila">
              <span className={`estado ${v.estado === "LISTO" ? "LISTA" : v.estado}`}>{v.estado}</span>
              <strong>{v.nombre}</strong>
              <span className="suave">
                {v.formato} ·{" "}
                {v.duracion ? `${reloj(v.inicio)} → ${reloj(v.inicio + v.duracion)}` : "completa"}
                {v.duracionSeg ? ` · ${v.duracionSeg.toFixed(1)}s` : ""}
                {v.calidad ? ` · ${v.calidad}` : ""}
                {v.bytes ? ` · ${mb(v.bytes)}` : ""}
              </span>
            </div>
            {v.error && <pre>{v.error}</pre>}
            <div className="pie">
              {v.archivo && (
                <a className="boton" href={`/api/proyectos/${proyectoId}/variantes/${v.id}/descargar`}>
                  Descargar MP4
                </a>
              )}
              <button
                onClick={() =>
                  accion(v.id, () => api.post(`/api/proyectos/${proyectoId}/variantes/${v.id}/render`), "Render encolado.")
                }
                disabled={ocupado !== ""}
              >
                {v.archivo ? "Rehacer" : "Renderizar"}
              </button>
              <button
                onClick={() => {
                  if (confirm(`Borrar el corte "${v.nombre}"?`)) {
                    accion(v.id, () => api.borrar(`/api/proyectos/${proyectoId}/variantes/${v.id}`), "Corte borrado.");
                  }
                }}
                disabled={ocupado !== ""}
              >
                Borrar
              </button>
            </div>
            {v.archivo && (
              <video
                className="reproductor"
                src={`/api/proyectos/${proyectoId}/variantes/${v.id}/ver`}
                controls
                preload="none"
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
