import { useEffect, useState } from "react";
import {
  api,
  type Catalogo,
  type GuionDialogo,
  type Idioma,
  type Preset,
  type Proyecto,
  type Region,
  type Voz,
} from "../api";
import { mensajeDe } from "../App";
import { SelectorCategoria, SelectorMotor, SelectorRegion, SelectorVoz, motorInicial } from "./comunes";
import { EditorMontaje } from "./EditorMontaje";

/**
 * Diálogos: dos o tres voces hablando de un tema, tipo pódcast corto.
 *
 * Se escribe primero y se lee: una conversación mal escrita se nota enseguida,
 * y sale más barato corregir una réplica que regenerar el vídeo entero.
 * Cuando convence, se monta: cada intervención se sintetiza con la voz de
 * quien habla y el rótulo lleva su nombre y su color.
 */

const COLORES = ["#FFE500", "#7FD1FF", "#FF9E7F"];
const NOMBRES = ["Ana", "Beto", "Carla"];

type Hablante = { nombre: string; papel: string; config: Voz; color: string };

/**
 * Voz de partida del hablante `i`. Dos voces iguales suenan a la misma
 * persona hablando sola, así que cada uno arranca con una distinta: las
 * locales mejor valoradas, y si no hay, la de siempre.
 */
function vozInicial(catalogo: Catalogo, i: number): Voz {
  const locales = [...(catalogo.vocesLocales ?? [])].sort((a, b) => b.calidad - a.calidad);
  const elegida = locales[i];
  return elegida
    ? { ...catalogo.vozPorDefecto, proveedor: "local", nombre: elegida.id }
    : catalogo.vozPorDefecto;
}

export function Dialogo({ catalogo }: { catalogo: Catalogo }) {
  const [tema, setTema] = useState("");
  const [duracion, setDuracion] = useState(90);
  const [motor, setMotor] = useState(motorInicial(catalogo));
  const [modelo, setModelo] = useState<string | null>(null);
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [region, setRegion] = useState<Region>("bolivia");
  const [modismos, setModismos] = useState(true);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [subcategoria, setSubcategoria] = useState<string | null>(null);
  const [formato, setFormato] = useState("tiktok");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [hablantes, setHablantes] = useState<Hablante[]>([
    { nombre: NOMBRES[0], papel: "", config: vozInicial(catalogo, 0), color: COLORES[0] },
    { nombre: NOMBRES[1], papel: "", config: vozInicial(catalogo, 1), color: COLORES[1] },
  ]);
  const [guion, setGuion] = useState<GuionDialogo | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    api.get<Preset[]>("/api/presets").then(setPresets).catch(() => {});
  }, []);

  if (abierto) {
    return <EditorMontaje id={abierto} catalogo={catalogo} alSalir={() => setAbierto(null)} />;
  }

  const cambiar = (i: number, c: Partial<Hablante>) =>
    setHablantes(hablantes.map((h, j) => (j === i ? { ...h, ...c } : h)));

  const mismasVoces =
    hablantes.length > 1 &&
    new Set(hablantes.map((h) => `${h.config.proveedor}:${h.config.nombre}`)).size < hablantes.length;

  async function escribir() {
    if (!tema.trim()) {
      setError("Escribe de que tienen que hablar.");
      return;
    }
    setOcupado("escribir");
    setError("");
    setOk("");
    try {
      const g = await api.post<GuionDialogo>("/api/dialogo", {
        tema,
        hablantes: hablantes.map((h) => ({ nombre: h.nombre, papel: h.papel })),
        motor,
        modelo,
        duracion,
        idioma,
        region,
        modismos,
        categoria,
        subcategoria,
      });
      setGuion(g);
      setOk(
        `Dialogo escrito con ${g.motorUsado ?? motor}: ${g.intervenciones.length} intervenciones. ` +
          `Leelo y corrige lo que no suene.${g.avisoMotor ? ` ${g.avisoMotor}` : ""}`,
      );
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  async function crear() {
    if (!guion) return;
    setOcupado("crear");
    setError("");
    setOk("");
    try {
      const p = await api.post<Proyecto & { aviso?: string }>("/api/dialogos", {
        guion,
        hablantes: hablantes.map((h) => ({ nombre: h.nombre, papel: h.papel, config: h.config, color: h.color })),
        formato,
        idioma,
      });
      if (p.aviso) setError(p.aviso);
      setAbierto(p.id);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  function editarIntervencion(i: number, c: Partial<{ hablante: number; texto: string }>) {
    if (!guion) return;
    setGuion({
      ...guion,
      intervenciones: guion.intervenciones.map((x, j) => (j === i ? { ...x, ...c } : x)),
    });
  }

  function moverIntervencion(i: number, salto: number) {
    if (!guion) return;
    const j = i + salto;
    if (j < 0 || j >= guion.intervenciones.length) return;
    const copia = [...guion.intervenciones];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    setGuion({ ...guion, intervenciones: copia });
  }

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>1. De que hablan y quien</h2>
        <div className="campos">
          <div>
            <label htmlFor="temaDialogo">Tema</label>
            <input
              id="temaDialogo"
              value={tema}
              placeholder="si el movil nos roba la concentracion"
              onChange={(e) => setTema(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="durDialogo">Duracion (segundos)</label>
            <input
              id="durDialogo"
              type="number"
              min={20}
              max={900}
              value={duracion}
              onChange={(e) => setDuracion(Number(e.target.value) || 90)}
            />
          </div>
          <div>
            <label htmlFor="fmtDialogo">Formato</label>
            <select id="fmtDialogo" value={formato} onChange={(e) => setFormato(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="idiomaDialogo">Idioma</label>
            <select id="idiomaDialogo" value={idioma} onChange={(e) => setIdioma(e.target.value as Idioma)}>
              {catalogo.idiomas.map((i) => (
                <option key={i} value={i}>
                  {i === "es" ? "Espanol" : "Ingles"}
                </option>
              ))}
            </select>
          </div>
          <SelectorRegion
            catalogo={catalogo}
            region={region}
            modismos={modismos}
            alCambiar={(r, m) => {
              setRegion(r);
              setModismos(m);
            }}
          />
          <SelectorCategoria
            catalogo={catalogo}
            categoria={categoria}
            subcategoria={subcategoria}
            alCambiar={(c, sc) => {
              setCategoria(c);
              setSubcategoria(sc);
            }}
          />
          <SelectorMotor
            catalogo={catalogo}
            valor={motor}
            alCambiar={setMotor}
            modelo={modelo}
            alCambiarModelo={setModelo}
          />
        </div>

        <div className="lista" style={{ marginTop: 12 }}>
          {hablantes.map((h, i) => (
            <div className="item" key={i}>
              <div className="fila">
                <strong style={{ color: h.color }}>Voz {i + 1}</strong>
                {hablantes.length > 2 && (
                  <button onClick={() => setHablantes(hablantes.filter((_, j) => j !== i))}>Quitar</button>
                )}
              </div>
              <div className="campos">
                <div>
                  <label htmlFor={`nombre-${i}`}>Nombre</label>
                  <input id={`nombre-${i}`} value={h.nombre} onChange={(e) => cambiar(i, { nombre: e.target.value })} />
                </div>
                <div>
                  <label htmlFor={`papel-${i}`}>Que defiende (vacio = lo decide la IA)</label>
                  <input
                    id={`papel-${i}`}
                    value={h.papel}
                    placeholder="cree que es culpa del diseno"
                    onChange={(e) => cambiar(i, { papel: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor={`color-${i}`}>Color del rotulo</label>
                  <input
                    id={`color-${i}`}
                    className="color"
                    type="color"
                    value={h.color}
                    onChange={(e) => cambiar(i, { color: e.target.value })}
                  />
                </div>
                <SelectorVoz catalogo={catalogo} valor={h.config} alCambiar={(config) => cambiar(i, { config })} idioma={idioma} />
              </div>
            </div>
          ))}
        </div>

        <div className="pie">
          {hablantes.length < 3 && (
            <button
              onClick={() =>
                setHablantes([
                  ...hablantes,
                  {
                    nombre: NOMBRES[hablantes.length] ?? `Voz ${hablantes.length + 1}`,
                    papel: "",
                    config: vozInicial(catalogo, hablantes.length),
                    color: COLORES[hablantes.length % COLORES.length],
                  },
                ])
              }
            >
              Añadir una tercera voz
            </button>
          )}
          <button className="primario" onClick={escribir} disabled={ocupado !== ""}>
            {ocupado === "escribir" ? "Escribiendo..." : guion ? "Escribir otro dialogo" : "Escribir el dialogo"}
          </button>
        </div>
        {mismasVoces && (
          <p className="aviso error">
            Dos voces iguales suenan a la misma persona hablando sola: cambia el nombre de voz de alguna.
          </p>
        )}
      </section>

      {guion && (
        <section className="tarjeta">
          <div className="fila" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>2. {guion.titulo}</h2>
            <span className="suave">{guion.intervenciones.length} intervenciones</span>
          </div>
          {guion.hablantes.some((h) => h.papel) && (
            <p className="suave">
              {guion.hablantes.map((h, i) => `${hablantes[i]?.nombre ?? h.nombre}: ${h.papel}`).join(" · ")}
            </p>
          )}

          <div className="lista">
            {guion.intervenciones.map((x, i) => (
              <div className="item" key={i}>
                <div className="fila">
                  <select
                    style={{ width: 140 }}
                    value={x.hablante}
                    onChange={(e) => editarIntervencion(i, { hablante: Number(e.target.value) })}
                    aria-label={`Quien habla en la intervencion ${i + 1}`}
                  >
                    {hablantes.map((h, j) => (
                      <option key={j} value={j}>
                        {h.nombre}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => moverIntervencion(i, -1)} disabled={i === 0}>
                    Subir
                  </button>
                  <button onClick={() => moverIntervencion(i, 1)} disabled={i === guion.intervenciones.length - 1}>
                    Bajar
                  </button>
                  <button
                    onClick={() =>
                      setGuion({ ...guion, intervenciones: guion.intervenciones.filter((_, j) => j !== i) })
                    }
                  >
                    Quitar
                  </button>
                </div>
                <textarea
                  value={x.texto}
                  style={{ borderLeft: `3px solid ${hablantes[x.hablante]?.color ?? "#888"}` }}
                  onChange={(e) => editarIntervencion(i, { texto: e.target.value })}
                />
              </div>
            ))}
          </div>

          <div className="pie">
            <button
              onClick={() =>
                setGuion({
                  ...guion,
                  intervenciones: [...guion.intervenciones, { hablante: 0, texto: "" }],
                })
              }
            >
              Añadir intervencion
            </button>
            <button
              className="primario"
              onClick={crear}
              disabled={ocupado !== "" || guion.intervenciones.some((x) => !x.texto.trim())}
            >
              {ocupado === "crear" ? "Montando (genera las voces)..." : "Crear el video del dialogo"}
            </button>
            <span className="suave">
              Cada intervencion se lee con la voz de quien habla; el rotulo sale con su nombre y su color.
            </span>
          </div>
        </section>
      )}
    </>
  );
}
