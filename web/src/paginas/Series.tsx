import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Catalogo,
  type Idioma,
  type ModoAudio,
  type ModoPublicacion,
  type Region,
  type Serie,
  type Voz,
} from "../api";
import { mensajeDe } from "../App";
import {
  CampoSegundos,
  SelectorAudio,
  SelectorBancos,
  SelectorCategoria,
  SelectorModo,
  SelectorMotor,
  motorInicial,
  SelectorMusica,
  SelectorRegion,
  SelectorVoz,
  nombreCategoria,
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
  const [motor, setMotor] = useState(motorInicial(catalogo));
  const [modelo, setModelo] = useState<string | null>(null);
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [region, setRegion] = useState<Region>("bolivia");
  const [modismos, setModismos] = useState(true);
  const [partes, setPartes] = useState(1);
  const [categoria, setCategoria] = useState<string | null>(catalogo.categoriaAleatoria ?? "aleatoria");
  const [subcategoria, setSubcategoria] = useState<string | null>(null);
  /** Dónde buscar imagen; vacío = lo que use la categoría. */
  const [bancos, setBancos] = useState<string[]>([]);
  const [medios, setMedios] = useState<string[]>([]);
  const [musicaLista, setMusicaLista] = useState<string[]>(catalogo.musica);
  const [musicaModo, setMusicaModo] = useState<"FIJA" | "ROTAR">("FIJA");
  const [modoAudio, setModoAudio] = useState<ModoAudio>("VOZ");
  const [segundosEscena, setSegundosEscena] = useState<number | null>(null);
  const [salida, setSalida] = useState<"VIDEO" | "MONTAJE">("MONTAJE");
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
          region,
          modismos,
          partes,
          categoria,
          subcategoria,
          bancos,
          medios,
          cron,
          zonaHoraria,
          motor,
          modelo,
          voz,
          modoAudio,
          segundosEscena,
          salida,
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
              max={350}
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
          <div>
            <label htmlFor="salida">Que produce cada ejecucion</label>
            <select
              id="salida"
              value={salida}
              onChange={(e) => setSalida(e.target.value as "VIDEO" | "MONTAJE")}
            >
              <option value="MONTAJE">Un montaje en el editor, para revisar antes de renderizar</option>
              <option value="VIDEO">El MP4 terminado, sin pasar por el editor</option>
            </select>
          </div>
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
          <SelectorRegion catalogo={catalogo} region={region} modismos={modismos} alCambiar={(r, m) => { setRegion(r); setModismos(m); }} />
          <SelectorCategoria
            catalogo={catalogo}
            categoria={categoria}
            subcategoria={subcategoria}
            alCambiar={(c, sc) => { setCategoria(c); setSubcategoria(sc); }}
          />
          <SelectorBancos
            catalogo={catalogo}
            bancos={bancos}
            medios={medios}
            alCambiar={(b, m) => { setBancos(b); setMedios(m); }}
          />
          <div>
            <label htmlFor="partes">Historia por partes</label>
            <select id="partes" value={partes} onChange={(e) => setPartes(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>{n === 1 ? "Una sola parte" : `${n} partes seguidas`}</option>
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
            <SelectorMusica
              catalogo={{ ...catalogo, musica: musicaLista }}
              valor={musica}
              alCambiar={setMusica}
              alAmpliar={setMusicaLista}
            />
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
                  {s.tipo}{s.categoria ? ` · ${nombreCategoria(catalogo, s.categoria, s.subcategoria)}` : ""} · {s.idioma}/{s.region}{s.modismos ? "" : " neutro"}{s.partes > 1 ? ` · ${s.partes} partes` : ""} · {s.salida === "MONTAJE" ? "montaje" : "video"} · {s.modoAudio} · {s.cron} ({s.zonaHoraria}) · {s.motor}
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
