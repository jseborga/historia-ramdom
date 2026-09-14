import { useEffect, useState } from "react";
import {
  api,
  type Catalogo,
  type EstadoAmazon,
  type GuionProducto,
  type Idioma,
  type Medio,
  type Preset,
  type Producto as Ficha,
  type Proyecto,
  type Region,
  type Voz,
} from "../api";
import { mensajeDe } from "../App";
import {
  Muestra,
  SelectorBancos,
  SelectorCategoria,
  SelectorMotor,
  SelectorRegion,
  SelectorVoz,
  motorInicial,
} from "./comunes";
import { EditorMontaje } from "./EditorMontaje";

/**
 * Productos de Amazon con reflexión detrás.
 *
 * La idea no es vender: es usar un objeto real como gancho y acabar en algo
 * que se piense después. El objeto abre el vídeo, dos o tres momentos lo
 * enseñan y el giro final habla de nosotros. El enlace y la divulgación de
 * Afiliados van en la descripción, siempre.
 *
 * Con la API de Afiliados se busca y salen fotos y fichas. Sin ella se pega
 * el enlace del producto —de ahí sale el ASIN y el enlace con la etiqueta— y
 * el vídeo se monta con material propio o de los bancos, porque las fotos de
 * la ficha pública de Amazon no se pueden usar.
 */

export function Producto({ catalogo }: { catalogo: Catalogo }) {
  const [estado, setEstado] = useState<EstadoAmazon | null>(null);
  const [consulta, setConsulta] = useState("");
  const [orden, setOrden] = useState("Featured");
  const [mercado, setMercado] = useState("");
  const [resultados, setResultados] = useState<Ficha[]>([]);
  const [enlace, setEnlace] = useState("");
  const [tituloManual, setTituloManual] = useState("");
  const [ficha, setFicha] = useState<Ficha | null>(null);

  const [angulo, setAngulo] = useState("");
  const [duracion, setDuracion] = useState(45);
  const [motor, setMotor] = useState(motorInicial(catalogo));
  const [modelo, setModelo] = useState<string | null>(null);
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [region, setRegion] = useState<Region>("bolivia");
  const [modismos, setModismos] = useState(true);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [subcategoria, setSubcategoria] = useState<string | null>(null);
  const [formato, setFormato] = useState("tiktok");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [voz, setVoz] = useState<Voz>(catalogo.vozPorDefecto);
  const [bancos, setBancos] = useState<string[]>([]);
  const [tiposMedio, setTiposMedio] = useState<string[]>([]);
  const [conFoto, setConFoto] = useState(true);
  const [segundosFoto, setSegundosFoto] = useState(3.5);

  const [galeria, setGaleria] = useState<Medio[]>([]);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [guion, setGuion] = useState<GuionProducto | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    api.get<EstadoAmazon>("/api/amazon").then((e) => {
      setEstado(e);
      setMercado(e.mercado);
    }).catch((err) => setError(mensajeDe(err)));
    api.get<Preset[]>("/api/presets").then(setPresets).catch(() => {});
    api.get<Medio[]>("/api/medios").then(setGaleria).catch(() => {});
  }, []);

  if (abierto) {
    return <EditorMontaje id={abierto} catalogo={catalogo} alSalir={() => setAbierto(null)} />;
  }

  async function buscar() {
    setOcupado("buscar");
    setError("");
    setOk("");
    try {
      const r = await api.post<{ productos: Ficha[] }>("/api/amazon/buscar", { consulta, mercado, orden });
      setResultados(r.productos);
      if (!r.productos.length) setOk("Amazon no devolvio nada para esa busqueda.");
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  async function resolverEnlace() {
    setOcupado("enlace");
    setError("");
    setOk("");
    try {
      const r = await api.post<{ producto: Ficha; api: boolean; aviso?: string }>("/api/amazon/producto", {
        enlace,
        titulo: tituloManual || undefined,
        mercado: mercado || undefined,
      });
      setFicha(r.producto);
      if (r.aviso) setError(r.aviso);
      setOk(
        r.api
          ? "Ficha traida de la API de Amazon."
          : "Sin API: se usa el enlace con tu etiqueta y el titulo que escribas. Las fotos las pones tu.",
      );
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  /** Baja las fotos del producto a la galeria para poder componerlas. */
  async function guardarFotos() {
    if (!ficha) return;
    setOcupado("fotos");
    setError("");
    try {
      const r = await api.post<{ medios: Medio[]; aviso?: string }>("/api/amazon/guardar", {
        producto: ficha,
        cuantas: 3,
      });
      setGaleria(await api.get<Medio[]>("/api/medios"));
      setElegidos([...elegidos, ...r.medios.map((m) => m.id)]);
      setOk(`${r.medios.length} fotos del producto en la galeria.${r.aviso ? ` ${r.aviso}` : ""}`);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  async function escribir() {
    if (!ficha) return;
    setOcupado("escribir");
    setError("");
    setOk("");
    try {
      const g = await api.post<GuionProducto>("/api/producto", {
        producto: { titulo: ficha.titulo, marca: ficha.marca, caracteristicas: ficha.caracteristicas },
        angulo,
        motor,
        modelo,
        duracion,
        idioma,
        region,
        modismos,
        categoria,
        subcategoria,
      });
      setGuion(g);
      setOk(
        `Guion escrito con ${g.motorUsado ?? motor}. Leelo: si suena a anuncio, cambia la reflexion.` +
          `${g.avisoMotor ? ` ${g.avisoMotor}` : ""}`,
      );
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  async function crear() {
    if (!guion || !ficha) return;
    setOcupado("crear");
    setError("");
    setOk("");
    try {
      const p = await api.post<Proyecto & { aviso?: string }>("/api/productos", {
        guion,
        producto: ficha,
        medios: elegidos,
        formato,
        voz,
        segundosFoto,
        bancos,
        tiposMedio,
        conFoto,
      });
      if (p.aviso) setError(p.aviso);
      setAbierto(p.id);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  const alternar = (id: string) =>
    setElegidos(elegidos.includes(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id]);

  const editarUso = (i: number, texto: string) =>
    guion && setGuion({ ...guion, usos: guion.usos.map((u, j) => (j === i ? texto : u)) });

  return (
    <>
      {error && <p className="aviso error">{error}</p>}
      {ok && <p className="aviso ok">{ok}</p>}

      <section className="tarjeta">
        <h2>1. Que producto</h2>
        <p className="suave">
          El objeto es el gancho, no el tema: el video acaba en una reflexion. El enlace de afiliado y la
          frase obligatoria van en la descripcion, siempre.
        </p>
        {estado && <p className={estado.api ? "aviso ok" : "aviso"}>{estado.nota}</p>}

        {estado?.api && (
          <>
            <div className="campos">
              <div>
                <label htmlFor="qProducto">Buscar en Amazon</label>
                <input
                  id="qProducto"
                  value={consulta}
                  placeholder="gadgets de cocina raros"
                  onChange={(e) => setConsulta(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="mercadoProducto">Tienda</label>
                <select id="mercadoProducto" value={mercado} onChange={(e) => setMercado(e.target.value)}>
                  {estado.mercados.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} ({m.dominio})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ordenProducto">Ordenar por</label>
                <select id="ordenProducto" value={orden} onChange={(e) => setOrden(e.target.value)}>
                  <option value="Featured">Lo que Amazon destaca</option>
                  <option value="AvgCustomerReviews">Mejor valorados</option>
                  <option value="NewestArrivals">Novedades</option>
                  <option value="Relevance">Mas relevante</option>
                </select>
              </div>
            </div>
            <div className="pie">
              <button onClick={buscar} disabled={ocupado !== "" || consulta.trim().length < 2}>
                {ocupado === "buscar" ? "Buscando..." : "Buscar productos"}
              </button>
            </div>

            {resultados.length > 0 && (
              <div className="rejilla" style={{ marginTop: 12 }}>
                {resultados.map((p) => (
                  <div className={`miniatura${ficha?.asin === p.asin ? " elegida" : ""}`} key={p.asin}>
                    <button
                      style={{ padding: 0, border: 0, background: "none", width: "100%" }}
                      onClick={() => setFicha(p)}
                      title="Usar este producto"
                    >
                      <Muestra url={p.imagen} alt={p.titulo} />
                    </button>
                    <span className="suave">
                      {p.titulo.slice(0, 60)}
                      {p.precio ? ` · ${p.precio}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="campos" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="enlaceProducto">O pega el enlace del producto</label>
            <input
              id="enlaceProducto"
              value={enlace}
              placeholder="https://www.amazon.com/dp/B0XXXXXXXX"
              onChange={(e) => setEnlace(e.target.value)}
            />
          </div>
          {(!estado?.api || !ficha?.imagen) && (
            <div>
              <label htmlFor="tituloProducto">Como se llama (sin API hay que escribirlo)</label>
              <input
                id="tituloProducto"
                value={tituloManual}
                placeholder="lampara de escritorio con reloj"
                onChange={(e) => setTituloManual(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="pie">
          <button onClick={resolverEnlace} disabled={ocupado !== "" || enlace.trim().length < 10}>
            {ocupado === "enlace" ? "Leyendo..." : "Usar este enlace"}
          </button>
        </div>
      </section>

      {ficha && (
        <section className="tarjeta">
          <h2>2. {ficha.titulo.slice(0, 80)}</h2>
          <div className="fila" style={{ alignItems: "flex-start", gap: 16 }}>
            {ficha.imagen && (
              <div style={{ width: 160 }}>
                <Muestra url={ficha.imagen} alt={ficha.titulo} />
              </div>
            )}
            <div style={{ flex: 1 }}>
              <p className="suave">
                {[ficha.marca, ficha.precio && `${ficha.precio} (precio del dia, no se narra)`, `ASIN ${ficha.asin}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {ficha.caracteristicas.length > 0 && (
                <ul className="suave">
                  {ficha.caracteristicas.slice(0, 5).map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
              <p className="suave">
                Enlace que se publicara: <code>{ficha.enlace}</code>
              </p>
              {estado && <p className="suave">{estado.divulgacion}</p>}
            </div>
          </div>
          {ficha.imagenes.length > 0 && (
            <div className="pie">
              <button onClick={guardarFotos} disabled={ocupado !== ""}>
                {ocupado === "fotos" ? "Guardando..." : "Guardar sus fotos en la galeria"}
              </button>
              <span className="suave">Asi se pueden combinar con tus propias tomas.</span>
            </div>
          )}
        </section>
      )}

      {ficha && (
        <section className="tarjeta">
          <h2>3. Como se cuenta</h2>
          <div className="campos">
            <div>
              <label htmlFor="anguloProducto">Por donde va la reflexion (vacio = lo decide la IA)</label>
              <input
                id="anguloProducto"
                value={angulo}
                placeholder="lo que compramos para no tener que cambiar de habitos"
                onChange={(e) => setAngulo(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="durProducto">Duracion (segundos)</label>
              <input
                id="durProducto"
                type="number"
                min={20}
                max={300}
                value={duracion}
                onChange={(e) => setDuracion(Number(e.target.value) || 45)}
              />
            </div>
            <div>
              <label htmlFor="fmtProducto">Formato</label>
              <select id="fmtProducto" value={formato} onChange={(e) => setFormato(e.target.value)}>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="idiomaProducto">Idioma</label>
              <select id="idiomaProducto" value={idioma} onChange={(e) => setIdioma(e.target.value as Idioma)}>
                {catalogo.idiomas.map((i) => (
                  <option key={i} value={i}>
                    {i === "es" ? "Espanol" : "Ingles"}
                  </option>
                ))}
              </select>
            </div>
            <SelectorRegion
              catalogo={catalogo}
              region={region}
              modismos={modismos}
              alCambiar={(r, m) => {
                setRegion(r);
                setModismos(m);
              }}
            />
            <SelectorCategoria
              catalogo={catalogo}
              categoria={categoria}
              subcategoria={subcategoria}
              alCambiar={(c, sc) => {
                setCategoria(c);
                setSubcategoria(sc);
              }}
            />
            <SelectorMotor
              catalogo={catalogo}
              valor={motor}
              alCambiar={setMotor}
              modelo={modelo}
              alCambiarModelo={setModelo}
            />
            <SelectorVoz catalogo={catalogo} valor={voz} alCambiar={setVoz} />
          </div>
          <div className="pie">
            <button className="primario" onClick={escribir} disabled={ocupado !== ""}>
              {ocupado === "escribir" ? "Escribiendo..." : guion ? "Escribir otro guion" : "Escribir el guion"}
            </button>
          </div>
        </section>
      )}

      {guion && ficha && (
        <section className="tarjeta">
          <h2>4. {guion.titulo}</h2>
          <div className="lista">
            <div className="item">
              <label htmlFor="ganchoProducto">Gancho (los tres primeros segundos)</label>
              <textarea
                id="ganchoProducto"
                value={guion.gancho}
                onChange={(e) => setGuion({ ...guion, gancho: e.target.value })}
              />
            </div>
            {guion.usos.map((u, i) => (
              <div className="item" key={i}>
                <div className="fila">
                  <label htmlFor={`uso-${i}`}>Momento {i + 1}</label>
                  <button onClick={() => setGuion({ ...guion, usos: guion.usos.filter((_, j) => j !== i) })}>
                    Quitar
                  </button>
                </div>
                <textarea id={`uso-${i}`} value={u} onChange={(e) => editarUso(i, e.target.value)} />
              </div>
            ))}
            <div className="item">
              <label htmlFor="advProducto">Que no hace (es lo que lo hace creible)</label>
              <textarea
                id="advProducto"
                value={guion.advertencia}
                onChange={(e) => setGuion({ ...guion, advertencia: e.target.value })}
              />
            </div>
            <div className="item">
              <label htmlFor="reflexionProducto">La reflexion</label>
              <textarea
                id="reflexionProducto"
                value={guion.reflexion}
                onChange={(e) => setGuion({ ...guion, reflexion: e.target.value })}
              />
            </div>
            <div className="item">
              <label htmlFor="cierreProducto">Cierre</label>
              <textarea
                id="cierreProducto"
                value={guion.cierre}
                onChange={(e) => setGuion({ ...guion, cierre: e.target.value })}
              />
            </div>
          </div>
          {guion.ganchos.length > 0 && (
            <p className="suave">Para la descripcion: {guion.ganchos.join(" · ")}</p>
          )}
        </section>
      )}

      {guion && ficha && (
        <section className="tarjeta">
          <h2>5. Con que imagenes</h2>
          <div className="campos">
            {ficha.imagen && (
              <div className="casilla">
                <input
                  id="conFotoProducto"
                  type="checkbox"
                  checked={conFoto}
                  onChange={(e) => setConFoto(e.target.checked)}
                />
                <label htmlFor="conFotoProducto">Abrir con la foto del producto</label>
              </div>
            )}
            <div>
              <label htmlFor="segFotoProducto">Segundos por foto</label>
              <input
                id="segFotoProducto"
                type="number"
                min={0.5}
                max={30}
                step="0.5"
                value={segundosFoto}
                onChange={(e) => setSegundosFoto(Number(e.target.value) || 3.5)}
              />
            </div>
            <SelectorBancos
              catalogo={catalogo}
              bancos={bancos}
              medios={tiposMedio}
              alCambiar={(b, m) => {
                setBancos(b);
                setTiposMedio(m);
              }}
            />
          </div>

          {galeria.length > 0 && (
            <>
              <p className="suave">
                Tus tomas del producto van delante, en el orden en que las elijas; el resto lo rellenan los
                bancos.
              </p>
              <div className="rejilla">
                {galeria.slice(0, 24).map((m) => {
                  const orden = elegidos.indexOf(m.id);
                  return (
                    <div className={`miniatura${orden >= 0 ? " elegida" : ""}`} key={m.id}>
                      <button
                        style={{ padding: 0, border: 0, background: "none", width: "100%" }}
                        onClick={() => alternar(m.id)}
                      >
                        <Muestra url={`/api/medios/${m.id}/miniatura`} alt={m.nombre} />
                      </button>
                      <span className="suave">
                        {orden >= 0 ? `Elegido ${orden + 1} · ` : ""}
                        {m.nombre.slice(0, 24)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="pie">
            <button className="primario" onClick={crear} disabled={ocupado !== "" || !guion.gancho.trim()}>
              {ocupado === "crear" ? "Montando (genera la voz)..." : "Crear el video"}
            </button>
            <span className="suave">
              La descripcion se guarda con el enlace y con "{estado?.divulgacion ?? "la divulgacion de Afiliados"}"
            </span>
          </div>
        </section>
      )}
    </>
  );
}
