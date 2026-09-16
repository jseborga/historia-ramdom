import { useEffect, useState } from "react";
import {
  api,
  urlMuestra,
  type Catalogo,
  type Genero,
  type Idioma,
  type ModoAudio,
  type ModoPublicacion,
  type Region,
  type Voz,
} from "../api";
import { mensajeDe } from "../App";

/**
 * Con qué motor se empieza: Groq si tiene clave —es el rápido y barato para
 * historias—, y si no, el primero que la tenga. Si no hay ninguno, se deja
 * Groq elegido y el selector lo dice.
 */
/** El nombre del idioma para el selector; el del servidor manda si lo trae. */
export function nombreIdioma(catalogo: Catalogo, idioma: string): string {
  return (
    catalogo.nombresIdioma?.[idioma] ??
    ({ es: "Español", en: "Inglés", spanglish: "Spanglish (español con inglés dentro)" }[idioma] ?? idioma)
  );
}

export function motorInicial(catalogo: Catalogo): string {
  const conClave = catalogo.motores.filter((m) => m.disponible);
  return conClave.find((m) => m.id === "groq")?.id ?? conClave[0]?.id ?? "groq";
}

export function SelectorMotor({
  catalogo,
  valor,
  alCambiar,
  modelo,
  alCambiarModelo,
}: {
  catalogo: Catalogo;
  valor: string;
  alCambiar: (v: string) => void;
  modelo: string | null;
  alCambiarModelo: (v: string | null) => void;
}) {
  const porDefecto = catalogo.motores.find((m) => m.id === valor)?.modelo ?? "";
  const conClave = catalogo.motores.filter((m) => m.disponible);
  const elegido = catalogo.motores.find((m) => m.id === valor);
  return (
    <>
      <div>
        <label htmlFor="motor">Motor del guion</label>
        <select id="motor" value={valor} onChange={(e) => alCambiar(e.target.value)}>
          {catalogo.motores.map((m) => (
            <option key={m.id} value={m.id} disabled={!m.disponible}>
              {m.id} ({m.modelo}){m.disponible ? "" : " - sin clave"}
            </option>
          ))}
        </select>
        {!conClave.length ? (
          <p className="aviso error">
            Ningun motor tiene clave. Ponla en Ajustes (Groq, Gemini, OpenAI o Claude) y elige aqui con cual
            trabajar.
          </p>
        ) : !elegido?.disponible ? (
          <p className="suave">
            {valor} no tiene clave: se escribira con {conClave[0].id}. Elige otro si prefieres.
          </p>
        ) : (
          <p className="suave">
            Con clave: {conClave.map((m) => m.id).join(", ")}. Si el elegido falla, se sigue con el siguiente.
          </p>
        )}
      </div>
      <div>
        <label htmlFor="modeloTexto">Modelo de la historia</label>
        <input
          id="modeloTexto"
          value={modelo ?? ""}
          placeholder={porDefecto}
          onChange={(e) => alCambiarModelo(e.target.value.trim() || null)}
        />
      </div>
    </>
  );
}

/** País o región del texto y si se piden modismos; Bolivia por defecto. */
export function SelectorRegion({
  catalogo,
  region,
  modismos,
  alCambiar,
}: {
  catalogo: Catalogo;
  region: Region;
  modismos: boolean;
  alCambiar: (region: Region, modismos: boolean) => void;
}) {
  return (
    <>
      <div>
        <label htmlFor="region">País o región del texto</label>
        <select id="region" value={region} onChange={(e) => alCambiar(e.target.value as Region, modismos)}>
          {(catalogo.regiones ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.nombre}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="modismos">Modismos</label>
        <select id="modismos" value={modismos ? "si" : "no"} onChange={(e) => alCambiar(region, e.target.value === "si")}>
          <option value="si">Usar modismos de la región</option>
          <option value="no">Neutro, sin modismos</option>
        </select>
      </div>
    </>
  );
}

/** Lo que de verdad tiene la clave de Gemini, preguntado a su API. */
type ModelosVoz = { gemini: string[]; elegido: string | null; configurado: string; error?: string };

export function SelectorVoz({
  catalogo,
  valor,
  alCambiar,
  idioma,
}: {
  catalogo: Catalogo;
  valor: Voz;
  alCambiar: (v: Voz) => void;
  /** Idioma del texto: deja solo las voces locales que lo hablan. */
  idioma?: Idioma;
}) {
  const [genero, setGenero] = useState<Genero | "todas">("todas");
  const [modelos, setModelos] = useState<ModelosVoz | null>(null);

  // El spanglish lo lee una voz en español: es la que pronuncia bien la base,
  // y las palabras en inglés le salen con acento, que es como suenan igual.
  const idiomaVoz = idioma === "en" ? "en" : idioma ? "es" : undefined;

  // Cambiar el idioma sin cambiar la voz deja una voz espanola leyendo ingles.
  // Aqui, en cuanto cambia, la voz local salta a la mejor de ese idioma.
  useEffect(() => {
    if (!idiomaVoz || valor.proveedor !== "local") return;
    const actual = (catalogo.vocesLocales ?? []).find((v) => v.id === valor.nombre);
    if (actual && actual.idioma === idiomaVoz) return;
    const mejor = (catalogo.vocesLocales ?? [])
      .filter((v) => v.idioma === idiomaVoz)
      .sort((a, b) => b.calidad - a.calidad)[0];
    if (mejor && mejor.id !== valor.nombre) alCambiar({ ...valor, nombre: mejor.id });
  }, [idiomaVoz, valor.proveedor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Google renombra los modelos de voz cada pocos meses: en vez de escribir el
  // nombre a mano, se listan los que tiene la clave. Solo se pregunta cuando
  // se elige Gemini, para no gastar llamadas de mas.
  useEffect(() => {
    if (valor.proveedor !== "gemini" || modelos) return;
    let vivo = true;
    api
      .get<ModelosVoz>("/api/voz/modelos")
      .then((r) => {
        if (!vivo) return;
        setModelos(r);
        // Si el modelo guardado ya no existe, se cambia al que la API sí tiene.
        if (r.gemini.length && !r.gemini.includes(valor.modelo) && r.elegido) {
          alCambiar({ ...valor, modelo: r.elegido });
        }
      })
      .catch(() => vivo && setModelos({ gemini: [], elegido: null, configurado: valor.modelo, error: "No se pudo consultar" }));
    return () => {
      vivo = false;
    };
  }, [valor.proveedor]); // eslint-disable-line react-hooks/exhaustive-deps

  const nombres = (catalogo.voces[valor.proveedor] ?? []).filter(
    (n) => genero === "todas" || (catalogo.generosIA?.[n] ?? "desconocido") === genero,
  );
  const locales = (catalogo.vocesLocales ?? []).filter(
    (v) => (!idiomaVoz || v.idioma === idiomaVoz) && (genero === "todas" || v.genero === genero),
  );
  return (
    <>
      <div>
        <label htmlFor="generoVoz">Voz masculina o femenina</label>
        <select
          id="generoVoz"
          value={genero}
          onChange={(e) => {
            const g = e.target.value as Genero | "todas";
            setGenero(g);
            // Si la voz actual no es de ese género, salta a la mejor que sí lo sea.
            if (valor.proveedor === "local") {
              const cand = (catalogo.vocesLocales ?? [])
                .filter((v) => (!idiomaVoz || v.idioma === idiomaVoz) && (g === "todas" || v.genero === g))
                .sort((a, b) => b.calidad - a.calidad)[0];
              if (cand && cand.id !== valor.nombre) alCambiar({ ...valor, nombre: cand.id });
            } else {
              const cand = (catalogo.voces[valor.proveedor] ?? []).find((n) => g === "todas" || catalogo.generosIA?.[n] === g);
              if (cand && cand !== valor.nombre) alCambiar({ ...valor, nombre: cand });
            }
          }}
        >
          <option value="todas">Cualquiera</option>
          <option value="masculino">Masculina</option>
          <option value="femenino">Femenina</option>
        </select>
      </div>
      <div>
        <label htmlFor="proveedorVoz">Proveedor de voz</label>
        <select
          id="proveedorVoz"
          value={valor.proveedor}
          onChange={(e) => {
            const proveedor = e.target.value as Voz["proveedor"];
            alCambiar(
              proveedor === "openai"
                ? catalogo.vozOpenAIPorDefecto
                : proveedor === "gemini"
                  ? catalogo.vozGeminiPorDefecto
                  : catalogo.vozPorDefecto,
            );
          }}
        >
          <option value="local">Voz del servidor (espeak-ng, sin coste)</option>
          <option value="gemini">Gemini</option>
          <option value="openai">OpenAI</option>
        </select>
      </div>
      {valor.proveedor === "gemini" && modelos && modelos.gemini.length > 0 ? (
        <div>
          <label htmlFor="modeloVoz">Modelo de voz (los que tiene tu clave)</label>
          <select
            id="modeloVoz"
            value={modelos.gemini.includes(valor.modelo) ? valor.modelo : (modelos.elegido ?? "")}
            onChange={(e) => alCambiar({ ...valor, modelo: e.target.value })}
          >
            {modelos.gemini.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      ) : (
        valor.proveedor !== "local" && (
          <div>
            <label htmlFor="modeloVoz">Modelo de voz</label>
            <input
              id="modeloVoz"
              value={valor.modelo}
              onChange={(e) => alCambiar({ ...valor, modelo: e.target.value })}
            />
            {valor.proveedor === "gemini" && modelos && (
              <p className="suave">
                {modelos.error
                  ? `No se pudo consultar los modelos de Gemini: ${modelos.error}`
                  : "Tu clave de Gemini no tiene ningun modelo de voz (tts) disponible."}
              </p>
            )}
          </div>
        )
      )}
      <div>
        <label htmlFor="nombreVoz">Voz</label>
        <select
          id="nombreVoz"
          value={valor.nombre}
          onChange={(e) => alCambiar({ ...valor, nombre: e.target.value })}
        >
          {valor.proveedor === "local"
            ? locales.map((v) => (
                <option key={v.id} value={v.id}>
                  {"★".repeat(v.calidad)} {v.nombre}
                  {idiomaVoz ? "" : ` · ${v.idioma}`}
                </option>
              ))
            : nombres.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
        </select>
      </div>
    </>
  );
}

/**
 * El video y el audio no tienen que ir a la par: con MUSICA o MUDO no se
 * genera narracion, y cada escena dura lo que cuesta leer su texto.
 */
export function SelectorAudio({
  valor,
  alCambiar,
}: {
  valor: ModoAudio;
  alCambiar: (v: ModoAudio) => void;
}) {
  return (
    <div>
      <label htmlFor="modoAudio">Audio</label>
      <select
        id="modoAudio"
        value={valor}
        onChange={(e) => alCambiar(e.target.value as ModoAudio)}
      >
        <option value="VOZ">Voz en off (la escena dura lo que su audio)</option>
        <option value="MUSICA">Sin voz: solo subtitulos y musica</option>
        <option value="MUDO">Sin sonido: solo subtitulos</option>
      </select>
    </div>
  );
}

export function CampoSegundos({
  valor,
  alCambiar,
}: {
  valor: number | null;
  alCambiar: (v: number | null) => void;
}) {
  return (
    <div>
      <label htmlFor="segundosEscena">Segundos por escena (vacio = por el texto)</label>
      <input
        id="segundosEscena"
        type="number"
        min={1}
        max={30}
        step="0.5"
        value={valor ?? ""}
        onChange={(e) => alCambiar(e.target.value ? Number(e.target.value) : null)}
      />
    </div>
  );
}

/**
 * Categoría y subcategoría de la historia, agrupadas por área: las historias
 * de ficción de siempre y el área de ideas (libros, filosofía, poder, dinero y
 * estafas). "Al azar" sortea una distinta cada vez —dentro del área si se
 * elige la del área— y vacío deja el tema libre.
 */
export function SelectorCategoria({
  catalogo,
  categoria,
  subcategoria,
  alCambiar,
}: {
  catalogo: Catalogo;
  categoria: string | null;
  subcategoria: string | null;
  alCambiar: (categoria: string | null, subcategoria: string | null) => void;
}) {
  const aleatoria = catalogo.categoriaAleatoria ?? "aleatoria";
  const categorias = catalogo.categorias ?? [];
  const areas = catalogo.areas ?? [];
  const elegida = categorias.find((c) => c.id === categoria) ?? null;
  const sub = elegida?.subcategorias.find((s) => s.id === subcategoria) ?? null;
  // Sin áreas en el catálogo (servidor antiguo) se listan todas seguidas.
  const grupos = areas.length
    ? areas.map((a) => ({ ...a, categorias: categorias.filter((c) => c.area === a.id) }))
    : [{ id: "", nombre: "", nota: "", aleatoria: "", categorias }];
  const areaElegida = areas.find((a) => a.id === elegida?.area || a.aleatoria === categoria) ?? null;

  return (
    <>
      <div>
        <label htmlFor="categoria">Categoría</label>
        <select
          id="categoria"
          value={categoria ?? ""}
          onChange={(e) => alCambiar(e.target.value || null, null)}
        >
          <option value="">Sin categoría (tema libre)</option>
          <option value={aleatoria}>Al azar, una distinta cada vez</option>
          {grupos.map((g) =>
            g.nombre ? (
              <optgroup key={g.id} label={g.nombre}>
                <option value={g.aleatoria}>Al azar dentro de {g.nombre.toLowerCase()}</option>
                {g.categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </optgroup>
            ) : (
              g.categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))
            ),
          )}
        </select>
        {areaElegida && <p className="suave">{areaElegida.nota}</p>}
      </div>
      {elegida && (
        <div>
          <label htmlFor="subcategoria">Subcategoría</label>
          <select
            id="subcategoria"
            value={subcategoria ?? ""}
            onChange={(e) => alCambiar(categoria, e.target.value || null)}
          >
            <option value="">Al azar dentro de {elegida.nombre}</option>
            {elegida.subcategorias.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
          <p className="suave">{sub ? sub.pista : elegida.tono}</p>
        </div>
      )}
    </>
  );
}

/**
 * Nombre legible de una categoría y su subcategoría, para listas y etiquetas.
 * Entiende también los valores al azar: "aleatoria" y "aleatoria:ideas".
 */
export function nombreCategoria(catalogo: Catalogo | null | undefined, categoria: string | null, subcategoria: string | null) {
  if (!categoria) return "";
  if (categoria === (catalogo?.categoriaAleatoria ?? "aleatoria")) return "categoría al azar";
  const area = catalogo?.areas?.find((a) => a.aleatoria === categoria);
  if (area) return `al azar dentro de ${area.nombre.toLowerCase()}`;
  const c = catalogo?.categorias?.find((x) => x.id === categoria);
  if (!c) return categoria;
  const s = c.subcategorias.find((x) => x.id === subcategoria);
  return s ? `${c.nombre} › ${s.nombre}` : c.nombre;
}

/** Pega un enlace de Suno y la canción entra en la biblioteca de música. */
export function ImportarSuno({
  alImportar,
  proyectoId,
}: {
  /** Recibe el nombre del archivo y, si es la biblioteca, la lista nueva. */
  alImportar: (archivo: string, musica?: string[]) => void;
  /** Con id, la canción se guarda en ese proyecto en vez de en la biblioteca. */
  proyectoId?: string;
}) {
  const [url, setUrl] = useState("");
  const [estado, setEstado] = useState("");
  const [error, setError] = useState("");

  async function importar() {
    setEstado("Descargando de Suno...");
    setError("");
    try {
      type Respuesta = { archivo: string; duracion: number | null; musica?: string[] };
      const r = proyectoId
        ? await api.post<Respuesta>(`/api/proyectos/${proyectoId}/musica-enlace`, { url })
        : await api.post<Respuesta>("/api/musica/enlace", { url });
      alImportar(r.archivo, r.musica);
      setEstado(`Lista: ${r.archivo}${r.duracion ? ` (${Math.round(r.duracion)} s)` : ""}.`);
      setUrl("");
    } catch (err) {
      setEstado("");
      setError(mensajeDe(err));
    }
  }

  return (
    <div>
      <label htmlFor="suno">Música desde Suno (pega el enlace de la canción)</label>
      <div className="fila">
        <input
          id="suno"
          placeholder="https://suno.com/song/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button onClick={importar} disabled={!/suno\.(com|ai)\//.test(url)}>
          Añadir
        </button>
      </div>
      {estado && <p className="suave">{estado}</p>}
      {error && <p className="aviso error">{error}</p>}
      <p className="suave">
        Usa canciones tuyas de Suno: el crédito «Música: Suno — enlace» se añade solo a la descripción.
      </p>
    </div>
  );
}

/** Sube una canción propia a la biblioteca compartida (o a un proyecto). */
export function SubirMusica({
  alSubir,
  proyectoId,
  etiqueta = "O sube la canción desde tu computadora",
}: {
  alSubir: (archivo: string, musica?: string[]) => void;
  /** Con id, el archivo va al proyecto y queda puesto como su música. */
  proyectoId?: string;
  etiqueta?: string;
}) {
  const [estado, setEstado] = useState("");
  const [error, setError] = useState("");

  async function subir(archivo: File) {
    setEstado(`Subiendo ${archivo.name}...`);
    setError("");
    try {
      type Respuesta = { archivo: string; duracion: number | null; musica?: string[] };
      const r = proyectoId
        ? await api.subir<Respuesta>(`/api/proyectos/${proyectoId}/musica-archivo`, archivo)
        : await api.subir<Respuesta>("/api/musica/subir", archivo);
      alSubir(r.archivo, r.musica);
      setEstado(`Lista: ${r.archivo}${r.duracion ? ` (${Math.round(r.duracion)} s)` : ""}.`);
    } catch (err) {
      setEstado("");
      setError(mensajeDe(err));
    }
  }

  return (
    <div>
      <label htmlFor={`subirMusica-${proyectoId ?? "biblioteca"}`}>{etiqueta}</label>
      <input
        id={`subirMusica-${proyectoId ?? "biblioteca"}`}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.flac"
        onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])}
      />
      {estado && <p className="suave">{estado}</p>}
      {error && <p className="aviso error">{error}</p>}
      <p className="suave">
        mp3, m4a, wav, ogg o aac, hasta 80 MB. Si Suno no deja descargar la canción, bájala desde
        Suno y súbela aquí.
      </p>
    </div>
  );
}

export function SelectorMusica({
  catalogo,
  valor,
  alCambiar,
  alAmpliar,
}: {
  catalogo: Catalogo;
  valor: string | null;
  alCambiar: (v: string | null) => void;
  /** Si se pasa, aparece el campo para añadir una canción de Suno. */
  alAmpliar?: (musica: string[]) => void;
}) {
  return (
    <>
      <div>
        <label htmlFor="musica">Musica de fondo</label>
        <select
          id="musica"
          value={valor ?? ""}
          onChange={(e) => alCambiar(e.target.value || null)}
        >
          <option value="">Sin musica</option>
          {catalogo.musica.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      {alAmpliar && (
        <>
          <ImportarSuno
            alImportar={(archivo, musica) => {
              if (musica) alAmpliar(musica);
              alCambiar(archivo);
            }}
          />
          <SubirMusica
            alSubir={(archivo, musica) => {
              if (musica) alAmpliar(musica);
              alCambiar(archivo);
            }}
          />
        </>
      )}
    </>
  );
}

export function CampoFecha({
  id,
  etiqueta,
  valor,
  alCambiar,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  alCambiar: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id}>{etiqueta}</label>
      <input
        id={id}
        type="datetime-local"
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
      />
    </div>
  );
}

export function SelectorModo({
  valor,
  alCambiar,
  tiktokListo,
}: {
  valor: ModoPublicacion;
  alCambiar: (v: ModoPublicacion) => void;
  tiktokListo: boolean;
}) {
  return (
    <div>
      <label htmlFor="modo">Al terminar</label>
      <select
        id="modo"
        value={valor}
        onChange={(e) => alCambiar(e.target.value as ModoPublicacion)}
      >
        <option value="DESCARGA">Dejar el MP4 listo para descargar</option>
        <option value="BORRADOR_TIKTOK" disabled={!tiktokListo}>
          Enviar a borradores de TikTok
        </option>
        <option value="DIRECTO_TIKTOK" disabled={!tiktokListo}>
          Publicar directo en TikTok (requiere auditoria)
        </option>
      </select>
    </div>
  );
}

/**
 * De dónde salen las imágenes: Pexels, Pixabay y la NASA (dominio público, sin
 * clave, la buena para ciencia y espacio), y si entran fotos además de vídeos.
 * Vacío = lo que use la categoría de la historia.
 */
export function SelectorBancos({
  catalogo,
  bancos,
  medios,
  alCambiar,
}: {
  catalogo: Catalogo;
  bancos: string[];
  medios: string[];
  alCambiar: (bancos: string[], medios: string[]) => void;
}) {
  const lista = catalogo.bancos ?? [];
  const tipos = catalogo.medios ?? [];
  if (!lista.length) return null;

  const alternar = (xs: string[], v: string) => (xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v]);

  return (
    <>
      <div>
        <label>Dónde buscar la imagen</label>
        <div className="fila" style={{ flexWrap: "wrap", gap: 10 }}>
          {lista.map((b) => (
            <label key={b.id} className="casilla suave" title={b.nota} style={{ opacity: b.listo ? 1 : 0.5 }}>
              <input
                type="checkbox"
                disabled={!b.listo}
                checked={bancos.includes(b.id)}
                onChange={() => alCambiar(alternar(bancos, b.id), medios)}
              />{" "}
              {b.nombre}
              {b.listo ? "" : " (sin clave)"}
            </label>
          ))}
        </div>
        <p className="suave">
          {bancos.length ? "" : "Vacío = lo que use la categoría; la ciencia busca también en la NASA."}
        </p>
      </div>
      <div>
        <label>Qué admitir</label>
        <div className="fila" style={{ flexWrap: "wrap", gap: 10 }}>
          {tipos.map((m) => (
            <label key={m.id} className="casilla suave">
              <input
                type="checkbox"
                checked={medios.includes(m.id)}
                onChange={() => alCambiar(bancos, alternar(medios, m.id))}
              />{" "}
              {m.nombre}
            </label>
          ))}
        </div>
        <p className="suave">
          {medios.includes("imagen")
            ? "Las fotos se animan solas (zoom y paneo), así que se ven como vídeo."
            : "Vacío = solo vídeo."}
        </p>
      </div>
    </>
  );
}

/** Nombre legible de un efecto de imagen, para los selectores. */
export const EFECTOS: [string, string][] = [
  ["ninguno", "Ninguno"],
  ["zoomLento", "Acercar (zoom lento)"],
  ["alejar", "Alejar"],
  ["paneoDerecha", "Paneo a la derecha"],
  ["paneoIzquierda", "Paneo a la izquierda"],
  ["kenBurns", "Ken Burns (zoom y paneo)"],
  ["fundido", "Fundido de entrada y salida"],
  ["blancoYNegro", "Blanco y negro"],
  ["vineta", "Viñeta"],
];

/**
 * Muestra de un clip. Si no carga, lo dice: una miniatura rota y muda deja al
 * usuario sin saber si el banco no trajo nada, si la imagen se cayo o si el
 * servidor la bloqueo.
 */
export function Muestra({
  url,
  respaldo,
  alt = "",
}: {
  url?: string | null;
  /** Si la miniatura del banco falla, se prueba con esta (el original). */
  respaldo?: string | null;
  alt?: string;
}) {
  const [intento, setIntento] = useState(0);
  const fuentes = [url, respaldo].filter((u): u is string => Boolean(u));
  const actual = fuentes[intento];
  if (!actual) {
    return (
      <div className="sinImagen">{fuentes.length ? "no se pudo cargar la muestra" : "sin muestra"}</div>
    );
  }
  return (
    <img
      key={actual}
      src={urlMuestra(actual)}
      alt={alt}
      loading="lazy"
      onError={() => setIntento(intento + 1)}
    />
  );
}
