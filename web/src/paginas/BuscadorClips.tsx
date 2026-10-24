import { useState } from "react";
import { api, type Busqueda, type BusquedaIA, type Catalogo, type ClipCandidato } from "../api";
import { mensajeDe } from "../App";
import { Muestra } from "./comunes";

/** Todos los bancos si el catálogo no los trae (servidor antiguo). */
const BANCOS_BASE = [
  { id: "pexels", nombre: "Pexels", nota: "Vídeos y fotos libres.", listo: true },
  { id: "pixabay", nombre: "Pixabay", nota: "Vídeos y fotos libres.", listo: true },
  { id: "coverr", nombre: "Coverr", nota: "Vídeo de banco con pinta de cine; sin acreditar.", listo: true },
  { id: "nasa", nombre: "NASA", nota: "Espacio y misiones; dominio público.", listo: true },
  { id: "openverse", nombre: "Openverse", nota: "Fotos con licencia libre.", listo: true },
  { id: "wikimedia", nombre: "Wikimedia Commons", nota: "Archivo histórico y artístico.", listo: true },
  { id: "archive", nombre: "Internet Archive", nota: "Cine y noticiarios de dominio público.", listo: true },
];

/** Lo que la IA contó de su búsqueda, para enseñarlo junto a los resultados. */
type RastroIA = Pick<BusquedaIA, "busquedas" | "destacados"> & { motor?: string; aviso?: string };

/**
 * Busca clips y fotos y devuelve el elegido. A mano, por palabras en inglés;
 * con IA, describiendo lo que se quiere ver en cualquier idioma: la IA lo
 * convierte en búsquedas y ordena lo que vuelve.
 */
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
  const [conIA, setConIA] = useState(false);
  const [lista, setLista] = useState<ClipCandidato[]>([]);
  /** Cuantos trajo cada banco y cual fallo: sin esto, una busqueda vacia no dice nada. */
  const [estado, setEstado] = useState<Busqueda["bancos"]>([]);
  const [rastro, setRastro] = useState<RastroIA | null>(null);
  const [viendo, setViendo] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  /** Bancos marcados; vacío = todos los que haya. */
  const [bancos, setBancos] = useState<string[]>([]);
  const [conFotos, setConFotos] = useState(false);
  const disponibles = (catalogo?.bancos ?? BANCOS_BASE).filter((b) => b.listo);
  /** Con "al azar" elige la app, y marcar bibliotecas concretas sobra. */
  const alAzar = bancos.includes("aleatorio");
  const hayMotor = (catalogo?.motores ?? []).some((m) => m.disponible);

  async function buscar(texto = consulta, ia = conIA) {
    if (!texto.trim()) return;
    setCargando(true);
    setError("");
    try {
      const medios = conFotos ? ["video", "imagen"] : ["video"];
      if (ia) {
        const r = await api.post<BusquedaIA>("/api/clips/ia", { descripcion: texto, bancos, medios });
        setLista(r.clips);
        setEstado(r.bancos ?? []);
        setRastro({
          busquedas: r.busquedas,
          destacados: r.destacados,
          motor: r.informe?.motor,
          aviso: r.aviso ?? r.informe?.aviso,
        });
      } else {
        const parametros = new URLSearchParams({ keywords: texto });
        if (bancos.length) parametros.set("bancos", bancos.join(","));
        parametros.set("medios", medios.join(","));
        const r = await api.get<Busqueda>(`/api/clips?${parametros}`);
        setLista(r.clips);
        setEstado(r.bancos ?? []);
        setRastro(null);
      }
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setCargando(false);
    }
  }

  /** Una de las búsquedas que hizo la IA, repetida a mano para afinar. */
  function repetir(busqueda: string) {
    setConsulta(busqueda);
    setConIA(false);
    void buscar(busqueda, false);
  }

  // La biblioteca propia va aparte: "al azar" no la apaga y se puede dejar sola.
  const conPropia = bancos.includes("biblioteca");
  const alternar = (v: string) =>
    v === "aleatorio"
      ? setBancos(alAzar ? bancos.filter((b) => b !== "aleatorio") : conPropia ? ["aleatorio", "biblioteca"] : ["aleatorio"])
      : setBancos(bancos.includes(v) ? bancos.filter((b) => b !== v) : [...bancos, v]);

  const destacados = rastro?.destacados ?? 0;
  const grupos: { titulo: string | null; clips: ClipCandidato[] }[] =
    destacados > 0 && destacados < lista.length
      ? [
          { titulo: "Lo que mejor encaja, según la IA", clips: lista.slice(0, destacados) },
          { titulo: "El resto de lo que trajeron los bancos", clips: lista.slice(destacados) },
        ]
      : [{ titulo: null, clips: lista }];

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      <div className="fila">
        <input
          value={consulta}
          placeholder={conIA ? "describe lo que quieres ver: una abuela amasando pan al amanecer" : "rain window, city night"}
          onChange={(e) => setConsulta(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && buscar()}
        />
        <button onClick={() => buscar()} disabled={cargando}>
          {cargando ? "Buscando..." : conIA ? "Buscar con IA" : "Buscar"}
        </button>
        <button onClick={() => alElegir(null)}>Quitar clip</button>
      </div>
      <div className="fila" style={{ flexWrap: "wrap", gap: 10, marginTop: 6 }}>
        <label
          className="casilla suave"
          title="Describe lo que quieres ver, en el idioma que sea: la IA lo convierte en búsquedas en inglés con ángulos distintos y ordena lo que vuelve por lo que cada banco dice de cada pieza."
        >
          <input type="checkbox" checked={conIA} onChange={(e) => setConIA(e.target.checked)} /> buscar con IA
          (describe lo que quieres ver)
        </label>
        {conIA && !hayMotor && catalogo && (
          <span className="suave">Sin clave de IA en Ajustes se busca por las palabras de la descripción.</span>
        )}
      </div>

      <div className="fila" style={{ flexWrap: "wrap", gap: 10, marginTop: 6 }}>
        <span className="suave">Buscar en:</span>
        {disponibles.map((b) => {
          const esAzar = b.id === "aleatorio";
          const esPropia = b.id === "biblioteca";
          // Sin nada marcado se busca en todos los de fuera, así que salen
          // marcados; la biblioteca no entra sola, solo si se pide.
          const marcado = esAzar
            ? alAzar
            : esPropia
              ? conPropia
              : !alAzar && (bancos.length === 0 || bancos.includes(b.id));
          return (
            <label
              key={b.id}
              className="casilla suave"
              title={b.nota}
              style={{ opacity: esAzar || esPropia || !alAzar ? 1 : 0.5, ...(esPropia ? { fontWeight: 600 } : {}) }}
            >
              <input
                type="checkbox"
                disabled={alAzar && !esAzar && !esPropia}
                checked={marcado}
                onChange={() => alternar(b.id)}
              />{" "}
              {b.nombre}
            </label>
          );
        })}
        {disponibles.some((b) => b.id === "biblioteca") && !(conPropia && bancos.length === 1) && (
          <button type="button" onClick={() => setBancos(["biblioteca"])}>
            Solo mi biblioteca
          </button>
        )}
        <label className="casilla suave" title="Las fotos se animan solas en el render">
          <input type="checkbox" checked={conFotos} onChange={(e) => setConFotos(e.target.checked)} /> incluir
          fotos
        </label>
      </div>

      {rastro && (
        <p className="suave">
          La IA buscó:{" "}
          {rastro.busquedas.map((b) => (
            <button key={b} type="button" onClick={() => repetir(b)} title="Repetir esta búsqueda a mano" style={{ marginRight: 6 }}>
              {b}
            </button>
          ))}
          {rastro.motor ? ` · con ${rastro.motor}` : ""}
          {rastro.destacados > 0 ? ` · destacó ${rastro.destacados}` : ""}
        </p>
      )}
      {rastro?.aviso && <p className="aviso">{rastro.aviso}</p>}

      {estado.length > 0 && (
        <p className={estado.some((b) => b.error) ? "aviso error" : "suave"}>
          {estado
            .map((b) => `${b.banco}: ${b.encontrados}${b.error ? ` — ${b.error}` : ""}`)
            .join(" · ")}
          {estado.some((b) => b.error) ? " · revisa la clave en Ajustes y prueba otra vez" : ""}
        </p>
      )}

      {grupos.map((g, gi) => (
        <div key={gi}>
          {g.titulo && <p className="suave" style={{ marginTop: 10 }}>{g.titulo}</p>}
          <div className="rejilla">
            {g.clips.map((c) => (
              <div className="miniatura" key={c.id} title={c.titulo}>
                {viendo === c.id && c.tipo !== "imagen" ? (
                  <video src={c.url} controls muted autoPlay playsInline />
                ) : (
                  <Muestra url={c.imagen ?? c.url} respaldo={c.tipo === "imagen" ? c.url : undefined} />
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
                  {/* La licencia a la vista: CC BY-SA obliga a compartir igual el
                      vídeo que salga, y eso conviene saberlo antes de usarla. */}
                  {c.licencia ? ` · ${c.licencia}` : ""}
                </span>
                {c.titulo && (
                  <span className="suave" style={{ display: "block", fontSize: "0.85em" }}>
                    {c.titulo.length > 70 ? `${c.titulo.slice(0, 70)}…` : c.titulo}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
