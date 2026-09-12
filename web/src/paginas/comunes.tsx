import { useState } from "react";
import type { Catalogo, Genero, ModoAudio, ModoPublicacion, Region, Voz } from "../api";

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

export function SelectorVoz({
  catalogo,
  valor,
  alCambiar,
}: {
  catalogo: Catalogo;
  valor: Voz;
  alCambiar: (v: Voz) => void;
}) {
  const [genero, setGenero] = useState<Genero | "todas">("todas");
  const nombres = (catalogo.voces[valor.proveedor] ?? []).filter(
    (n) => genero === "todas" || (catalogo.generosIA?.[n] ?? "desconocido") === genero,
  );
  const locales = (catalogo.vocesLocales ?? []).filter((v) => genero === "todas" || v.genero === genero);
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
              const cand = (catalogo.vocesLocales ?? []).filter((v) => g === "todas" || v.genero === g).sort((a, b) => b.calidad - a.calidad)[0];
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
      {valor.proveedor !== "local" && (
        <div>
          <label htmlFor="modeloVoz">Modelo de voz</label>
          <input
            id="modeloVoz"
            value={valor.modelo}
            onChange={(e) => alCambiar({ ...valor, modelo: e.target.value })}
          />
        </div>
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

export function SelectorMusica({
  catalogo,
  valor,
  alCambiar,
}: {
  catalogo: Catalogo;
  valor: string | null;
  alCambiar: (v: string | null) => void;
}) {
  return (
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
