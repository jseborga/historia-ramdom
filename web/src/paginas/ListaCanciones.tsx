import { useState } from "react";
import { api } from "../api";

/**
 * La lista de canciones de un videoclip. Suno entrega temas de dos o tres
 * minutos: encadenando varios sale un videoclip largo, y cada canción lleva su
 * propia letra para que la segunda no herede los tramos de la primera.
 */
export type EntradaCancion = {
  id: string;
  /** "archivo" es un fichero del disco que todavía no se ha subido. */
  tipo: "suno" | "biblioteca" | "archivo" | "proyecto";
  /** Enlace de Suno o nombre de la pista, según el tipo. */
  valor: string;
  archivo?: File | null;
  titulo: string;
  letra: string;
};

export const entradaVacia = (tipo: EntradaCancion["tipo"] = "suno"): EntradaCancion => ({
  id: crypto.randomUUID(),
  tipo,
  valor: "",
  archivo: null,
  titulo: "",
  letra: "",
});

export const entradaLista = (e: EntradaCancion) =>
  e.tipo === "archivo" ? Boolean(e.archivo) : e.valor.trim().length > 0;

/**
 * Sube los ficheros del disco al proyecto y devuelve la lista lista para la
 * API: las entradas de tipo "archivo" pasan a ser "proyecto" con su nombre.
 */
export async function prepararFuentes(proyectoId: string, entradas: EntradaCancion[]) {
  const fuentes = [];
  for (const e of entradas.filter(entradaLista)) {
    if (e.tipo === "archivo" && e.archivo) {
      const r = await api.subir<{ archivo: string }>(`/api/proyectos/${proyectoId}/subir`, e.archivo);
      fuentes.push({ tipo: "proyecto" as const, valor: r.archivo, titulo: e.titulo, letra: e.letra });
    } else {
      fuentes.push({ tipo: e.tipo as "suno" | "biblioteca" | "proyecto", valor: e.valor.trim(), titulo: e.titulo, letra: e.letra });
    }
  }
  return fuentes;
}

export function ListaCanciones({
  entradas,
  alCambiar,
  musicaDisponible,
  conLetra = true,
}: {
  entradas: EntradaCancion[];
  alCambiar: (e: EntradaCancion[]) => void;
  musicaDisponible: string[];
  /** Con una sola canción la letra se pide aparte, no por canción. */
  conLetra?: boolean;
}) {
  const [error, setError] = useState("");

  const cambiar = (id: string, c: Partial<EntradaCancion>) =>
    alCambiar(entradas.map((e) => (e.id === id ? { ...e, ...c } : e)));
  const quitar = (id: string) => alCambiar(entradas.filter((e) => e.id !== id));
  const mover = (i: number, salto: number) => {
    const j = i + salto;
    if (j < 0 || j >= entradas.length) return;
    const copia = [...entradas];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    alCambiar(copia);
  };

  return (
    <div>
      {error && <p className="aviso error">{error}</p>}
      <div className="lista">
        {entradas.map((e, i) => (
          <div className="item" key={e.id}>
            <div className="fila">
              <strong>{entradas.length > 1 ? `Canción ${i + 1}` : "La canción"}</strong>
              {entradas.length > 1 && (
                <>
                  <button onClick={() => mover(i, -1)} disabled={i === 0}>
                    Subir
                  </button>
                  <button onClick={() => mover(i, 1)} disabled={i === entradas.length - 1}>
                    Bajar
                  </button>
                  <button onClick={() => quitar(e.id)}>Quitar</button>
                </>
              )}
            </div>

            <div className="campos">
              <div>
                <label htmlFor={`tipo-${e.id}`}>De donde sale</label>
                <select
                  id={`tipo-${e.id}`}
                  value={e.tipo}
                  onChange={(ev) =>
                    cambiar(e.id, { tipo: ev.target.value as EntradaCancion["tipo"], valor: "", archivo: null })
                  }
                >
                  <option value="suno">Enlace de Suno</option>
                  <option value="archivo">Subir un archivo</option>
                  <option value="biblioteca">Pista de la biblioteca</option>
                  {e.tipo === "proyecto" && <option value="proyecto">Ya está en el proyecto</option>}
                </select>
              </div>
              <div>
                <label htmlFor={`titulo-${e.id}`}>Titulo (para los creditos)</label>
                <input
                  id={`titulo-${e.id}`}
                  value={e.titulo}
                  placeholder={`Cancion ${i + 1}`}
                  onChange={(ev) => cambiar(e.id, { titulo: ev.target.value })}
                />
              </div>
            </div>

            {e.tipo === "suno" && (
              <div style={{ marginTop: 8 }}>
                <label htmlFor={`valor-${e.id}`}>Enlace de la cancion</label>
                <input
                  id={`valor-${e.id}`}
                  placeholder="https://suno.com/song/..."
                  value={e.valor}
                  onChange={(ev) => cambiar(e.id, { valor: ev.target.value })}
                />
              </div>
            )}
            {e.tipo === "biblioteca" && (
              <div style={{ marginTop: 8 }}>
                <label htmlFor={`valor-${e.id}`}>Pista</label>
                <select id={`valor-${e.id}`} value={e.valor} onChange={(ev) => cambiar(e.id, { valor: ev.target.value })}>
                  <option value="">Elige una</option>
                  {musicaDisponible.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {e.tipo === "archivo" && (
              <div style={{ marginTop: 8 }}>
                <label htmlFor={`valor-${e.id}`}>Archivo (mp3, m4a, wav, ogg o aac)</label>
                <input
                  id={`valor-${e.id}`}
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.flac"
                  onChange={(ev) => {
                    const f = ev.target.files?.[0] ?? null;
                    setError("");
                    cambiar(e.id, { archivo: f, titulo: e.titulo || (f?.name ?? "").replace(/\.[a-z0-9]+$/i, "") });
                  }}
                />
                {e.archivo && (
                  <p className="suave">
                    {e.archivo.name} · {(e.archivo.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                )}
              </div>
            )}
            {e.tipo === "proyecto" && <p className="suave">Archivo del proyecto: {e.valor}</p>}

            {conLetra && (
              <div style={{ marginTop: 8 }}>
                <label htmlFor={`letra-${e.id}`}>
                  Letra de esta cancion (vacio = tramos por los lineamientos)
                </label>
                <textarea
                  id={`letra-${e.id}`}
                  value={e.letra}
                  placeholder={"[Verso 1]\n...\n\n[Coro]\n..."}
                  onChange={(ev) => cambiar(e.id, { letra: ev.target.value })}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="pie">
        <button onClick={() => alCambiar([...entradas, entradaVacia()])}>Añadir otra cancion</button>
        <span className="suave">
          {entradas.length > 1
            ? "Se encadenan en este orden, con un cruce suave entre una y otra."
            : "Con dos o mas canciones el videoclip sale mas largo."}
        </span>
      </div>
    </div>
  );
}
