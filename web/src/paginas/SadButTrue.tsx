import { useEffect, useState } from "react";
import {
  api,
  type Catalogo,
  type GuionSadButTrue,
  type Idioma,
  type Preset,
  type Proyecto,
  type Region,
  type TemaBanco,
  type TonoSadButTrue,
} from "../api";
import { mensajeDe } from "../App";
import { SelectorBancos, SelectorMotor, SelectorRegion, motorInicial, nombreIdioma } from "./comunes";
import { EditorMontaje } from "./EditorMontaje";
import { BancoFrases } from "./BancoFrases";

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

const TIEMPOS = { sorteoSeg: 3, retencionSeg: 0, clipSeg: 3.5, cierreSeg: 2 };

/**
 * Lo que se tarda en leer un texto en pantalla. Misma cuenta que el servidor
 * (src/servicios/sadButTrue.ts), aqui solo para poder enseñarlo antes.
 */
function tiempoDeLectura(texto: string, minimo: number): number {
  const cuantas = texto.trim().split(/\s+/).filter(Boolean).length;
  return Number(Math.min(Math.max(1 + cuantas * 0.33, minimo), 14).toFixed(2));
}

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
  /** Cuanto se quedan los textos: lo que se tarda en leerlos, o a mano. */
  const [lecturaAuto, setLecturaAuto] = useState(true);
  const [revelarFrase, setRevelarFrase] = useState(false);
  const [vista, setVista] = useState<"video" | "banco">("video");
  const [temas, setTemas] = useState<TemaBanco[]>([]);
  const [temaBanco, setTemaBanco] = useState("");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [guion, setGuion] = useState<GuionSadButTrue | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    api.get<Preset[]>("/api/presets").then(setPresets).catch(() => {});
  }, []);

  // Los temas del banco: son los que se pueden sortear sin IA.
  useEffect(() => {
    if (vista !== "video") return;
    api
      .get<{ temas: TemaBanco[] }>("/api/frases")
      .then((r) => setTemas(r.temas))
      .catch(() => {});
  }, [vista]);

  if (abierto) {
    return <EditorMontaje id={abierto} catalogo={catalogo} alSalir={() => setAbierto(null)} />;
  }

  // Lo que va a durar de verdad: en automatico, lo que se tarde en leer.
  const clipSeg = lecturaAuto && guion ? tiempoDeLectura(guion.frase, TIEMPOS.clipSeg) : tiempos.clipSeg;
  const cierreSeg = lecturaAuto && guion ? tiempoDeLectura(guion.remate, TIEMPOS.cierreSeg) : tiempos.cierreSeg;
  // Lo que el montaje anade por su cuenta: la media disolucion que se le come
  // a cada texto, el apagon del rojo y el segundo de negro del final.
  // Media disolucion del video + el negro de por medio + media entrada del
  // rojo + medio apagon + el segundo de negro final.
  const EXTRAS = 0.3 + 1 + 0.3 + 0.2 + 1;
  const total = tiempos.sorteoSeg + clipSeg + cierreSeg + EXTRAS;
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

  /** Un guion del banco, sin gastar IA: instantaneo y siempre distinto. */
  async function sortear() {
    setOcupado("sortear");
    setError("");
    setOk("");
    try {
      const g = await api.post<GuionSadButTrue>("/api/sadbuttrue/azar", {
        tema: temaBanco,
        tono,
        idioma,
      });
      setGuion(g);
      setOk(`Sacado del banco: gana "${g.elegida}". Sin IA, y ya no vuelve a salir hasta que hayan salido las demas.`);
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
        // En automatico no se mandan los dos de texto: sin ellos, cada uno se
        // queda lo que se tarda en leerlo.
        tiempos: lecturaAuto
          ? { sorteoSeg: tiempos.sorteoSeg, retencionSeg: tiempos.retencionSeg }
          : tiempos,
      });
      if (p.aviso) setError(p.aviso);
      setAbierto(p.id);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  const pestanas = (
    <div className="fila" style={{ marginBottom: 12 }}>
      <button className={vista === "video" ? "activo" : ""} onClick={() => setVista("video")}>
        Hacer un video
      </button>
      <button className={vista === "banco" ? "activo" : ""} onClick={() => setVista("banco")}>
        Banco de frases
      </button>
    </div>
  );

  if (vista === "banco") {
    return (
      <>
        {pestanas}
        <BancoFrases catalogo={catalogo} />
      </>
    );
  }

  return (
    <>
      {pestanas}
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>1. El sorteo</h2>
        <p className="suave">
          Once segundos, sin voz: palabras en gris pasando a toda velocidad sobre negro hasta que
          se para en el arranque de la frase que gana, en amarillo; al corte, el video la termina.
          Despues se apaga a negro, sale una pantalla roja con el remate en blanco y cierra en
          negro.
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
        <div className="campos">
          <div>
            <label htmlFor="temaBanco">Del banco, tema</label>
            <select id="temaBanco" value={temaBanco} onChange={(e) => setTemaBanco(e.target.value)}>
              <option value="">cualquiera</option>
              {temas.map((t) => (
                <option key={t.tema} value={t.tema} disabled={t.cuantas < 4}>
                  {t.tema} ({t.cuantas}){t.cuantas < 4 ? " - faltan palabras" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="suave">
          El banco tiene {temas.reduce((n, t) => n + t.cuantas, 0)} parejas guardadas. Sacar de ahi es
          instantaneo y no gasta IA; lo que escriba la IA se guarda tambien, asi que el banco crece
          solo. Se administra en <strong>Banco de frases</strong>.
        </p>
        <div className="pie">
          <button className="primario" onClick={sortear} disabled={ocupado !== ""}>
            {ocupado === "sortear" ? "Sacando..." : "Sacar del banco (sin IA)"}
          </button>
          <button onClick={escribir} disabled={ocupado !== ""}>
            {ocupado === "escribir" ? "Escribiendo..." : "Escribir uno nuevo con IA"}
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
              <label htmlFor="retencionSeg">Parar en el arranque de la frase (s)</label>
              <input
                id="retencionSeg"
                type="number"
                min={0}
                max={4}
                step="0.1"
                value={tiempos.retencionSeg}
                onChange={(e) => cambiarTiempo({ retencionSeg: Number(e.target.value) || TIEMPOS.retencionSeg })}
              />
            </div>
            <div>
              <label htmlFor="lecturaAuto">Cuanto se quedan los textos</label>
              <select
                id="lecturaAuto"
                value={lecturaAuto ? "auto" : "mano"}
                onChange={(e) => setLecturaAuto(e.target.value === "auto")}
              >
                <option value="auto">lo que se tarde en leerlos</option>
                <option value="mano">los segundos que yo diga</option>
              </select>
            </div>
            <div>
              <label htmlFor="clipSeg">Cuanto se ve la frase (s)</label>
              <input
                id="clipSeg"
                type="number"
                min={2}
                max={15}
                step="0.5"
                value={clipSeg}
                disabled={lecturaAuto}
                onChange={(e) => cambiarTiempo({ clipSeg: Number(e.target.value) || TIEMPOS.clipSeg })}
              />
            </div>
            <div>
              <label htmlFor="cierreSeg">Cuanto se ve el remate (s)</label>
              <input
                id="cierreSeg"
                type="number"
                min={1}
                max={10}
                step="0.5"
                value={cierreSeg}
                disabled={lecturaAuto}
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
            Duracion: <strong>{total.toFixed(1)}s</strong> · {tiempos.sorteoSeg}s de sorteo (
            {tiempos.retencionSeg ? ` para ${tiempos.retencionSeg}s en la que gana` : " sin parar"}) +{" "}
            {clipSeg}s de frase + {cierreSeg}s de remate, el paso por negro entre el video y el
            rojo del cierre —que es lo que hace suave el cambio— y un segundo de negro al final.
            {lecturaAuto
              ? " Los dos textos se quedan lo que se tarda en leerlos (un segundo en darse cuenta y 0,33s por palabra), con 3,5 y 2 segundos de suelo: aqui no hay voz que marque el ritmo y no hay forma de volver atras."
              : " Ojo con quedarte corto: sin voz, un texto que se va antes de tiempo no se entiende."}{" "}
            El video sale al azar de las bibliotecas y entra por un punto cualquiera de su metraje,
            asi que dos videos del mismo tema no se parecen.
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
