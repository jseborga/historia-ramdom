import { useCallback, useEffect, useState } from "react";
import { api, ErrorAPI, type Catalogo } from "./api";
import { Login } from "./paginas/Login";
import { Editor } from "./paginas/Editor";
import { Series } from "./paginas/Series";
import { Historias } from "./paginas/Historias";
import { Ajustes } from "./paginas/Ajustes";
import { Banco } from "./paginas/Banco";

const PESTANAS = [
  { ruta: "/", nombre: "Editor" },
  { ruta: "/series", nombre: "Series" },
  { ruta: "/historias", nombre: "Historias" },
  { ruta: "/banco", nombre: "Banco" },
  { ruta: "/ajustes", nombre: "Ajustes" },
] as const;

export function App() {
  const [sesion, setSesion] = useState<string | null | undefined>(undefined);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [ruta, setRuta] = useState(window.location.pathname);

  const cargar = useCallback(async () => {
    try {
      const { email } = await api.get<{ email: string | null }>("/api/yo");
      setSesion(email);
      if (email) setCatalogo(await api.get<Catalogo>("/api/catalogo"));
    } catch {
      setSesion(null);
    }
  }, []);

  useEffect(() => {
    cargar();
    const alVolver = () => setRuta(window.location.pathname);
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
  }, [cargar]);

  function ir(destino: string) {
    window.history.pushState({}, "", destino);
    setRuta(destino);
  }

  async function salir() {
    await api.post("/api/logout").catch(() => {});
    setSesion(null);
    setCatalogo(null);
  }

  if (sesion === undefined) return <p className="contenedor suave">Cargando...</p>;
  if (!sesion) return <Login alEntrar={cargar} />;

  const pestana = PESTANAS.find((p) => p.ruta === ruta) ?? PESTANAS[0];

  return (
    <>
      <header className="barra">
        <h1>Estudio de voz en off</h1>
        <nav>
          {PESTANAS.map((p) => (
            <button
              key={p.ruta}
              className={p.ruta === pestana.ruta ? "activo" : ""}
              onClick={() => ir(p.ruta)}
            >
              {p.nombre}
            </button>
          ))}
        </nav>
        <button onClick={salir}>Salir</button>
      </header>

      <main className="contenedor">
        {!catalogo ? (
          <p className="suave">Cargando configuracion...</p>
        ) : pestana.ruta === "/series" ? (
          <Series catalogo={catalogo} />
        ) : pestana.ruta === "/historias" ? (
          <Historias />
        ) : pestana.ruta === "/banco" ? (
          <Banco catalogo={catalogo} />
        ) : pestana.ruta === "/ajustes" ? (
          <Ajustes catalogo={catalogo} alCambiar={cargar} />
        ) : (
          <Editor catalogo={catalogo} />
        )}
      </main>
    </>
  );
}

export function mensajeDe(err: unknown) {
  return err instanceof ErrorAPI || err instanceof Error ? err.message : "Error inesperado";
}
