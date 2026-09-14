import { useState } from "react";
import { api } from "../api";
import { mensajeDe } from "../App";

export function Login({ alEntrar }: { alEntrar: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError("");
    try {
      await api.post("/api/login", { email, password });
      alEntrar();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="login" onSubmit={enviar}>
      <h2>Entrar al estudio</h2>
      {error && <p className="aviso error">{error}</p>}
      <div>
        <label htmlFor="email">Correo</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <label htmlFor="password">Contrasena</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <button className="primario" disabled={enviando}>
        {enviando ? "Entrando..." : "Entrar"}
      </button>
      {/* Publicas y sin sesion: es donde TikTok y Amazon miran antes de
          aprobar la aplicacion, y quien entra tiene derecho a leerlas. */}
      <p className="suave">
        <a href="/terminos">Terminos de servicio</a> · <a href="/privacidad">Politica de privacidad</a>
      </p>
    </form>
  );
}
