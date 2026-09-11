import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Catalogo,
  type Idioma,
  type ModoAudio,
  type ModoPublicacion,
  type Serie,
  type Voz,
} from "../api";
import { mensajeDe } from "../App";
import {
  CampoSegundos,
  SelectorAudio,
  SelectorModo,
  SelectorMotor,
  SelectorMusica,
  SelectorVoz,
} from "./comunes";

const EJEMPLOS_CRON: [string, string][] = [
  ["0 9 * * *", "Todos los dias a las 9:00"],
  ["0 9,19 * * *", "Todos los dias a las 9:00 y 19:00"],
  ["0 18 * * 1-5", "De lunes a viernes a las 18:00"],
  ["30 7 * * 0", "Domingos a las 7:30"],
];

export function Series({ catalogo }: { catalogo: Catalogo }) {
  const [series, setSeries] = useState<Serie[]>([]);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<"Reflexion" | "Historia">("Reflexion");
  const [temas, setTemas] = useState("");
  const [duracion, setDuracion] = useState(65);
  const [cron, setCron] = useState("0 9 * * *");
  const [zonaHoraria, setZonaHoraria] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Lima",
  );
  const [motor, setMotor] = useState(catalogo.motores.find((m) => m.disponible)?.id ?? "groq");
  const [modelo, setModelo] = useState<string | null>(null);
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [musicaModo, setMusicaModo] = useState<"FIJA" | "ROTAR">("FIJA");
  const [modoAudio, setModoAudio] = useState<ModoAudio>("VOZ");
  const [segundosEscena, setSegundosEscena] = useState<number | null>(null);
  const [voz, setVoz] = useState<Voz>(catalogo.vozPorDefecto);
  const [musica, setMusica] = useState<string | null>(null);
  const [modo, setModo] = useState<ModoPublicacion>("DESCARGA");

  const tiktokListo = catalogo.tiktok.configurado && catalogo.tiktok.cuentasConectadas > 0;

  const cargar = useCallback(async () => {
    try {
      setSeries(await api.get<Serie[]>("/api/series"));
    } catch (err) {
      setError(mensajeDe(err));
    }
  }, []);

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

  const crear = () =>
    accion(
      () =>
        api.post("/api/series", {
          nombre,
          tipo,
          temas: temas
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean),
          duracion,
          idioma,
          cron,
          zonaHoraria,
          motor,
          modelo,
          voz,
          modoAudio,
          segundosEscena,
          musica: musicaModo === "ROTAR" ? null : musica,
          musicaModo,
          modoPublicacion: modo,
          activa: true,
        }),
      "Serie creada y programada.",
    ).then(() => setNombre(""));

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>Nueva serie</h2>
        <div className="campos">
          <div>
            <label htmlFor="nombre">Nombre</label>
            <input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div>
            <label htmlFor="tipoSerie">Tipo</label>
            <select
              id="tipoSerie"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as "Reflexion" | "Historia")}
            >
              <option value="Reflexion">Reflexion</option>
              <option value="Historia">Historia</option>
            </select>
          </div>
          <div>
            <label htmlFor="duracionSerie">Duracion (segundos)</label>
            <input
              id="duracionSerie"
              type="number"
              min={15}
              max={180}
              value={duracion}
              onChange={(e) => setDuracion(Number(e.target.value))}
            />
          </div>
          <div>
            <label htmlFor="cron">Horario (cron)</label>
            <input id="cron" value={cron} onChange={(e) => setCron(e.target.value)} />
          </div>
          <div>
            <label htmlFor="zona">Zona horaria</label>
            <input id="zona" value={zonaHoraria} onChange={(e) => setZonaHoraria(e.target.value)} />
          </div>
          <SelectorMotor
            catalogo={catalogo}
            valor={motor}
            alCambiar={setMotor}
            modelo={modelo}
            alCambiarModelo={setModelo}
          />
          <SelectorAudio valor={modoAudio} alCambiar={setModoAudio} />
          {modoAudio === "VOZ" ? (
            <SelectorVoz catalogo={catalogo} valor={voz} alCambiar={setVoz} />
          ) : (
            <CampoSegundos valor={segundosEscena} alCambiar={setSegundosEscena} />
          )}
          <div>
            <label htmlFor="idiomaSerie">Idioma</label>
            <select
              id="idiomaSerie"
              value={idioma}
              onChange={(e) => setIdioma(e.target.value as Idioma)}
            >
              {catalogo.idiomas.map((i) => (
                <option key={i} value={i}>
                  {i === "es" ? "Espanol" : "Ingles"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="musicaModo">Musica</label>
            <select
              id="musicaModo"
              value={musicaModo}
              onChange={(e) => setMusicaModo(e.target.value as "FIJA" | "ROTAR")}
            >
              <option value="FIJA">Siempre la misma pista</option>
              <option value="ROTAR">Rotar entre las pistas disponibles</option>
            </select>
          </div>
          {musicaModo === "FIJA" && (
            <SelectorMusica catalogo={catalogo} valor={musica} alCambiar={setMusica} />
          )}
          <SelectorModo valor={modo} alCambiar={setModo} tiktokListo={tiktokListo} />
        </div>
        <div style={{ marginTop: 12 }}>
          <label htmlFor="temas">Temas, uno por linea (vacio = tema libre)</label>
          <textarea id="temas" value={temas} onChange={(e) => setTemas(e.target.value)} />
        </div>
        <p className="suave" style={{ marginTop: 8 }}>
          {EJEMPLOS_CRON.map(([c, d]) => `${c} = ${d}`).join(" · ")}
        </p>
        <div className="pie">
          <button className="primario" onClick={crear} disabled={!nombre.trim()}>
            Crear serie
          </button>
        </div>
      </section>

      <section className="tarjeta">
        <h2>Series programadas</h2>
        {series.length === 0 && <p className="suave">Todavia no hay ninguna.</p>}
        <div className="lista">
          {series.map((s) => (
            <div className="item" key={s.id}>
              <div className="fila">
                <strong>{s.nombre}</strong>
                <span className="estado">{s.activa ? "activa" : "en pausa"}</span>
                <span className="suave">
                  {s.tipo} · {s.idioma} · {s.modoAudio} · {s.cron} ({s.zonaHoraria}) · {s.motor}
                  {s.modelo ? ` (${s.modelo})` : ""} · {s.duracion}s ·{" "}
                  {s._count?.historias ?? 0} historias
                </span>
              </div>
              <div className="pie">
                <button
                  onClick={() =>
                    accion(
                      () => api.patch(`/api/series/${s.id}`, { activa: !s.activa }),
                      s.activa ? "Serie en pausa." : "Serie reactivada.",
                    )
                  }
                >
                  {s.activa ? "Pausar" : "Reactivar"}
                </button>
                <button
                  onClick={() =>
                    accion(
                      () => api.post(`/api/series/${s.id}/generar`),
                      "Historia encolada fuera de horario.",
                    )
                  }
                >
                  Generar ahora
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Borrar la serie "${s.nombre}"?`)) {
                      accion(() => api.borrar(`/api/series/${s.id}`), "Serie borrada.");
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
