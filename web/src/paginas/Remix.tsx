import { useEffect, useState } from "react";
import { api, type Catalogo, type Idioma, type Region, type Remix as RemixDatos, type Ritmo } from "../api";
import { mensajeDe } from "../App";
import { SelectorMotor, SelectorRegion, motorInicial } from "./comunes";

/**
 * Remix: la misma canción en otros ritmos, con todo listo para Suno.
 *
 * Se pega la letra (o solo el tema), se eligen los ritmos y salen varias
 * versiones: la letra con sus etiquetas de sección, la caja de estilo, lo que
 * hay que excluir, el tempo y el trozo que va en el corto vertical.
 *
 * Lo primero que se pregunta es de quién es la letra, y no es burocracia:
 * reescribir la canción de otro es hacer una obra derivada y eso necesita su
 * permiso. Si la letra es ajena, de ella solo se toma el tema y lo que sale es
 * una canción nueva; además se comprueba que no se haya colado ninguna frase.
 */

const EJEMPLO = `[Verso]
Escribe aquí la letra, o deja esto vacío y pon solo el tema

[Coro]
...`;

export function Remix({
  catalogo,
  alUsarLetra,
}: {
  catalogo: Catalogo;
  /** Lleva una versión a la pestaña Videoclip, con su título y su letra. */
  alUsarLetra: (titulo: string, letra: string) => void;
}) {
  const [letra, setLetra] = useState("");
  const [origen, setOrigen] = useState<"propia" | "ajena">("propia");
  const [titulo, setTitulo] = useState("");
  const [tema, setTema] = useState("");
  const [notas, setNotas] = useState("");
  const [ritmos, setRitmos] = useState<string[]>([]);
  const [viral, setViral] = useState(true);
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [region, setRegion] = useState<Region>("bolivia");
  const [modismos, setModismos] = useState(true);
  const [motor, setMotor] = useState(motorInicial(catalogo));
  const [modelo, setModelo] = useState<string | null>(null);

  const [catalogoRitmos, setCatalogoRitmos] = useState<Ritmo[]>([]);
  const [instrucciones, setInstrucciones] = useState<string[]>([]);
  const [remix, setRemix] = useState<RemixDatos | null>(null);
  const [abierta, setAbierta] = useState(0);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    api
      .get<{ ritmos: Ritmo[]; instrucciones: string[] }>("/api/remix/ritmos")
      .then((r) => {
        setCatalogoRitmos(r.ritmos);
        setInstrucciones(r.instrucciones);
      })
      .catch((err) => setError(mensajeDe(err)));
  }, []);

  const alternarRitmo = (id: string) =>
    setRitmos(ritmos.includes(id) ? ritmos.filter((r) => r !== id) : ritmos.length < 6 ? [...ritmos, id] : ritmos);

  async function escribir() {
    setOcupado("escribir");
    setError("");
    setOk("");
    try {
      const r = await api.post<RemixDatos>("/api/remix", {
        letra,
        origen,
        tema,
        titulo,
        ritmos,
        viral,
        notas,
        idioma,
        region,
        modismos,
        motor,
        modelo,
      });
      setRemix(r);
      setAbierta(0);
      setOk(
        `${r.versiones.length} ${r.versiones.length === 1 ? "version escrita" : "versiones escritas"} con ${
          r.motorUsado ?? motor
        }.${r.avisoMotor ? ` ${r.avisoMotor}` : ""}`,
      );
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  async function descargar() {
    if (!remix) return;
    try {
      const res = await fetch("/api/remix/texto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remix, titulo: titulo || "Remix" }),
      });
      if (!res.ok) throw new Error("No se pudo preparar el texto");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(titulo || "remix").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-suno.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  const copiar = (texto: string, que: string) => {
    navigator.clipboard?.writeText(texto).then(
      () => setOk(`${que} copiado.`),
      () => setError("El navegador no dejo copiar; selecciona el texto a mano."),
    );
  };

  const version = remix?.versiones[abierta];
  const listo = (letra.trim().length > 20 || tema.trim().length > 3) && ritmos.length > 0;

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>1. La cancion de partida</h2>
        <p className="suave">
          Pega la letra, o deja el campo vacio y escribe solo de que va. De ahi salen varias versiones
          en los ritmos que elijas, cada una con su letra y con las cajas de Suno listas para pegar.
        </p>

        <div className="campos">
          <div>
            <label htmlFor="origenLetra">De quien es la letra</label>
            <select
              id="origenLetra"
              value={origen}
              onChange={(e) => setOrigen(e.target.value as typeof origen)}
            >
              <option value="propia">Es mia (o tengo los derechos)</option>
              <option value="ajena">Es de otro autor</option>
            </select>
          </div>
          <div>
            <label htmlFor="tituloRemix">Titulo</label>
            <input
              id="tituloRemix"
              value={titulo}
              placeholder="como se llama (o como quieres que se llame)"
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="temaRemix">De que va (si no pegas letra, esto es obligatorio)</label>
            <input
              id="temaRemix"
              value={tema}
              placeholder="volver al barrio despues de años fuera"
              onChange={(e) => setTema(e.target.value)}
            />
          </div>
        </div>

        {origen === "ajena" && (
          <p className="aviso">
            Con letra ajena no se reescribe nada: reescribir la cancion de otro es hacer una obra
            derivada y eso necesita su permiso. Se toma solo el tema y se escribe una cancion nueva.
            Al terminar se comprueba que no se haya colado ninguna frase del original.
          </p>
        )}

        <div style={{ marginTop: 12 }}>
          <label htmlFor="letraRemix">Letra</label>
          <textarea
            id="letraRemix"
            value={letra}
            rows={10}
            placeholder={EJEMPLO}
            onChange={(e) => setLetra(e.target.value)}
          />
        </div>
      </section>

      <section className="tarjeta">
        <h2>2. A que ritmos</h2>
        <p className="suave">
          Hasta seis. Cada uno se escribe con su propia metrica: la misma idea no se canta igual en
          una cumbia que en un drill.
        </p>
        <div className="fila" style={{ flexWrap: "wrap", gap: 6 }}>
          {catalogoRitmos.map((r) => {
            const puesto = ritmos.indexOf(r.id);
            return (
              <button
                key={r.id}
                className={puesto >= 0 ? "primario" : ""}
                title={`${r.estilo} · ${r.bpm} BPM`}
                onClick={() => alternarRitmo(r.id)}
              >
                {r.nombre}
                {puesto >= 0 ? ` (${puesto + 1})` : ""}
              </button>
            );
          })}
        </div>

        <div className="campos" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="viralRemix">Para el formato corto</label>
            <select id="viralRemix" value={viral ? "si" : "no"} onChange={(e) => setViral(e.target.value === "si")}>
              <option value="si">Si: gancho al principio y frase que se pega</option>
              <option value="no">No: cancion normal, con su desarrollo</option>
            </select>
          </div>
          <div>
            <label htmlFor="idiomaRemix">Idioma</label>
            <select id="idiomaRemix" value={idioma} onChange={(e) => setIdioma(e.target.value as Idioma)}>
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
          <SelectorMotor
            catalogo={catalogo}
            valor={motor}
            alCambiar={setMotor}
            modelo={modelo}
            alCambiarModelo={setModelo}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <label htmlFor="notasRemix">Que conservar o que cambiar (opcional)</label>
          <textarea
            id="notasRemix"
            value={notas}
            rows={2}
            placeholder="el coro no se toca; quita lo del invierno; que no suene triste"
            onChange={(e) => setNotas(e.target.value)}
          />
        </div>

        <div className="pie">
          <button className="primario" onClick={escribir} disabled={!listo || ocupado !== ""}>
            {ocupado === "escribir" ? "Escribiendo..." : remix ? "Escribir otra vez" : "Escribir las versiones"}
          </button>
          <span className="suave">
            {listo
              ? `${ritmos.length} ${ritmos.length === 1 ? "ritmo elegido" : "ritmos elegidos"}`
              : "Falta la letra (o el tema) y al menos un ritmo."}
          </span>
        </div>
      </section>

      {remix && (
        <section className="tarjeta">
          <div className="fila" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>3. Las versiones</h2>
            <button onClick={descargar}>Descargar todo en .txt</button>
          </div>
          {remix.esencia && (
            <p className="suave">
              <strong>Esencia:</strong> {remix.esencia}
            </p>
          )}

          {remix.calcos.length > 0 && (
            <div className="aviso error">
              <strong>Revisa esto antes de publicar.</strong> Estas frases del original aparecen tal
              cual en el resultado, asi que no son tuyas: cambialas.
              <ul>
                {remix.calcos.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="fila" style={{ flexWrap: "wrap", gap: 6 }}>
            {remix.versiones.map((v, i) => (
              <button key={i} className={i === abierta ? "primario" : ""} onClick={() => setAbierta(i)}>
                {v.ritmo}
              </button>
            ))}
          </div>

          {version && (
            <div className="item" style={{ marginTop: 12 }}>
              <div className="fila">
                <strong>{version.titulo}</strong>
                <span className="suave">
                  {[version.ritmo, version.bpm && `${version.bpm} BPM`, version.tonalidad]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>

              <label htmlFor="estiloSuno">Suno · Style of Music ({version.estilo.length}/200)</label>
              <div className="fila">
                <input id="estiloSuno" readOnly value={version.estilo} />
                <button onClick={() => copiar(version.estilo, "Estilo")}>Copiar</button>
              </div>

              {version.excluir && (
                <>
                  <label htmlFor="excluirSuno">Suno · Exclude styles</label>
                  <div className="fila">
                    <input id="excluirSuno" readOnly value={version.excluir} />
                    <button onClick={() => copiar(version.excluir, "Exclusiones")}>Copiar</button>
                  </div>
                </>
              )}

              <div className="fila" style={{ marginTop: 8 }}>
                <label htmlFor="letraVersion" style={{ margin: 0 }}>
                  Letra (campo Lyrics, modo Custom)
                </label>
                <button onClick={() => copiar(version.letra, "Letra")}>Copiar</button>
                <button onClick={() => alUsarLetra(version.titulo, version.letra)}>
                  Usar en un videoclip
                </button>
              </div>
              <textarea id="letraVersion" readOnly rows={14} value={version.letra} />

              {version.gancho && (
                <p className="suave">
                  <strong>Los 15 segundos del corto:</strong> {version.gancho}
                </p>
              )}
              {version.indicaciones && (
                <p className="suave">
                  <strong>Como cantarla:</strong> {version.indicaciones}
                </p>
              )}
              {version.porQue && (
                <p className="suave">
                  <strong>Por que este ritmo:</strong> {version.porQue}
                </p>
              )}
            </div>
          )}

          {(remix.ganchos.length > 0 || remix.hashtags.length > 0) && (
            <div className="item" style={{ marginTop: 12 }}>
              <strong>Para publicar</strong>
              {remix.ganchos.map((g, i) => (
                <p className="suave" key={i}>
                  {g}
                </p>
              ))}
              {remix.hashtags.length > 0 && (
                <p className="suave">{remix.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>
              )}
            </div>
          )}

          {instrucciones.length > 0 && (
            <div className="item" style={{ marginTop: 12 }}>
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
