import { useEffect, useState } from "react";
import {
  api,
  type Catalogo,
  type GuionSadButTrue,
  type Idioma,
  type Preset,
  type Proyecto,
  type Region,
  type TonoSadButTrue,
} from "../api";
import { mensajeDe } from "../App";
import { SelectorBancos, SelectorMotor, SelectorRegion, motorInicial, nombreIdioma } from "./comunes";
import { EditorMontaje } from "./EditorMontaje";

/**
 * Sad but true: diez segundos, sin voz y con el formato cerrado.
 *
 *   negro, palabras pasando como un sorteo · se para en una · corte a un
 *   vídeo cualquiera con la frase · se disuelve a negro con el remate.
 *
 * Aquí no se elige el montaje, se elige el texto: las palabras del sorteo,
 * cuál gana, la frase que le toca y el remate. Los tiempos están puestos (2 +
 * 5 + 3) y se pueden mover, pero moverlos mucho deja de ser este formato.
 */

const TONOS: [TonoSadButTrue | "", string][] = [
  ["", "el que le pegue a la frase"],
  ["feliz", "feliz (algo que salva el dia)"],
  ["triste", "triste (sin consuelo, pero sin crueldad)"],
  ["reflexiva", "reflexiva (deja pensando)"],
  ["desmotivadora", "desmotivadora (la verdad que nadie pide)"],
];

const TIEMPOS = { sorteoSeg: 2, retencionSeg: 1, clipSeg: 5, cierreSeg: 3 };

export function SadButTrue({ catalogo }: { catalogo: Catalogo }) {
  const [tema, setTema] = useState("");
  const [tono, setTono] = useState<TonoSadButTrue | "">("");
  const [motor, setMotor] = useState(motorInicial(catalogo));
  const [modelo, setModelo] = useState<string | null>(null);
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [region, setRegion] = useState<Region>("bolivia");
  const [modismos, setModismos] = useState(true);
  const [formato, setFormato] = useState("tiktok");
  const [bancos, setBancos] = useState<string[]>([]);
  const [tiposMedio, setTiposMedio] = useState<string[]>([]);
  const [tiempos, setTiempos] = useState(TIEMPOS);
  const [revelarFrase, setRevelarFrase] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [guion, setGuion] = useState<GuionSadButTrue | null>(null);
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

  const total = tiempos.sorteoSeg + tiempos.clipSeg + tiempos.cierreSeg;
  const cambiarTiempo = (c: Partial<typeof TIEMPOS>) => setTiempos({ ...tiempos, ...c });

  const editar = (c: Partial<GuionSadButTrue>) => guion && setGuion({ ...guion, ...c });

  function editarPalabra(i: number, valor: string) {
    if (!guion) return;
    const palabras = guion.palabras.map((p, j) => (j === i ? valor : p));
    // Si se renombra la que gana, gana la renombrada: si no, el sorteo se
    // pararia en una palabra que ya no esta en el bombo.
    const elegida = guion.palabras[i] === guion.elegida ? valor : guion.elegida;
    setGuion({ ...guion, palabras, elegida });
  }

  function quitarPalabra(i: number) {
    if (!guion || guion.palabras.length <= 4) return;
    const palabras = guion.palabras.filter((_, j) => j !== i);
    const elegida = guion.palabras[i] === guion.elegida ? palabras[0] : guion.elegida;
    setGuion({ ...guion, palabras, elegida });
  }

  async function escribir() {
    setOcupado("escribir");
    setError("");
    setOk("");
    try {
      const g = await api.post<GuionSadButTrue>("/api/sadbuttrue", {
        tema,
        tono,
        motor,
        modelo,
        idioma,
        region,
        modismos,
      });
      setGuion(g);
      setOk(
        `Sorteo escrito con ${g.motorUsado ?? motor}: ${g.palabras.length} palabras, gana "${g.elegida}". ` +
          `Cambia lo que quieras antes de montarlo.${g.avisoMotor ? ` ${g.avisoMotor}` : ""}`,
      );
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  async function montar() {
    if (!guion) return;
    if (!guion.palabras.some((p) => p.toLowerCase() === guion.elegida.toLowerCase())) {
      setError("La palabra que gana tiene que ser una de las del sorteo.");
      return;
    }
    setOcupado("montar");
    setError("");
    setOk("");
    try {
      const p = await api.post<Proyecto & { aviso?: string }>("/api/sadbuttrue/video", {
        guion,
        formato,
        idioma,
        bancos,
        medios: tiposMedio,
        revelarFrase,
        tiempos,
      });
      if (p.aviso) setError(p.aviso);
      setAbierto(p.id);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>1. El sorteo</h2>
        <p className="suave">
          Diez segundos, sin voz: sobre negro pasan palabras como en un sorteo, se para en una, y
          sobre un video cualquiera aparece la frase que le toca. Cierra en negro con un remate que
          se desvanece.
        </p>
        <div className="campos">
          <div>
            <label htmlFor="temaSbt">De que va el sorteo (vacio = lo elige la IA)</label>
            <input
              id="temaSbt"
              value={tema}
              placeholder="cosas que ibas a empezar el lunes"
              onChange={(e) => setTema(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="tonoSbt">Tono del remate</label>
            <select id="tonoSbt" value={tono} onChange={(e) => setTono(e.target.value as TonoSadButTrue | "")}>
              {TONOS.map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="idiomaSbt">Idioma</label>
            <select id="idiomaSbt" value={idioma} onChange={(e) => setIdioma(e.target.value as Idioma)}>
              {catalogo.idiomas.map((i) => (
                <option key={i} value={i}>
                  {nombreIdioma(catalogo, i)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fmtSbt">Formato</label>
            <select id="fmtSbt" value={formato} onChange={(e) => setFormato(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
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
          <SelectorMotor
            catalogo={catalogo}
            valor={motor}
            alCambiar={setMotor}
            modelo={modelo}
            alCambiarModelo={setModelo}
          />
        </div>
        <div className="pie">
          <button className="primario" onClick={escribir} disabled={ocupado !== ""}>
            {ocupado === "escribir" ? "Escribiendo..." : "Escribir el sorteo"}
          </button>
        </div>
      </section>

      {guion && (
        <section className="tarjeta">
          <h2>2. Lee y corrige</h2>
          <div className="campos">
            <div>
              <label htmlFor="tituloSbt">Titulo</label>
              <input id="tituloSbt" value={guion.titulo} onChange={(e) => editar({ titulo: e.target.value })} />
            </div>
            <div>
              <label htmlFor="ganaSbt">Cual gana</label>
              <select id="ganaSbt" value={guion.elegida} onChange={(e) => editar({ elegida: e.target.value })}>
                {guion.palabras.map((p, i) => (
                  <option key={i} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="suave" style={{ marginBottom: 4 }}>
            Las del bombo. Que sean de la misma familia: si no lo son, no parece un sorteo sino una
            lista. La que gana no se ensena hasta el final.
          </p>
          <div className="lista">
            {guion.palabras.map((p, i) => (
              <div className="fila" key={i}>
                <input
                  aria-label={`Palabra ${i + 1}`}
                  value={p}
                  onChange={(e) => editarPalabra(i, e.target.value)}
                />
                {p === guion.elegida && <span className="suave">gana</span>}
                <button onClick={() => quitarPalabra(i)} disabled={guion.palabras.length <= 4}>
                  Quitar
                </button>
              </div>
            ))}
          </div>
          <div className="pie">
            <button
              onClick={() => editar({ palabras: [...guion.palabras, ""] })}
              disabled={guion.palabras.length >= 14}
            >
              Anadir palabra
            </button>
          </div>

          <div className="campos" style={{ marginTop: 12 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="fraseSbt">La frase (va sobre el video, un poco desmotivadora)</label>
              <textarea id="fraseSbt" rows={3} value={guion.frase} onChange={(e) => editar({ frase: e.target.value })} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="remateSbt">El remate (cierra sobre negro)</label>
              <textarea
                id="remateSbt"
                rows={2}
                value={guion.remate}
                onChange={(e) => editar({ remate: e.target.value })}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="kwSbt">Con que se busca el video del medio (en ingles)</label>
              <input
                id="kwSbt"
                value={guion.keywords.join(", ")}
                onChange={(e) =>
                  editar({ keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })
                }
              />
            </div>
          </div>
        </section>
      )}

      {guion && (
        <section className="tarjeta">
          <h2>3. El video</h2>
          <div className="campos">
            <div>
              <label htmlFor="sorteoSeg">Pantalla negra del sorteo (s)</label>
              <input
                id="sorteoSeg"
                type="number"
                min={0.8}
                max={8}
                step="0.5"
                value={tiempos.sorteoSeg}
                onChange={(e) => cambiarTiempo({ sorteoSeg: Number(e.target.value) || TIEMPOS.sorteoSeg })}
              />
            </div>
            <div>
              <label htmlFor="retencionSeg">De esa, cuanto se queda la que gana (s)</label>
              <input
                id="retencionSeg"
                type="number"
                min={0.3}
                max={4}
                step="0.1"
                value={tiempos.retencionSeg}
                onChange={(e) => cambiarTiempo({ retencionSeg: Number(e.target.value) || TIEMPOS.retencionSeg })}
              />
            </div>
            <div>
              <label htmlFor="clipSeg">Video con la frase (s)</label>
              <input
                id="clipSeg"
                type="number"
                min={2}
                max={15}
                step="0.5"
                value={tiempos.clipSeg}
                onChange={(e) => cambiarTiempo({ clipSeg: Number(e.target.value) || TIEMPOS.clipSeg })}
              />
            </div>
            <div>
              <label htmlFor="cierreSeg">Negro final con el remate (s)</label>
              <input
                id="cierreSeg"
                type="number"
                min={1}
                max={10}
                step="0.5"
                value={tiempos.cierreSeg}
                onChange={(e) => cambiarTiempo({ cierreSeg: Number(e.target.value) || TIEMPOS.cierreSeg })}
              />
            </div>
            <div>
              <label htmlFor="revelarSbt">Como entra la frase</label>
              <select
                id="revelarSbt"
                value={revelarFrase ? "palabra" : "entera"}
                onChange={(e) => setRevelarFrase(e.target.value === "palabra")}
              >
                <option value="entera">Entera, de golpe</option>
                <option value="palabra">Escribiendose palabra a palabra</option>
              </select>
            </div>
            <SelectorBancos
              catalogo={catalogo}
              bancos={bancos}
              medios={tiposMedio}
              alCambiar={(b, m) => {
                setBancos(b);
                setTiposMedio(m);
              }}
            />
          </div>
          <p className="suave">
            Duracion: <strong>{total.toFixed(1)}s</strong> · {tiempos.sorteoSeg}s de sorteo (la que gana
            se queda {tiempos.retencionSeg}s) + {tiempos.clipSeg}s de video + {tiempos.cierreSeg}s de
            negro. El video sale al azar de las bibliotecas y entra por un punto cualquiera de su
            metraje, asi que dos videos del mismo tema no se parecen.
          </p>
          <div className="pie">
            <button className="primario" onClick={montar} disabled={ocupado !== ""}>
              {ocupado === "montar" ? "Montando..." : "Montar el video"}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
