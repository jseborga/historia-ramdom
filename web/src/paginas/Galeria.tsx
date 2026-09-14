import { useCallback, useEffect, useState } from "react";
import { api, type Catalogo, type ClipCandidato, type Medio, type Preset, type Proyecto } from "../api";
import { mensajeDe } from "../App";
import { BuscadorClips } from "./BuscadorClips";
import { EditorMontaje } from "./EditorMontaje";

/**
 * La galería: vídeo y foto propios o guardados de los bancos, y la
 * composición con lo elegido.
 *
 * Componer no renderiza: deja el montaje montado en el editor, que es donde
 * están las herramientas de verdad (duración de cada plano, texto, voz,
 * música). Esta pantalla solo se ocupa del material.
 */

const mb = (bytes: number | null) => (bytes ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : "");
const seg = (s: number | null) => (s ? `${s.toFixed(1)}s` : "");

export function Galeria({ catalogo }: { catalogo: Catalogo }) {
  const [medios, setMedios] = useState<Medio[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  /** Ids en el orden en que se eligieron: ese es el orden del vídeo. */
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [clase, setClase] = useState<"" | "VIDEO" | "IMAGEN">("");
  const [busqueda, setBusqueda] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nombre, setNombre] = useState("Composicion");
  const [formato, setFormato] = useState("tiktok");
  const [segundosFoto, setSegundosFoto] = useState(3.5);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const cargar = useCallback(async () => {
    try {
      const parametros = new URLSearchParams();
      if (clase) parametros.set("clase", clase);
      if (busqueda.trim()) parametros.set("q", busqueda.trim());
      const [m, p] = await Promise.all([
        api.get<Medio[]>(`/api/medios?${parametros}`),
        api.get<Preset[]>("/api/presets"),
      ]);
      setMedios(m);
      setPresets(p);
    } catch (err) {
      setError(mensajeDe(err));
    }
  }, [clase, busqueda]);

  useEffect(() => {
    if (!abierto) cargar();
  }, [cargar, abierto]);

  if (abierto) {
    return <EditorMontaje id={abierto} catalogo={catalogo} alSalir={() => setAbierto(null)} />;
  }

  async function subir(archivos: FileList | null) {
    if (!archivos?.length) return;
    setOcupado("subir");
    setError("");
    setOk("");
    let subidos = 0;
    for (const archivo of Array.from(archivos)) {
      try {
        await api.subir<Medio>("/api/medios/subir", archivo);
        subidos++;
      } catch (err) {
        setError(`${archivo.name}: ${mensajeDe(err)}`);
      }
    }
    if (subidos) setOk(`${subidos} ${subidos === 1 ? "archivo subido" : "archivos subidos"}.`);
    setOcupado("");
    await cargar();
  }

  /** Guarda en la galería algo encontrado en un banco (por id, nunca por enlace). */
  async function guardarDeBanco(clip: ClipCandidato, keywords: string) {
    setOcupado(clip.id);
    setError("");
    try {
      await api.post<Medio>("/api/medios/guardar", { id: clip.id, keywords });
      setOk("Guardado en la galeria.");
      await cargar();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  async function borrar(m: Medio) {
    if (!confirm(`Borrar "${m.nombre}" de la galeria?`)) return;
    try {
      await api.borrar(`/api/medios/${m.id}`);
      setElegidos(elegidos.filter((id) => id !== m.id));
      await cargar();
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  const alternar = (id: string) =>
    setElegidos(elegidos.includes(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id]);

  async function componer() {
    setOcupado("componer");
    setError("");
    setOk("");
    try {
      const p = await api.post<Proyecto>("/api/medios/componer", {
        medios: elegidos,
        nombre: nombre.trim() || "Composicion",
        formato,
        segundosFoto,
      });
      setElegidos([]);
      setAbierto(p.id);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  const fotos = elegidos.filter((id) => medios.find((m) => m.id === id)?.clase === "IMAGEN").length;
  const duracion = elegidos.reduce((total, id) => {
    const m = medios.find((x) => x.id === id);
    if (!m) return total;
    return total + (m.clase === "IMAGEN" ? segundosFoto : Math.min(m.duracion ?? 12, 12));
  }, 0);

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>Galeria de video y foto</h2>
        <p className="suave">
          Lo que subes y lo que guardas de los bancos vive aqui. Eliges en que orden va y se compone un
          montaje: las fotos se animan solas y los videos entran con su duracion.
        </p>
        <div className="campos">
          <div>
            <label htmlFor="subirMedios">Subir video o foto (mp4, mov, m4v, webm, jpg, png, webp)</label>
            <input
              id="subirMedios"
              type="file"
              multiple
              accept="video/*,image/*"
              disabled={ocupado === "subir"}
              onChange={(e) => subir(e.target.files)}
            />
          </div>
          <div>
            <label htmlFor="claseMedio">Ver</label>
            <select id="claseMedio" value={clase} onChange={(e) => setClase(e.target.value as typeof clase)}>
              <option value="">Todo</option>
              <option value="VIDEO">Solo videos</option>
              <option value="IMAGEN">Solo fotos</option>
            </select>
          </div>
          <div>
            <label htmlFor="qMedio">Buscar en la galeria</label>
            <input
              id="qMedio"
              value={busqueda}
              placeholder="nombre o etiqueta"
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
        </div>
        <div className="pie">
          <button onClick={() => setBuscando(!buscando)}>
            {buscando ? "Cerrar la busqueda" : "Buscar en los bancos (Pexels, Pixabay, NASA)"}
          </button>
          <span className="suave">{ocupado === "subir" ? "Subiendo..." : `${medios.length} en la galeria`}</span>
        </div>
        {buscando && (
          <div style={{ marginTop: 12 }}>
            <BuscadorClips
              sugerencia={busqueda || "city night"}
              catalogo={catalogo}
              alElegir={() => setBuscando(false)}
              alGuardar={guardarDeBanco}
            />
          </div>
        )}
      </section>

      {elegidos.length > 0 && (
        <section className="tarjeta">
          <h2>Componer ({elegidos.length} elegidos)</h2>
          <div className="campos">
            <div>
              <label htmlFor="nombreComp">Nombre del proyecto</label>
              <input id="nombreComp" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </div>
            <div>
              <label htmlFor="formatoComp">Formato</label>
              <select id="formatoComp" value={formato} onChange={(e) => setFormato(e.target.value)}>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="segFoto">Segundos por foto</label>
              <input
                id="segFoto"
                type="number"
                min={0.5}
                max={30}
                step="0.5"
                value={segundosFoto}
                onChange={(e) => setSegundosFoto(Number(e.target.value) || 3.5)}
              />
            </div>
          </div>
          <div className="pie">
            <button className="primario" onClick={componer} disabled={ocupado !== ""}>
              {ocupado === "componer" ? "Componiendo..." : "Componer y abrir el editor"}
            </button>
            <button onClick={() => setElegidos([])}>Quitar la seleccion</button>
            <span className="suave">
              {fotos > 0 ? `${fotos} fotos animadas · ` : ""}
              aprox. {Math.round(duracion)} s
            </span>
          </div>
        </section>
      )}

      <section className="tarjeta">
        <div className="rejilla">
          {medios.length === 0 && <p className="suave">Todavia no hay nada. Sube algo o guardalo de los bancos.</p>}
          {medios.map((m) => {
            const orden = elegidos.indexOf(m.id);
            return (
              <div className={`miniatura${orden >= 0 ? " elegida" : ""}`} key={m.id}>
                <button
                  className={orden >= 0 ? "primario" : ""}
                  style={{ padding: 0, border: 0, background: "none", width: "100%" }}
                  onClick={() => alternar(m.id)}
                  title={orden >= 0 ? "Quitar de la seleccion" : "Añadir a la composicion"}
                >
                  <img src={`/api/medios/${m.id}/miniatura`} alt="" loading="lazy" />
                </button>
                <div className="fila">
                  <button onClick={() => alternar(m.id)}>
                    {orden >= 0 ? `Elegido ${orden + 1}` : "Elegir"}
                  </button>
                  <button onClick={() => borrar(m)}>Borrar</button>
                </div>
                <span className="suave">
                  {m.clase === "IMAGEN" ? "foto" : "video"} · {m.nombre.slice(0, 28)}
                  {m.duracion ? ` · ${seg(m.duracion)}` : ""}
                  {m.bytes ? ` · ${mb(m.bytes)}` : ""}
                  {m.fuente !== "subido" ? ` · ${m.fuente}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
