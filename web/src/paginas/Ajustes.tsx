import { useCallback, useEffect, useState } from "react";
import { api, type Catalogo, type CuentaTikTok } from "../api";
import { mensajeDe } from "../App";

export function Ajustes({
  catalogo,
  alCambiar,
}: {
  catalogo: Catalogo;
  alCambiar: () => void;
}) {
  const [cuentas, setCuentas] = useState<CuentaTikTok[]>([]);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(
    new URLSearchParams(window.location.search).get("tiktok") === "conectado"
      ? "Cuenta de TikTok conectada."
      : "",
  );

  const cargar = useCallback(async () => {
    try {
      setCuentas(await api.get<CuentaTikTok[]>("/api/tiktok/cuentas"));
    } catch (err) {
      setError(mensajeDe(err));
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function desconectar(id: string) {
    setError("");
    try {
      await api.borrar(`/api/tiktok/cuentas/${id}`);
      setOk("Cuenta desconectada.");
      await cargar();
      alCambiar();
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  const si = (v: boolean) => (v ? "si" : "no");

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>Servicios configurados</h2>
        <p className="suave">
          Las claves viven solo en el servidor; aqui solo se ve si estan puestas.
        </p>
        <ul className="suave">
          {catalogo.motores.map((m) => (
            <li key={m.id}>
              Guion con {m.id}: {si(m.disponible)}
            </li>
          ))}
          <li>Clips de Pexels: {si(catalogo.clips.pexels)}</li>
          <li>Clips de Pixabay: {si(catalogo.clips.pixabay)}</li>
          <li>Claves de TikTok: {si(catalogo.tiktok.configurado)}</li>
          <li>Permisos que se piden a TikTok: {catalogo.tiktok.permisos.join(", ")}</li>
          <li>Los MP4 se conservan {catalogo.retencionDias} dias</li>
        </ul>
      </section>

      <section className="tarjeta">
        <h2>TikTok</h2>
        <p className="suave">
          Lo mas simple es descargar el MP4 y programarlo en TikTok Studio desde el navegador.
          Conectar la cuenta aqui sirve para enviar el video a borradores por API y para leer
          sus metricas. Si cambias TIKTOK_SCOPES tienes que volver a conectar la cuenta: los
          permisos se fijan en el momento de autorizar.
        </p>

        {cuentas.length === 0 ? (
          <p className="suave">Ninguna cuenta conectada.</p>
        ) : (
          <div className="lista">
            {cuentas.map((c) => (
              <div className="item" key={c.id}>
                <div className="fila">
                  <strong>{c.nombre ?? c.openId}</strong>
                  <span className="suave">
                    {c.scopes} · token valido hasta {new Date(c.expiraEn).toLocaleString()}
                  </span>
                </div>
                <div className="pie">
                  <button onClick={() => desconectar(c.id)}>Desconectar</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pie">
          {catalogo.tiktok.configurado ? (
            <a className="boton" href="/api/tiktok/conectar">
              Conectar cuenta de TikTok
            </a>
          ) : (
            <span className="suave">
              Falta configurar TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET y TIKTOK_REDIRECT_URI.
            </span>
          )}
        </div>
      </section>

      <section className="tarjeta">
        <h2>Musica de fondo</h2>
        <p className="suave">
          Copia archivos con licencia libre en la carpeta <code>musica</code> del volumen de
          datos. La musica de la biblioteca de TikTok no se puede anadir desde fuera.
        </p>
        {catalogo.musica.length === 0 ? (
          <p className="suave">No hay pistas disponibles.</p>
        ) : (
          <ul className="suave">
            {catalogo.musica.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
