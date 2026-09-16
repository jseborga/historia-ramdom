import { useEffect, useState } from "react";
import {
  api,
  type Catalogo,
  type Fusion,
  type Idioma,
  type Instrumental as Pista,
  type Ritmo,
  type UsoPista,
} from "../api";
import { mensajeDe } from "../App";
import { SelectorMotor, motorInicial, nombreIdioma } from "./comunes";

/**
 * Instrumentales y fusiones: mezclar géneros y pedírselo a Suno bien.
 *
 * Lo que esta pantalla hace y no hace ninguna otra es **separar lo que va a
 * Suno de lo que no**. Un modelo de texto escribe acotaciones —`[la guitarra
 * entra con rabia]`— porque es lo natural en un guion, y Suno eso se lo canta
 * dentro del tema. Aquí se revisa: entre corchetes solo quedan etiquetas que
 * Suno entiende, y las acotaciones bajan a las notas de arreglo, que son para
 * la persona que monta.
 */

export function Instrumental({ catalogo }: { catalogo: Catalogo }) {
  const [ritmos, setRitmos] = useState<string[]>([]);
  const [uso, setUso] = useState("ambiente");
  const [duracion, setDuracion] = useState(120);
  const [energia, setEnergia] = useState(3);
  const [notas, setNotas] = useState("");
  const [tema, setTema] = useState("");
  const [conLetra, setConLetra] = useState(false);
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [motor, setMotor] = useState(motorInicial(catalogo));
  const [modelo, setModelo] = useState<string | null>(null);

  const [catalogoRitmos, setCatalogoRitmos] = useState<Ritmo[]>([]);
  const [familias, setFamilias] = useState<string[]>([]);
  const [fusiones, setFusiones] = useState<Fusion[]>([]);
  const [usos, setUsos] = useState<UsoPista[]>([]);
  const [instrucciones, setInstrucciones] = useState<string[]>([]);
  const [pista, setPista] = useState<Pista | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    api
      .get<{
        ritmos: Ritmo[];
        familias: string[];
        fusiones: Fusion[];
        usos: UsoPista[];
        instruccionesInstrumental: string[];
      }>("/api/remix/ritmos")
      .then((r) => {
        setCatalogoRitmos(r.ritmos);
        setFamilias(r.familias ?? []);
        setFusiones(r.fusiones ?? []);
        setUsos(r.usos ?? []);
        setInstrucciones(r.instruccionesInstrumental ?? []);
      })
      .catch((err) => setError(mensajeDe(err)));
  }, []);

  const nombreDe = (id: string) => catalogoRitmos.find((r) => r.id === id)?.nombre ?? id;

  const alternar = (id: string) =>
    setRitmos(ritmos.includes(id) ? ritmos.filter((r) => r !== id) : ritmos.length < 4 ? [...ritmos, id] : ritmos);

  /** Las mezclas sugeridas: las de lo ya elegido, o unas cuantas de ejemplo. */
  const sugeridas = ritmos.length
    ? fusiones.filter((f) => f.ids.some((id) => ritmos.includes(id)))
    : fusiones.slice(0, 6);

  async function escribir() {
    setOcupado("escribir");
    setError("");
    setOk("");
    try {
      const p = await api.post<Pista>("/api/instrumental", {
        ritmos,
        uso,
        duracion,
        energia,
        notas,
        tema,
        conLetra,
        idioma,
        motor,
        modelo,
      });
      setPista(p);
      setOk(
        `Pista escrita con ${p.motorUsado ?? motor}.${p.avisoMotor ? ` ${p.avisoMotor}` : ""}` +
          (p.avisos.length ? ` Se limpiaron ${p.avisos.length} corchetes que Suno habria cantado.` : ""),
      );
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  async function descargar() {
    if (!pista) return;
    try {
      const res = await fetch("/api/instrumental/texto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pista }),
      });
      if (!res.ok) throw new Error("No se pudo preparar el texto");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${pista.titulo.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-suno.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  const copiar = (texto: string, que: string) =>
    navigator.clipboard?.writeText(texto).then(
      () => setOk(`${que} copiado.`),
      () => setError("El navegador no dejo copiar; selecciona el texto a mano."),
    );

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>1. Que se mezcla</h2>
        <p className="suave">
          De uno a cuatro generos. Con dos o tres es cuando la mezcla dice algo: uno pone la base
          ritmica, otro la armonia o el timbre. Jazz con metal, blues con dub, huayño con post-rock.
        </p>

        {(familias.length ? familias : [...new Set(catalogoRitmos.map((r) => r.familia))]).map((familia) => {
          const dentro = catalogoRitmos.filter((r) => r.familia === familia);
          if (!dentro.length) return null;
          return (
            <div key={familia} style={{ marginBottom: 10 }}>
              <p className="suave" style={{ margin: "6px 0 4px" }}>
                {familia}
              </p>
              <div className="fila" style={{ flexWrap: "wrap", gap: 6 }}>
                {dentro.map((r) => {
                  const puesto = ritmos.indexOf(r.id);
                  return (
                    <button
                      key={r.id}
                      className={puesto >= 0 ? "primario" : ""}
                      title={`${r.estilo} · ${r.bpm} BPM`}
                      onClick={() => alternar(r.id)}
                    >
                      {r.nombre}
                      {puesto >= 0 ? ` (${puesto + 1})` : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {sugeridas.length > 0 && (
          <div className="item" style={{ marginTop: 8 }}>
            <strong>{ritmos.length ? "Mezclas que funcionan con lo que elegiste" : "Mezclas que funcionan"}</strong>
            <div className="lista">
              {sugeridas.slice(0, 8).map((f) => (
                <div key={f.nombre} style={{ marginBottom: 6 }}>
                  <button onClick={() => setRitmos(f.ids)}>{f.nombre}</button>
                  <p className="suave" style={{ margin: "4px 0 0" }}>
                    {f.nota}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="tarjeta">
        <h2>2. Para que es</h2>
        <div className="campos">
          <div>
            <label htmlFor="usoPista">Uso</label>
            <select id="usoPista" value={uso} onChange={(e) => setUso(e.target.value)}>
              {usos.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="durPista">Duracion (segundos)</label>
            <input
              id="durPista"
              type="number"
              min={15}
              max={600}
              value={duracion}
              onChange={(e) => setDuracion(Number(e.target.value) || 120)}
            />
          </div>
          <div>
            <label htmlFor="energiaPista">Energia ({energia} de 5)</label>
            <input
              id="energiaPista"
              type="range"
              min={1}
              max={5}
              step={1}
              value={energia}
              onChange={(e) => setEnergia(Number(e.target.value))}
            />
          </div>
          <div>
            <label htmlFor="vozPista">Voz</label>
            <select id="vozPista" value={conLetra ? "letra" : "no"} onChange={(e) => setConLetra(e.target.value === "letra")}>
              <option value="no">Instrumental (sin voz)</option>
              <option value="letra">Con letra</option>
            </select>
          </div>
          {conLetra && (
            <div>
              <label htmlFor="idiomaPista">Idioma de la letra</label>
              <select id="idiomaPista" value={idioma} onChange={(e) => setIdioma(e.target.value as Idioma)}>
                {catalogo.idiomas.map((i) => (
                  <option key={i} value={i}>
                    {nombreIdioma(catalogo, i)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <SelectorMotor
            catalogo={catalogo}
            valor={motor}
            alCambiar={setMotor}
            modelo={modelo}
            alCambiarModelo={setModelo}
          />
        </div>

        <div className="campos" style={{ marginTop: 8 }}>
          <div>
            <label htmlFor="temaPista">Que evoca (opcional)</label>
            <input
              id="temaPista"
              value={tema}
              placeholder="una ciudad de noche bajo la lluvia"
              onChange={(e) => setTema(e.target.value)}
            />
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <label htmlFor="notasPista">Instrumentos, referencias o lo que hay que evitar (opcional)</label>
          <textarea
            id="notasPista"
            value={notas}
            rows={2}
            placeholder="que el saxo lleve la melodia; nada de doble bombo; que no suba de golpe"
            onChange={(e) => setNotas(e.target.value)}
          />
        </div>

        <div className="pie">
          <button className="primario" onClick={escribir} disabled={!ritmos.length || ocupado !== ""}>
            {ocupado === "escribir" ? "Escribiendo..." : pista ? "Escribir otra" : "Escribir las instrucciones"}
          </button>
          <span className="suave">
            {ritmos.length
              ? `${ritmos.map(nombreDe).join(" + ")}`
              : "Elige al menos un genero."}
          </span>
        </div>
      </section>

      {pista && (
        <section className="tarjeta">
          <div className="fila" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>3. {pista.titulo}</h2>
            <span className="suave">
              {[pista.bpm ? `${pista.bpm} BPM` : "", pista.tonalidad, pista.conVoz ? "con voz" : "instrumental"]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <button onClick={descargar}>Descargar .txt</button>
          </div>
          {pista.porQue && <p className="suave">{pista.porQue}</p>}

          {pista.avisos.length > 0 && (
            <div className="aviso">
              <strong>Corchetes revisados.</strong> Esto estaba escrito como si fuera una instruccion
              para Suno, pero Suno no lo entiende y lo habria cantado dentro del tema. Se saco de la
              caja de letra y esta abajo, en las notas de arreglo.
              <ul>
                {pista.avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          <label htmlFor="estiloPista">Suno · Style of Music ({pista.estilo.length}/200)</label>
          <div className="fila">
            <input id="estiloPista" readOnly value={pista.estilo} />
            <button onClick={() => copiar(pista.estilo, "Estilo")}>Copiar</button>
          </div>

          {pista.excluir && (
            <>
              <label htmlFor="excluirPista">Suno · Exclude styles</label>
              <div className="fila">
                <input id="excluirPista" readOnly value={pista.excluir} />
                <button onClick={() => copiar(pista.excluir, "Exclusiones")}>Copiar</button>
              </div>
            </>
          )}

          <div className="fila" style={{ marginTop: 8 }}>
            <label htmlFor="cajaPista" style={{ margin: 0 }}>
              Suno · Lyrics {pista.conVoz ? "(letra con sus etiquetas)" : "(solo las etiquetas: es instrumental)"}
            </label>
            <button onClick={() => copiar(pista.cajaLetra, "Contenido de la caja de letra")}>Copiar</button>
          </div>
          <textarea id="cajaPista" readOnly rows={pista.conVoz ? 14 : 8} value={pista.cajaLetra} />

          {pista.aportes.length > 0 && (
            <div className="item" style={{ marginTop: 8 }}>
              <strong>Que pone cada genero</strong>
              <ul className="suave">
                {pista.aportes.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          {pista.estructura.length > 0 && (
            <div className="item">
              <strong>Estructura</strong>
              <div className="lista">
                {pista.estructura.map((s, i) => (
                  <div className="fila" key={i} style={{ alignItems: "flex-start" }}>
                    <code>[{s.etiqueta}]</code>
                    <span className="suave">
                      {s.segundos ? `${s.segundos}s · ` : ""}
                      {s.que}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pista.indicaciones && (
            <div className="item">
              <strong>Notas de arreglo</strong>
              <p className="suave">Esto NO se pega en Suno: es para ti, para saber que pedir si hay que repetir.</p>
              <p className="suave" style={{ whiteSpace: "pre-wrap" }}>
                {pista.indicaciones}
              </p>
            </div>
          )}

          {instrucciones.length > 0 && (
            <div className="item">
              <strong>Como pedirla en Suno</strong>
              <ol className="suave">
                {instrucciones.map((i, n) => (
                  <li key={n}>{i.replace(/^\d+\.\s*/, "").replace(/\*\*/g, "")}</li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}
    </>
  );
}
