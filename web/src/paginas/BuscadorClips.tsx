import { useState } from "react";
import { api, urlMuestra, type Busqueda, type Catalogo, type ClipCandidato } from "../api";
import { mensajeDe } from "../App";

/** Todos los bancos si el catálogo no los trae (servidor antiguo). */
const BANCOS_BASE = [
  { id: "pexels", nombre: "Pexels", nota: "Vídeos y fotos libres.", listo: true },
  { id: "pixabay", nombre: "Pixabay", nota: "Vídeos y fotos libres.", listo: true },
  { id: "nasa", nombre: "NASA", nota: "Espacio y misiones; dominio público.", listo: true },
];

/** Busca clips y fotos por palabras libres y devuelve el elegido. */
export function BuscadorClips({
  sugerencia,
  catalogo,
  alElegir,
  alGuardar,
}: {
  sugerencia: string;
  catalogo?: Catalogo | null;
  alElegir: (clip: ClipCandidato | null) => void;
  /** Si se pasa, cada resultado ofrece guardarse en la galeria. */
  alGuardar?: (clip: ClipCandidato, keywords: string) => void;
}) {
  const [consulta, setConsulta] = useState(sugerencia);
  const [lista, setLista] = useState<ClipCandidato[]>([]);
  /** Cuantos trajo cada banco y cual fallo: sin esto, una busqueda vacia no dice nada. */
  const [estado, setEstado] = useState<Busqueda["bancos"]>([]);
  const [viendo, setViendo] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  /** Bancos marcados; vacío = todos los que haya. */
  const [bancos, setBancos] = useState<string[]>([]);
  const [conFotos, setConFotos] = useState(false);
  const disponibles = (catalogo?.bancos ?? BANCOS_BASE).filter((b) => b.listo);

  async function buscar() {
    if (!consulta.trim()) return;
    setCargando(true);
    setError("");
    try {
      const parametros = new URLSearchParams({ keywords: consulta });
      if (bancos.length) parametros.set("bancos", bancos.join(","));
      parametros.set("medios", conFotos ? "video,imagen" : "video");
      const r = await api.get<Busqueda>(`/api/clips?${parametros}`);
      setLista(r.clips);
      setEstado(r.bancos ?? []);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setCargando(false);
    }
  }

  const alternar = (v: string) =>
    setBancos(bancos.includes(v) ? bancos.filter((b) => b !== v) : [...bancos, v]);

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      <div className="fila">
        <input
          value={consulta}
          placeholder="rain window, city night"
          onChange={(e) => setConsulta(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && buscar()}
        />
        <button onClick={buscar} disabled={cargando}>
          {cargando ? "Buscando..." : "Buscar"}
        </button>
        <button onClick={() => alElegir(null)}>Quitar clip</button>
      </div>

      <div className="fila" style={{ flexWrap: "wrap", gap: 10, marginTop: 6 }}>
        <span className="suave">Buscar en:</span>
        {disponibles.map((b) => (
          <label key={b.id} className="casilla suave" title={b.nota}>
            <input
              type="checkbox"
              checked={bancos.length === 0 || bancos.includes(b.id)}
              onChange={() => alternar(b.id)}
            />{" "}
            {b.nombre}
          </label>
        ))}
        <label className="casilla suave" title="Las fotos se animan solas en el render">
          <input type="checkbox" checked={conFotos} onChange={(e) => setConFotos(e.target.checked)} /> incluir
          fotos
        </label>
      </div>

      {estado.length > 0 && (
        <p className={estado.some((b) => b.error) ? "aviso error" : "suave"}>
          {estado
            .map((b) => `${b.banco}: ${b.encontrados}${b.error ? ` — ${b.error}` : ""}`)
            .join(" · ")}
          {estado.some((b) => b.error) ? " · revisa la clave en Ajustes y prueba otra vez" : ""}
        </p>
      )}

      <div className="rejilla">
        {lista.map((c) => (
          <div className="miniatura" key={c.id}>
            {viendo === c.id && c.tipo !== "imagen" ? (
              <video src={c.url} controls muted autoPlay playsInline />
            ) : c.tipo === "imagen" ? (
              <img src={urlMuestra(c.imagen ?? c.url)} alt="" loading="lazy" />
            ) : c.imagen ? (
              <img src={urlMuestra(c.imagen)} alt="" loading="lazy" />
            ) : (
              <div className="sinImagen">sin muestra</div>
            )}
            <div className="fila">
              <button onClick={() => alElegir(c)}>Usar</button>
              {alGuardar && <button onClick={() => alGuardar(c, consulta)}>Guardar</button>}
              {c.tipo !== "imagen" && (
                <button onClick={() => setViendo(viendo === c.id ? null : c.id)}>
                  {viendo === c.id ? "Parar" : "Ver"}
                </button>
              )}
            </div>
            <span className="suave">
              {c.autor} · {c.fuente}
              {c.tipo === "imagen" ? " · foto (se anima)" : ""}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
