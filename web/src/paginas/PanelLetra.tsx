import { useState } from "react";
import { api, type Letra } from "../api";
import { mensajeDe } from "../App";

/**
 * La configuracion del videoclip, siempre a mano: la letra, los lineamientos
 * y los tramos que salieron de ellos. Se guarda en el proyecto, asi que se
 * puede escribir hoy, cerrar, y seguir mañana sin perder nada.
 */
export function PanelLetra({
  proyectoId,
  letra,
  alCambiar,
  alMontar,
}: {
  proyectoId: string;
  letra: Letra | null;
  /** Devuelve la configuracion guardada para refrescar el proyecto en pantalla. */
  alCambiar: (letra: Letra) => void;
  /** Se llama cuando el montaje queda encolado, para recargar el proyecto. */
  alMontar: () => void;
}) {
  const [texto, setTexto] = useState(letra?.texto ?? "");
  const [lineamientos, setLineamientos] = useState(letra?.lineamientos ?? "");
  const [instrumental, setInstrumental] = useState(letra?.instrumental ?? false);
  const [mostrarLetra, setMostrarLetra] = useState(letra?.mostrarLetra ?? true);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const cambios = { letra: texto, lineamientos, instrumental, mostrarLetra };
  const listo = instrumental ? lineamientos.trim().length > 10 : texto.trim().length > 20;

  async function guardar() {
    setOcupado("guardar");
    setError("");
    setOk("");
    try {
      alCambiar(await api.patch<Letra>(`/api/proyectos/${proyectoId}/letra`, cambios));
      setOk("Guardado. El montaje sigue como estaba hasta que lo vuelvas a montar.");
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  async function montar() {
    setOcupado("montar");
    setError("");
    setOk("");
    try {
      const r = await api.post<{ letra: Letra }>(`/api/proyectos/${proyectoId}/videoclip`, cambios);
      if (r.letra) alCambiar(r.letra);
      setOk("Montando: la cancion manda la duracion y los clips se buscan solos.");
      alMontar();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  return (
    <section className="tarjeta">
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <div className="campos">
        <div>
          <label htmlFor="tipoCancion">La cancion</label>
          <select
            id="tipoCancion"
            value={instrumental ? "instrumental" : "letra"}
            onChange={(e) => setInstrumental(e.target.value === "instrumental")}
          >
            <option value="letra">Tiene letra</option>
            <option value="instrumental">Es instrumental</option>
          </select>
        </div>
        {!instrumental && (
          <div>
            <label htmlFor="quemarLetra">Letra en pantalla</label>
            <select
              id="quemarLetra"
              value={mostrarLetra ? "si" : "no"}
              onChange={(e) => setMostrarLetra(e.target.value === "si")}
            >
              <option value="si">Mostrar la letra sobre el video</option>
              <option value="no">Solo imagen, sin letra</option>
            </select>
          </div>
        )}
      </div>

      {!instrumental && (
        <div style={{ marginTop: 12 }}>
          <label htmlFor="letraProyecto">Letra (con sus etiquetas [Verso], [Coro] si las trae)</label>
          <textarea
            id="letraProyecto"
            style={{ minHeight: 200 }}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <label htmlFor="lineaProyecto">
          {instrumental ? "Lineamientos: que quieres ver" : "Lineamientos de imagen (opcional)"}
        </label>
        <textarea
          id="lineaProyecto"
          value={lineamientos}
          onChange={(e) => setLineamientos(e.target.value)}
        />
      </div>

      <div className="pie">
        <button onClick={guardar} disabled={ocupado !== ""}>
          {ocupado === "guardar" ? "Guardando..." : "Guardar"}
        </button>
        <button className="primario" onClick={montar} disabled={ocupado !== "" || !listo}>
          {ocupado === "montar" ? "Montando..." : "Guardar y volver a montar"}
        </button>
        <span className="suave">
          {listo
            ? "Al montar se rehacen los tramos, los clips y los rotulos. Los cortes ya hechos no se tocan."
            : instrumental
              ? "Escribe los lineamientos para poder montar."
              : "Pega la letra para poder montar."}
        </span>
      </div>

      {letra?.secciones.length ? (
        <>
          <p className="suave" style={{ marginTop: 12 }}>
            Tramos detectados{letra.estiloVisual ? ` · ${letra.estiloVisual}` : ""}
          </p>
          <div className="lista">
            {letra.secciones.map((s, i) => (
              <div className="item" key={`${s.etiqueta}-${i}`}>
                <div className="fila">
                  <strong>{s.etiqueta}</strong>
                  {s.destacada && <span className="estado">el momento fuerte</span>}
                  <span className="suave">
                    peso {s.peso} · clips: {s.keywords.join(", ")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="suave" style={{ marginTop: 12 }}>
          Todavia no hay tramos: pulsa «Guardar y volver a montar» para repartir la cancion.
        </p>
      )}
    </section>
  );
}
