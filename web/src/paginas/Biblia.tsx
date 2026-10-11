import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Catalogo,
  type GuionSadButTrue,
  type LibroBiblia,
  type ListaReferencias,
  type ReferenciaBiblica,
} from "../api";
import { mensajeDe } from "../App";
import { SelectorMotor, motorInicial } from "./comunes";

/**
 * «Aprendiendo con la Biblia»: la serie que recorre la Biblia en orden, un
 * dato curioso por video. Cada video sale de una referencia guardada, con la
 * cita comprobada contra la Reina-Valera 1909 que lleva la app; la IA (o tu)
 * solo escribe la palabra del sorteo, la frase y el cierre, leyendo el
 * versiculo literal.
 */

export const TITULO_SERIE = "Aprendiendo con la Biblia";

type Rango = "todo" | "AT" | "NT";

const RANGOS: [Rango, string][] = [
  ["todo", "Toda la Biblia (Genesis a Apocalipsis)"],
  ["AT", "Antiguo Testamento (Genesis a Malaquias)"],
  ["NT", "Nuevo Testamento (Mateo a Apocalipsis)"],
];

const NOMBRE_ESTADO: Record<ReferenciaBiblica["estado"], string> = {
  pendiente: "por completar",
  revisar: "revisar",
  lista: "lista",
};

const CLASE_ESTADO: Record<ReferenciaBiblica["estado"], string> = {
  pendiente: "",
  revisar: "ERROR",
  lista: "LISTA",
};

/** El paso 1 en la seccion de la Biblia: la serie, en orden. */
export function SerieBiblia({
  alGuion,
  alIrAReferencias,
}: {
  alGuion: (g: GuionSadButTrue, aviso: string) => void;
  alIrAReferencias: () => void;
}) {
  const [titulo, setTitulo] = useState(TITULO_SERIE);
  const [rango, setRango] = useState<Rango>("todo");
  const [datos, setDatos] = useState<ListaReferencias | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    api
      .get<ListaReferencias>(`/api/biblia/referencias?rango=${rango}&estado=lista`)
      .then(setDatos)
      .catch((err) => setError(mensajeDe(err)));
  }, [rango]);
  useEffect(cargar, [cargar]);

  async function preparar(modo: "siguiente" | "azar") {
    setOcupado(modo);
    setError("");
    try {
      const g = await api.post<GuionSadButTrue>("/api/biblia/guion", { modo, rango, titulo });
      alGuion(
        g,
        `${modo === "siguiente" ? "La siguiente de la serie" : "Una al azar"}: ${g.cita}, gana "${g.elegida}". ` +
          "La cita sale del pasaje guardado y el versiculo literal va en la descripcion.",
      );
      cargar();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  const c = datos?.cuentas;
  const s = datos?.siguiente;
  return (
    <section className="tarjeta">
      <h2>1. La serie</h2>
      <p className="suave">
        Abre con el titulo sobre negro, sigue el sorteo, la frase con su cita exacta sobre el video y el cierre de
        aliento o historico. Va en orden, de Genesis a Apocalipsis: cada video toma la siguiente referencia lista que
        todavia no salio.
      </p>
      {error && <p className="aviso error">{error}</p>}
      <div className="campos">
        <div>
          <label htmlFor="tituloSerie">Titulo con el que abre</label>
          <input id="tituloSerie" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={80} />
        </div>
        <div>
          <label htmlFor="rangoSerie">Recorrido</label>
          <select id="rangoSerie" value={rango} onChange={(e) => setRango(e.target.value as Rango)}>
            {RANGOS.map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>
      {c && (
        <p className="suave">
          {c.listas} listas de {c.total} referencias · {c.publicadas} ya salieron · {c.pendientes} por completar
          {c.revisar ? ` · ${c.revisar} para revisar` : ""}.
        </p>
      )}
      {s ? (
        <div className="item">
          <div className="fila">
            <strong>Siguiente: {s.cita}</strong>
            <span className="suave">{s.libroNombre}</span>
            {s.usos > 0 && <span className="estado">ya salio {s.usos}x: la serie dio la vuelta</span>}
          </div>
          <p style={{ margin: "6px 0" }}>
            <span style={{ color: "var(--acento)" }}>{s.palabra}</span>
            {s.frase.slice(s.palabra.length)}
          </p>
          <p className="suave" style={{ margin: 0 }}>
            «{s.texto.length > 260 ? `${s.texto.slice(0, 260)}…` : s.texto}»
          </p>
        </div>
      ) : (
        datos && <p className="aviso error">Todavia no hay referencias listas en este recorrido. Completalas en Referencias.</p>
      )}
      <div className="pie">
        <button className="primario" onClick={() => preparar("siguiente")} disabled={ocupado !== "" || !s}>
          {ocupado === "siguiente" ? "Preparando..." : "Preparar la siguiente"}
        </button>
        <button onClick={() => preparar("azar")} disabled={ocupado !== "" || !s}>
          {ocupado === "azar" ? "Eligiendo..." : "Una al azar"}
        </button>
        <button onClick={alIrAReferencias}>Ver y completar referencias</button>
      </div>
    </section>
  );
}

/** El texto literal bajo el guion: para comprobar a ojo antes de montar. */
export function VersiculoDelGuion({ guion }: { guion: GuionSadButTrue }) {
  if (!guion.cita || !guion.versiculo) return null;
  return (
    <div className="item" style={{ marginTop: 12 }}>
      <strong>Lo que dice el texto · {guion.cita} (Reina-Valera 1909)</strong>
      <p className="suave" style={{ margin: "6px 0 0" }}>
        «{guion.versiculo}»
      </p>
      <p className="suave" style={{ margin: "6px 0 0" }}>
        La cita de la frase la pone el servidor desde la referencia: si la cambias aqui, se vuelve a poner la
        exacta. Las citas del cierre se comprueban al montar.
      </p>
    </div>
  );
}

/** La vista "Referencias": de Genesis a Apocalipsis, para completar y corregir. */
export function ReferenciasBiblia({
  catalogo,
  alUsar,
}: {
  catalogo: Catalogo;
  alUsar: (g: GuionSadButTrue, aviso: string) => void;
}) {
  const [rango, setRango] = useState<Rango>("todo");
  const [libro, setLibro] = useState(0);
  const [estado, setEstado] = useState<"" | ReferenciaBiblica["estado"]>("");
  const [q, setQ] = useState("");
  const [datos, setDatos] = useState<ListaReferencias | null>(null);
  const [libros, setLibros] = useState<LibroBiblia[]>([]);
  const [motor, setMotor] = useState(motorInicial(catalogo));
  const [modelo, setModelo] = useState<string | null>(null);
  const [tono, setTono] = useState<"" | "aliento" | "historico">("");
  const [cuantas, setCuantas] = useState(6);
  const [libroProponer, setLibroProponer] = useState(1);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const cargar = useCallback(() => {
    const p = new URLSearchParams({ rango, estado, q });
    if (libro) p.set("libro", String(libro));
    api
      .get<ListaReferencias>(`/api/biblia/referencias?${p}`)
      .then(setDatos)
      .catch((err) => setError(mensajeDe(err)));
  }, [rango, libro, estado, q]);
  useEffect(cargar, [cargar]);
  useEffect(() => {
    api.get<LibroBiblia[]>("/api/biblia/libros").then(setLibros).catch(() => {});
  }, []);

  async function hacer(que: string, accion: () => Promise<string>) {
    setOcupado(que);
    setError("");
    setOk("");
    try {
      setOk(await accion());
      cargar();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  const completar = (ids?: string[]) =>
    hacer(ids ? `completar-${ids[0]}` : "completar", async () => {
      const r = await api.post<{ completadas: ReferenciaBiblica[]; motorUsado: string | null; aviso: string | null }>(
        "/api/biblia/referencias/completar",
        ids ? { ids, rehacer: true, motor, modelo, tono } : { cuantas, rango, motor, modelo, tono },
      );
      if (!r.completadas.length) return r.aviso ?? "No habia nada que completar.";
      const revisar = r.completadas.filter((x) => x.estado !== "lista");
      return (
        `Completadas con ${r.motorUsado}: ${r.completadas.map((x) => x.cita).join(", ")}.` +
        (revisar.length ? ` Para revisar: ${revisar.map((x) => `${x.cita} (${x.avisos.join(" ")})`).join("; ")}.` : "") +
        (r.aviso ? ` ${r.aviso}` : "")
      );
    });

  const proponer = () =>
    hacer("proponer", async () => {
      const r = await api.post<{
        guardadas: ReferenciaBiblica[];
        descartadas: { cita: string; motivo: string }[];
        motorUsado: string | null;
      }>("/api/biblia/proponer", { libro: libroProponer, cuantas: 8, motor, modelo });
      return (
        `${r.guardadas.length} nuevas en ${libros.find((l) => l.numero === libroProponer)?.nombre ?? "ese libro"}` +
        (r.guardadas.length ? `: ${r.guardadas.map((g) => g.cita).join(", ")}` : "") +
        "." +
        (r.descartadas.length
          ? ` Descartadas por no pasar la comprobacion: ${r.descartadas.map((d) => `${d.cita} (${d.motivo})`).join("; ")}.`
          : "")
      );
    });

  const c = datos?.cuentas;
  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>Referencias de la serie</h2>
        <p className="suave">
          Cada referencia es un pasaje con su dato curioso. La cita se comprueba contra la Reina-Valera 1909 (dominio
          publico) que lleva la app: si no existe, no se guarda. Para salir en un video le falta la palabra del
          sorteo, la frase (sin cita: la pone la app) y el cierre; eso lo completa la IA leyendo el versiculo literal,
          o tu a mano.
        </p>
        {c && (
          <p className="suave">
            {c.total} referencias · {c.listas} listas · {c.pendientes} por completar · {c.revisar} para revisar ·{" "}
            {c.publicadas} ya salieron.
          </p>
        )}
        <div className="campos">
          <SelectorMotor catalogo={catalogo} valor={motor} alCambiar={setMotor} modelo={modelo} alCambiarModelo={setModelo} />
          <div>
            <label htmlFor="tonoRef">Cierre</label>
            <select id="tonoRef" value={tono} onChange={(e) => setTono(e.target.value as typeof tono)}>
              <option value="">de aliento o historico, el que le vaya</option>
              <option value="aliento">de aliento</option>
              <option value="historico">historico</option>
            </select>
          </div>
          <div>
            <label htmlFor="cuantasRef">Cuantas completar de una vez</label>
            <input
              id="cuantasRef"
              type="number"
              min={1}
              max={10}
              value={cuantas}
              onChange={(e) => setCuantas(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
        </div>
        <div className="pie">
          <button className="primario" onClick={() => completar()} disabled={ocupado !== "" || !c?.pendientes}>
            {ocupado === "completar" ? "Completando..." : `Completar con IA las siguientes ${cuantas} pendientes`}
          </button>
        </div>

        <div className="campos" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="libroProponer">Buscar mas datos curiosos en</label>
            <select id="libroProponer" value={libroProponer} onChange={(e) => setLibroProponer(Number(e.target.value))}>
              {libros.map((l) => (
                <option key={l.numero} value={l.numero}>
                  {l.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="suave">
          La IA propone citas y unas palabras que tienen que estar en el versiculo; la app lo comprueba en el texto y
          solo guarda las que pasan. Las que no, se dicen y se descartan.
        </p>
        <div className="pie">
          <button onClick={proponer} disabled={ocupado !== ""}>
            {ocupado === "proponer" ? "Buscando..." : "Buscar con IA (y comprobar)"}
          </button>
        </div>
      </section>

      <NuevaReferencia alGuardar={(cita) => hacer("nueva", async () => `${cita} guardada.`)} />

      <section className="tarjeta">
        <h2>De Genesis a Apocalipsis</h2>
        <div className="campos">
          <div>
            <label htmlFor="rangoRef">Recorrido</label>
            <select id="rangoRef" value={rango} onChange={(e) => setRango(e.target.value as Rango)}>
              {RANGOS.map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="libroRef">Libro</label>
            <select id="libroRef" value={libro} onChange={(e) => setLibro(Number(e.target.value))}>
              <option value={0}>todos</option>
              {(datos?.libros ?? []).map((l) => (
                <option key={l.numero} value={l.numero}>
                  {l.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="estadoRef">Estado</label>
            <select id="estadoRef" value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}>
              <option value="">todas</option>
              <option value="lista">listas</option>
              <option value="pendiente">por completar</option>
              <option value="revisar">para revisar</option>
            </select>
          </div>
          <div>
            <label htmlFor="qRef">Buscar</label>
            <input id="qRef" value={q} placeholder="cita, tema o palabra" onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="lista" style={{ marginTop: 12 }}>
          {(datos?.referencias ?? []).map((r) => (
            <TarjetaReferencia
              key={r.id}
              r={r}
              ocupado={ocupado !== ""}
              completando={ocupado === `completar-${r.id}`}
              alCompletar={() => completar([r.id])}
              alCambiar={cargar}
              alError={setError}
              alUsar={async () => {
                try {
                  const g = await api.post<GuionSadButTrue>("/api/biblia/guion", { referenciaId: r.id });
                  alUsar(g, `${g.cita}: gana "${g.elegida}". Revisa y monta.`);
                } catch (err) {
                  setError(mensajeDe(err));
                }
              }}
            />
          ))}
          {datos && !datos.referencias.length && <p className="suave">Ninguna con ese filtro.</p>}
        </div>
      </section>
    </>
  );
}

function TarjetaReferencia({
  r,
  ocupado,
  completando,
  alCompletar,
  alCambiar,
  alError,
  alUsar,
}: {
  r: ReferenciaBiblica;
  ocupado: boolean;
  completando: boolean;
  alCompletar: () => void;
  alCambiar: () => void;
  alError: (e: string) => void;
  alUsar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [b, setB] = useState(r);
  useEffect(() => setB(r), [r]);
  const cambiado = (["tema", "dato", "palabra", "frase", "remate", "tono"] as const).some((k) => b[k] !== r[k]);

  async function guardar() {
    try {
      await api.put(`/api/biblia/referencias/${r.id}`, {
        tema: b.tema,
        dato: b.dato,
        palabra: b.palabra,
        frase: b.frase,
        remate: b.remate,
        tono: b.tono,
      });
      alCambiar();
    } catch (err) {
      alError(mensajeDe(err));
    }
  }

  async function borrar() {
    if (!window.confirm(`¿Quitar ${r.cita} de la serie?`)) return;
    try {
      await api.borrar(`/api/biblia/referencias/${r.id}`);
      alCambiar();
    } catch (err) {
      alError(mensajeDe(err));
    }
  }

  return (
    <div className="item">
      <div className="fila">
        <strong>{r.cita}</strong>
        <span className={`estado ${CLASE_ESTADO[r.estado]}`}>{NOMBRE_ESTADO[r.estado]}</span>
        {r.usos > 0 && <span className="suave">salio {r.usos}x</span>}
        {r.fuente === "IA" && <span className="suave">IA</span>}
        <span className="suave">{r.tema}</span>
        <span style={{ marginLeft: "auto" }} />
        <button onClick={() => setAbierto(!abierto)}>{abierto ? "Plegar" : "Abrir"}</button>
      </div>
      {!abierto && (
        <p className="suave" style={{ margin: "6px 0 0" }}>
          {r.frase || r.dato}
        </p>
      )}
      {r.avisos.length > 0 && (
        <div className="aviso error" style={{ marginTop: 6 }}>
          {r.avisos.join(" ")}
        </div>
      )}
      {abierto && (
        <>
          <p className="suave" style={{ margin: "8px 0" }}>
            <strong>Texto (Reina-Valera 1909):</strong> «{r.texto}»
          </p>
          <div className="campos">
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor={`dato-${r.id}`}>Lo curioso (guia para completarla)</label>
              <input id={`dato-${r.id}`} value={b.dato} onChange={(e) => setB({ ...b, dato: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`pal-${r.id}`}>Palabra del sorteo (la frase empieza asi)</label>
              <input id={`pal-${r.id}`} value={b.palabra} maxLength={40} onChange={(e) => setB({ ...b, palabra: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`tema-${r.id}`}>Tema</label>
              <input id={`tema-${r.id}`} value={b.tema} onChange={(e) => setB({ ...b, tema: e.target.value })} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor={`frase-${r.id}`}>Frase (sin cita: en pantalla va «… ({r.cita}).»)</label>
              <textarea id={`frase-${r.id}`} rows={2} value={b.frase} onChange={(e) => setB({ ...b, frase: e.target.value })} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor={`rem-${r.id}`}>Cierre (si cita, entre parentesis: «(Marcos 7:19)»)</label>
              <textarea id={`rem-${r.id}`} rows={2} value={b.remate} onChange={(e) => setB({ ...b, remate: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`tono-${r.id}`}>Tono del cierre</label>
              <select id={`tono-${r.id}`} value={b.tono} onChange={(e) => setB({ ...b, tono: e.target.value as typeof b.tono })}>
                <option value="aliento">de aliento</option>
                <option value="historico">historico</option>
              </select>
            </div>
          </div>
          {r.citasRemate.map((c) => (
            <p key={c.original} className={c.cita ? "suave" : "aviso error"} style={{ margin: "6px 0 0" }}>
              {c.cita ? `${c.cita}: «${c.texto}»` : `«${c.original}» no existe en la Reina-Valera 1909.`}
            </p>
          ))}
          <div className="pie">
            <button className="primario" onClick={guardar} disabled={!cambiado}>
              Guardar
            </button>
            <button onClick={alCompletar} disabled={ocupado}>
              {completando ? "Escribiendo..." : r.estado === "pendiente" ? "Completar con IA" : "Reescribir con IA"}
            </button>
            <button onClick={alUsar} disabled={r.estado !== "lista" || cambiado}>
              Usar en un video
            </button>
            <button onClick={borrar}>Quitar</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Añadir una referencia a mano: se ve el texto mientras se escribe la cita. */
function NuevaReferencia({ alGuardar }: { alGuardar: (cita: string) => void }) {
  const [cita, setCita] = useState("");
  const [encontrada, setEncontrada] = useState<{ cita: string; texto: string } | null>(null);
  const [noExiste, setNoExiste] = useState(false);
  const [dato, setDato] = useState("");
  const [tema, setTema] = useState("");
  const [error, setError] = useState("");

  // Busca la cita mientras se escribe, con un respiro para no preguntar a cada tecla.
  useEffect(() => {
    setEncontrada(null);
    setNoExiste(false);
    if (cita.trim().length < 4 || !/\d/.test(cita)) return;
    const t = window.setTimeout(() => {
      api
        .get<{ cita: string; texto: string }>(`/api/biblia/cita?q=${encodeURIComponent(cita.trim())}`)
        .then(setEncontrada)
        .catch(() => setNoExiste(true));
    }, 350);
    return () => window.clearTimeout(t);
  }, [cita]);

  async function guardar() {
    setError("");
    try {
      const r = await api.post<ReferenciaBiblica>("/api/biblia/referencias", { cita, dato, tema });
      setCita("");
      setDato("");
      setTema("");
      alGuardar(r.cita);
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  return (
    <section className="tarjeta">
      <h2>Añadir una a mano</h2>
      {error && <p className="aviso error">{error}</p>}
      <div className="campos">
        <div>
          <label htmlFor="citaNueva">Cita</label>
          <input id="citaNueva" value={cita} placeholder="Levítico 19:19 o Jue 11:30-34" onChange={(e) => setCita(e.target.value)} />
        </div>
        <div>
          <label htmlFor="temaNueva">Tema</label>
          <input id="temaNueva" value={tema} onChange={(e) => setTema(e.target.value)} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="datoNueva">Lo curioso, en una linea</label>
          <input id="datoNueva" value={dato} onChange={(e) => setDato(e.target.value)} />
        </div>
      </div>
      {encontrada && (
        <p className="suave">
          <strong>{encontrada.cita}:</strong> «{encontrada.texto.length > 500 ? `${encontrada.texto.slice(0, 500)}…` : encontrada.texto}»
        </p>
      )}
      {noExiste && <p className="aviso error">Esa cita no existe en la Reina-Valera 1909.</p>}
      <div className="pie">
        <button className="primario" onClick={guardar} disabled={!encontrada}>
          Guardar
        </button>
      </div>
    </section>
  );
}
