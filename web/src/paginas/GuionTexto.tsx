import { useState } from "react";
import { api, type Guion } from "../api";
import { mensajeDe } from "../App";

/**
 * El guion como texto plano: se copia, se lleva a otra IA o se reescribe a
 * mano, y se vuelve a aplicar. Es la valvula de escape para que el proceso no
 * sea del todo automatico.
 */
export function GuionTexto({
  guion,
  alAplicar,
}: {
  guion: Guion;
  alAplicar: (g: Guion) => void;
}) {
  const [texto, setTexto] = useState("");
  const [instrucciones, setInstrucciones] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  async function abrir() {
    if (abierto) {
      setAbierto(false);
      return;
    }
    setError("");
    setOk("");
    try {
      const r = await api.post<{ texto: string; instrucciones: string }>("/api/guion/texto", {
        guion,
      });
      setTexto(r.texto);
      setInstrucciones(r.instrucciones);
      setAbierto(true);
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  async function copiar(valor: string, que: string) {
    try {
      await navigator.clipboard.writeText(valor);
      setOk(`${que} copiado.`);
    } catch {
      setError("El navegador no dejo copiar; selecciona el texto a mano.");
    }
  }

  async function aplicar() {
    setError("");
    setOk("");
    try {
      const nuevo = await api.post<Guion>("/api/guion/desde-texto", { texto });
      alAplicar(nuevo);
      setOk("Guion aplicado. Revisa las escenas arriba.");
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  return (
    <section className="tarjeta">
      <div className="fila" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Guion como texto</h2>
        <button onClick={abrir}>{abierto ? "Cerrar" : "Abrir"}</button>
      </div>
      <p className="suave">
        Copialo, pasalo por otra IA o reescribelo a mano, y vuelve a pegarlo aqui.
      </p>

      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      {abierto && (
        <>
          <textarea
            style={{ minHeight: 260, fontFamily: "ui-monospace, monospace" }}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <div className="pie">
            <button onClick={() => copiar(texto, "Guion")}>Copiar guion</button>
            <button onClick={() => copiar(`${instrucciones}\n\n${texto}`, "Guion con instrucciones")}>
              Copiar con instrucciones para la IA
            </button>
            <button className="primario" onClick={aplicar}>
              Aplicar este texto
            </button>
          </div>
          <p className="suave" style={{ marginTop: 8 }}>{instrucciones}</p>
        </>
      )}
    </section>
  );
}
