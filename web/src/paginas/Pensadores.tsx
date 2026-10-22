import { useCallback, useEffect, useState } from "react";
import {
  api,
  type BusquedaPensadores,
  type Catalogo,
  type CitaPensador,
  type GuionSadButTrue,
  type ListaCitas,
} from "../api";
import { mensajeDe } from "../App";
import { SelectorMotor, motorInicial } from "./comunes";

/**
 * «Grandes pensadores»: el mismo formato que la Biblia, con filosofos. Se
 * escribe la semilla —lo que urge decir—, sale un sorteo de nombres de
 * pensadores, se para en uno y van su cita con la obra y un cierre para hoy.
 * La cita, el autor y la obra salen siempre del banco; las que trae la IA
 * quedan "por comprobar" hasta que alguien mire la fuente.
 */

export const TITULO_PENSADORES = "Grandes pensadores";

type Cierre = "aplicacion" | "otra_cita";

/** El paso 1: la semilla y la busqueda. */
export function SemillaPensadores({
  catalogo,
  alGuion,
}: {
  catalogo: Catalogo;
  alGuion: (g: GuionSadButTrue, aviso: string) => void;
}) {
  const [titulo, setTitulo] = useState(TITULO_PENSADORES);
  const [semilla, setSemilla] = useState("");
  const [cierre, setCierre] = useState<Cierre>("aplicacion");
  const [soloComprobadas, setSoloComprobadas] = useState(true);
  const [motor, setMotor] = useState(motorInicial(catalogo));
  const [modelo, setModelo] = useState<string | null>(null);
  const [encontradas, setEncontradas] = useState<BusquedaPensadores["encontradas"]>([]);
  const [elegida, setElegida] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");

  async function buscar(modo: "banco" | "ia") {
    setOcupado(modo);
    setError("");
    try {
      const r = await api.post<BusquedaPensadores>("/api/pensadores/buscar", {
        semilla,
        modo,
        soloComprobadas,
        cierre,
        titulo,
        motor,
        modelo,
      });
      setEncontradas(r.encontradas);
      setElegida(r.guion.citaId ?? "");
      alGuion(
        r.guion,
        `${modo === "ia" ? `Buscado con ${r.motorUsado ?? motor}` : "Del banco, sin IA"}: el sorteo se para en ${r.guion.elegida}. ` +
          (r.guion.verificada ? "Cita comprobada." : "Cita por comprobar: mira la fuente antes de publicar.") +
          (modo === "ia" ? ` Lo encontrado (${r.encontradas.length} pensadores) quedo guardado en Citas.` : "") +
          (r.avisoMotor ? ` ${r.avisoMotor}` : ""),
      );
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  async function usar(c: BusquedaPensadores["encontradas"][number]) {
    setOcupado(c.id);
    setError("");
    try {
      const g = await api.post<GuionSadButTrue>("/api/pensadores/guion", {
        citaId: c.id,
        semilla,
        cierre,
        titulo,
        cercanos: encontradas.map((x) => x.autor),
        ...(cierre === "aplicacion" && c.remateSemilla ? { remate: c.remateSemilla } : {}),
      });
      setElegida(c.id);
      alGuion(g, `Ahora gana ${g.elegida}.${g.verificada ? "" : " Cita por comprobar."}`);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  return (
    <section className="tarjeta">
      <h2>1. La semilla</h2>
      <p className="suave">
        Lo que urge decir, en un tema o en una frase. Abre con el titulo, el sorteo pasa por nombres de pensadores y se
        para en uno; va su cita con la obra sobre el video y cierra con lo que esa cita te dice hoy.
      </p>
      {error && <p className="aviso error">{error}</p>}
      <div className="campos">
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="semillaPens">Tema o frase semilla</label>
          <input
            id="semillaPens"
            value={semilla}
            maxLength={200}
            placeholder="la prisa · el miedo a empezar · siempre lo dejo para el lunes"
            onChange={(e) => setSemilla(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ocupado === "") buscar("banco");
            }}
          />
        </div>
        <div>
          <label htmlFor="tituloPens">Titulo con el que abre</label>
          <input id="tituloPens" value={titulo} maxLength={80} onChange={(e) => setTitulo(e.target.value)} />
        </div>
        <div>
          <label htmlFor="cierrePens">Cierre</label>
          <select id="cierrePens" value={cierre} onChange={(e) => setCierre(e.target.value as Cierre)}>
            <option value="aplicacion">Lo que dice hoy (una frase para la semilla)</option>
            <option value="otra_cita">Otra cita del mismo pensador</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <label className="casilla">
            <input type="checkbox" checked={soloComprobadas} onChange={(e) => setSoloComprobadas(e.target.checked)} />
            Del banco, solo citas comprobadas
          </label>
        </div>
        <SelectorMotor catalogo={catalogo} valor={motor} alCambiar={setMotor} modelo={modelo} alCambiarModelo={setModelo} />
      </div>
      <div className="pie">
        <button className="primario" onClick={() => buscar("banco")} disabled={ocupado !== ""}>
          {ocupado === "banco" ? "Buscando..." : "Buscar en el banco (sin IA)"}
        </button>
        <button onClick={() => buscar("ia")} disabled={ocupado !== "" || semilla.trim().length < 3}>
          {ocupado === "ia" ? "Buscando pensadores..." : "Buscar con IA"}
        </button>
      </div>
      <p className="suave">
        Con IA: un pensador por epoca con su cita y su obra; todo queda en Citas «por comprobar». La proxima vez esa
        semilla sale del banco sin gastar IA.
      </p>

      {encontradas.length > 1 && (
        <div className="lista" style={{ marginTop: 8 }}>
          <strong>Los que salieron para esta semilla</strong>
          {encontradas.map((c) => (
            <div className="item fila" key={c.id}>
              <div style={{ flex: 1 }}>
                <strong>{c.autor}</strong> <span className="suave">· {c.obra}</span>{" "}
                <span className={`estado ${c.verificada ? "LISTA" : ""}`}>{c.verificada ? "comprobada" : "por comprobar"}</span>
                <div className="suave">«{c.texto}»</div>
              </div>
              <button onClick={() => usar(c)} disabled={ocupado !== "" || c.id === elegida}>
                {c.id === elegida ? "Elegido" : ocupado === c.id ? "..." : "Usar este"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Bajo el guion: de donde sale la cita, para comprobarla antes de montar. */
export function CitaDelGuion({ guion }: { guion: GuionSadButTrue }) {
  if (!guion.citaId) return null;
  return (
    <div className="item" style={{ marginTop: 12 }}>
      <div className="fila">
        <strong>Fuente: {guion.fuenteCompleta}</strong>
        <span className={`estado ${guion.verificada ? "LISTA" : "ERROR"}`}>
          {guion.verificada ? "comprobada" : "por comprobar"}
        </span>
      </div>
      {guion.contexto && <p className="suave" style={{ margin: "6px 0 0" }}>{guion.contexto}</p>}
      <p className="suave" style={{ margin: "6px 0 0" }}>
        La cita, el autor y la obra salen del banco al montar: para corregirlos, editalos en Citas. La fuente completa va
        en la descripcion.
      </p>
    </div>
  );
}

/** La vista "Citas": el banco de pensadores. */
export function CitasPensadores({ alUsar }: { alUsar: (g: GuionSadButTrue, aviso: string) => void }) {
  const [autor, setAutor] = useState("");
  const [q, setQ] = useState("");
  const [verificada, setVerificada] = useState<"" | "si" | "no">("");
  const [datos, setDatos] = useState<ListaCitas | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const cargar = useCallback(() => {
    const p = new URLSearchParams();
    if (autor) p.set("autor", autor);
    if (q.trim()) p.set("q", q.trim());
    if (verificada) p.set("verificada", verificada);
    api
      .get<ListaCitas>(`/api/pensadores/citas?${p}`)
      .then(setDatos)
      .catch((err) => setError(mensajeDe(err)));
  }, [autor, q, verificada]);
  useEffect(cargar, [cargar]);

  const c = datos?.cuentas;
  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}
      <NuevaCita
        alGuardar={(autor) => {
          setOk(`Cita de ${autor} guardada.`);
          cargar();
        }}
      />
      <section className="tarjeta">
        <h2>Citas de pensadores</h2>
        <p className="suave">
          Cada cita con su autor, su obra y el lugar exacto. Las de la base estan comprobadas; las que trae la IA quedan
          «por comprobar»: mira la fuente y marcala. {c && `${c.total} citas · ${c.comprobadas} comprobadas · ${c.porComprobar} por comprobar · ${c.usadas} ya salieron.`}
        </p>
        <div className="campos">
          <div>
            <label htmlFor="autorCitas">Pensador</label>
            <select id="autorCitas" value={autor} onChange={(e) => setAutor(e.target.value)}>
              <option value="">todos</option>
              {(datos?.autores ?? []).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="qCitas">Buscar por tema</label>
            <input id="qCitas" value={q} placeholder="miedo, tiempo, ira..." onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <label htmlFor="verCitas">Estado</label>
            <select id="verCitas" value={verificada} onChange={(e) => setVerificada(e.target.value as typeof verificada)}>
              <option value="">todas</option>
              <option value="si">comprobadas</option>
              <option value="no">por comprobar</option>
            </select>
          </div>
        </div>
        <div className="lista" style={{ marginTop: 12 }}>
          {(datos?.citas ?? []).map((x) => (
            <TarjetaCita key={x.id} c={x} alCambiar={cargar} alError={setError} alUsar={alUsar} />
          ))}
          {datos && !datos.citas.length && <p className="suave">Ninguna con ese filtro.</p>}
        </div>
      </section>
    </>
  );
}

function TarjetaCita({
  c,
  alCambiar,
  alError,
  alUsar,
}: {
  c: CitaPensador;
  alCambiar: () => void;
  alError: (e: string) => void;
  alUsar: (g: GuionSadButTrue, aviso: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [b, setB] = useState({ ...c, temasTexto: c.temas.join(", "), visualTexto: c.visual.join(", ") });
  useEffect(() => setB({ ...c, temasTexto: c.temas.join(", "), visualTexto: c.visual.join(", ") }), [c]);
  const lista = (t: string) => t.split(",").map((x) => x.trim()).filter(Boolean);
  const cambiado =
    (["autor", "obra", "ubicacion", "texto", "contexto", "remate", "verificada"] as const).some((k) => b[k] !== c[k]) ||
    b.temasTexto !== c.temas.join(", ") ||
    b.visualTexto !== c.visual.join(", ");

  async function guardar(extra: Partial<CitaPensador> = {}) {
    try {
      await api.put(`/api/pensadores/citas/${c.id}`, {
        autor: b.autor,
        obra: b.obra,
        ubicacion: b.ubicacion,
        texto: b.texto,
        contexto: b.contexto,
        remate: b.remate,
        verificada: b.verificada,
        temas: lista(b.temasTexto).slice(0, 10),
        visual: lista(b.visualTexto).slice(0, 6),
        ...extra,
      });
      alCambiar();
    } catch (err) {
      alError(mensajeDe(err));
    }
  }

  async function borrar() {
    if (!window.confirm(`¿Quitar esta cita de ${c.autor}?`)) return;
    try {
      await api.borrar(`/api/pensadores/citas/${c.id}`);
      alCambiar();
    } catch (err) {
      alError(mensajeDe(err));
    }
  }

  async function usar() {
    try {
      const g = await api.post<GuionSadButTrue>("/api/pensadores/guion", { citaId: c.id, semilla: c.temas[0] ?? "" });
      alUsar(g, `${g.elegida}: «${c.texto.slice(0, 60)}${c.texto.length > 60 ? "…" : ""}». Revisa y monta.`);
    } catch (err) {
      alError(mensajeDe(err));
    }
  }

  return (
    <div className="item">
      <div className="fila">
        <strong>{c.autor}</strong>
        <span className="suave">{[c.obra, c.ubicacion].filter(Boolean).join(", ")}</span>
        <span className={`estado ${c.verificada ? "LISTA" : ""}`}>{c.verificada ? "comprobada" : "por comprobar"}</span>
        {c.fuente === "IA" && <span className="suave">IA</span>}
        {c.usos > 0 && <span className="suave">salio {c.usos}x</span>}
        <span style={{ marginLeft: "auto" }} />
        <button onClick={() => setAbierto(!abierto)}>{abierto ? "Plegar" : "Abrir"}</button>
      </div>
      <p style={{ margin: "6px 0 0" }}>«{c.texto}»</p>
      {!abierto && c.temas.length > 0 && <p className="suave" style={{ margin: "4px 0 0" }}>{c.temas.join(" · ")}</p>}
      {abierto && (
        <>
          <div className="campos" style={{ marginTop: 8 }}>
            <div>
              <label htmlFor={`aut-${c.id}`}>Pensador</label>
              <input id={`aut-${c.id}`} value={b.autor} maxLength={40} onChange={(e) => setB({ ...b, autor: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`obra-${c.id}`}>Obra</label>
              <input id={`obra-${c.id}`} value={b.obra} onChange={(e) => setB({ ...b, obra: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`ubi-${c.id}`}>Lugar en la obra</label>
              <input id={`ubi-${c.id}`} value={b.ubicacion} placeholder="carta 13, 4" onChange={(e) => setB({ ...b, ubicacion: e.target.value })} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor={`txt-${c.id}`}>La cita</label>
              <textarea id={`txt-${c.id}`} rows={2} value={b.texto} onChange={(e) => setB({ ...b, texto: e.target.value })} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor={`rem-${c.id}`}>Cierre (lo que dice hoy; no se le atribuye al autor)</label>
              <input id={`rem-${c.id}`} value={b.remate} onChange={(e) => setB({ ...b, remate: e.target.value })} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor={`ctx-${c.id}`}>Contexto (quien era, de que va la obra)</label>
              <input id={`ctx-${c.id}`} value={b.contexto} onChange={(e) => setB({ ...b, contexto: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`tem-${c.id}`}>Temas (para buscar por la semilla)</label>
              <input id={`tem-${c.id}`} value={b.temasTexto} onChange={(e) => setB({ ...b, temasTexto: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`vis-${c.id}`}>Que buscar de video (en ingles)</label>
              <input id={`vis-${c.id}`} value={b.visualTexto} onChange={(e) => setB({ ...b, visualTexto: e.target.value })} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <label className="casilla">
                <input type="checkbox" checked={b.verificada} onChange={(e) => setB({ ...b, verificada: e.target.checked })} />
                Fuente comprobada
              </label>
            </div>
          </div>
          <div className="pie">
            <button className="primario" onClick={() => guardar()} disabled={!cambiado}>
              Guardar
            </button>
            <button onClick={usar} disabled={cambiado}>
              Usar en un video
            </button>
            <button onClick={borrar}>Quitar</button>
          </div>
        </>
      )}
    </div>
  );
}

function NuevaCita({ alGuardar }: { alGuardar: (autor: string) => void }) {
  const vacia = { autor: "", obra: "", ubicacion: "", texto: "", temas: "", remate: "" };
  const [b, setB] = useState(vacia);
  const [error, setError] = useState("");

  async function guardar() {
    setError("");
    try {
      await api.post("/api/pensadores/citas", {
        autor: b.autor,
        obra: b.obra,
        ubicacion: b.ubicacion,
        texto: b.texto,
        remate: b.remate,
        temas: b.temas.split(",").map((t) => t.trim()).filter(Boolean),
        verificada: true,
      });
      alGuardar(b.autor);
      setB(vacia);
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  return (
    <section className="tarjeta">
      <h2>Añadir una cita a mano</h2>
      <p className="suave">Con la obra y el lugar: es lo que permite comprobarla. Las que añades tu cuentan como comprobadas.</p>
      {error && <p className="aviso error">{error}</p>}
      <div className="campos">
        <div>
          <label htmlFor="autorNueva">Pensador</label>
          <input id="autorNueva" value={b.autor} maxLength={40} onChange={(e) => setB({ ...b, autor: e.target.value })} />
        </div>
        <div>
          <label htmlFor="obraNueva">Obra</label>
          <input id="obraNueva" value={b.obra} onChange={(e) => setB({ ...b, obra: e.target.value })} />
        </div>
        <div>
          <label htmlFor="ubiNueva">Lugar en la obra</label>
          <input id="ubiNueva" value={b.ubicacion} onChange={(e) => setB({ ...b, ubicacion: e.target.value })} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="textoNueva">La cita</label>
          <textarea id="textoNueva" rows={2} value={b.texto} onChange={(e) => setB({ ...b, texto: e.target.value })} />
        </div>
        <div>
          <label htmlFor="temasNueva">Temas (separados por comas)</label>
          <input id="temasNueva" value={b.temas} onChange={(e) => setB({ ...b, temas: e.target.value })} />
        </div>
        <div>
          <label htmlFor="remateNueva">Cierre</label>
          <input id="remateNueva" value={b.remate} onChange={(e) => setB({ ...b, remate: e.target.value })} />
        </div>
      </div>
      <div className="pie">
        <button className="primario" onClick={guardar} disabled={!b.autor.trim() || b.texto.trim().length < 3}>
          Guardar
        </button>
      </div>
    </section>
  );
}
