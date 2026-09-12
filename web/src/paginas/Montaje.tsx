import { useCallback, useEffect, useState } from "react";
import { api, type Catalogo, type Historia, type Preset, type Proyecto } from "../api";
import { mensajeDe } from "../App";
import { EditorMontaje } from "./EditorMontaje";

type Resumen = Pick<
  Proyecto,
  "id" | "nombre" | "tipo" | "formato" | "estado" | "archivo" | "descripcion" | "duracionSeg" | "error" | "editadoEn"
> & { _count?: { variantes: number } };

export function Montaje({ catalogo }: { catalogo: Catalogo }) {
  const [proyectos, setProyectos] = useState<Resumen[]>([]);
  const [historias, setHistorias] = useState<Historia[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [desde, setDesde] = useState("");
  /** Proyecto que se esta viendo de corrido en la lista. */
  const [viendo, setViendo] = useState<string | null>(null);
  const [formato, setFormato] = useState("tiktok");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const cargar = useCallback(async () => {
    try {
      const [p, h, pr] = await Promise.all([
        api.get<Resumen[]>("/api/proyectos"),
        api.get<Historia[]>("/api/historias?limite=50"),
        api.get<Preset[]>("/api/presets"),
      ]);
      setProyectos(p);
      setHistorias(h.filter((x) => x.titulo));
      setPresets(pr);
    } catch (err) {
      setError(mensajeDe(err));
    }
  }, []);

  useEffect(() => {
    if (!abierto) cargar();
  }, [cargar, abierto]);

  if (abierto) {
    return <EditorMontaje id={abierto} catalogo={catalogo} alSalir={() => setAbierto(null)} />;
  }

  async function crear() {
    setError("");
    setOk("");
    try {
      const p = await api.post<Proyecto>("/api/proyectos", {
        historiaId: desde || null,
        formato,
      });
      setOk("Proyecto creado.");
      setAbierto(p.id);
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  async function copiar(texto: string, que: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setOk(`${que} copiada.`);
    } catch {
      setError("El navegador no dejo copiar; selecciona el texto a mano.");
    }
  }

  async function copiarCreditos(id: string) {
    try {
      const { descripcion } = await api.get<{ descripcion: string }>(`/api/proyectos/${id}/creditos`);
      await copiar(descripcion, "Descripcion con creditos");
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  async function borrar(id: string) {
    if (!confirm("Borrar este proyecto?")) return;
    try {
      await api.borrar(`/api/proyectos/${id}`);
      await cargar();
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>Nuevo montaje</h2>
        <p className="suave">
          Partiendo de una historia, la linea de tiempo se monta sola con sus escenas y sus clips
          en orden; desde ahi cambias lo que quieras.
        </p>
        <div className="campos">
          <div>
            <label htmlFor="desde">Partir de</label>
            <select id="desde" value={desde} onChange={(e) => setDesde(e.target.value)}>
              <option value="">Proyecto vacio</option>
              {historias.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.titulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fmt">Formato</label>
            <select id="fmt" value={formato} onChange={(e) => setFormato(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="pie">
          <button className="primario" onClick={crear}>
            Crear y abrir editor
          </button>
        </div>
      </section>

      <section className="tarjeta">
        <h2>Proyectos</h2>
        {proyectos.length === 0 && <p className="suave">Todavia no hay ninguno.</p>}
        <div className="lista">
          {proyectos.map((p) => (
            <div className="item" key={p.id}>
              <div className="fila">
                <span className={`estado ${p.estado === "LISTO" ? "LISTA" : p.estado}`}>
                  {p.estado}
                </span>
                <strong>{p.nombre}</strong>
                <span className="suave">
                  {p.tipo === "MUSICA" ? "videoclip · " : ""}
                  {p.formato}
                  {p.duracionSeg ? ` · ${p.duracionSeg.toFixed(1)}s` : ""}
                  {p._count?.variantes ? ` · ${p._count.variantes} cortes` : ""} ·{" "}
                  {new Date(p.editadoEn).toLocaleString()}
                </span>
              </div>
              {p.error && <pre>{p.error}</pre>}
              {p.descripcion && <pre>{p.descripcion}</pre>}
              {viendo === p.id && p.archivo && (
                <video className="reproductor" src={`/api/proyectos/${p.id}/ver`} controls autoPlay />
              )}
              <div className="pie">
                <button onClick={() => setAbierto(p.id)}>Abrir editor</button>
                {p.archivo && (
                  <button onClick={() => setViendo(viendo === p.id ? null : p.id)}>
                    {viendo === p.id ? "Cerrar" : "Ver de corrido"}
                  </button>
                )}
                {p.archivo && (
                  <a className="boton" href={`/api/proyectos/${p.id}/descargar`}>
                    Descargar MP4
                  </a>
                )}
                <a className="boton" href={`/api/proyectos/${p.id}/creditos.txt`}>
                  Descargar creditos (.txt)
                </a>
                <button onClick={() => copiarCreditos(p.id)}>Copiar descripcion</button>
                <button onClick={() => borrar(p.id)}>Borrar</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
