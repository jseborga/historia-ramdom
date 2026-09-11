import type { Catalogo, ModoPublicacion, Voz } from "../api";

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

export function SelectorVoz({
  catalogo,
  valor,
  alCambiar,
}: {
  catalogo: Catalogo;
  valor: Voz;
  alCambiar: (v: Voz) => void;
}) {
  const nombres = catalogo.voces[valor.proveedor] ?? [];
  return (
    <>
      <div>
        <label htmlFor="proveedorVoz">Proveedor de voz</label>
        <select
          id="proveedorVoz"
          value={valor.proveedor}
          onChange={(e) => {
            const proveedor = e.target.value as Voz["proveedor"];
            alCambiar(
              proveedor === "openai" ? catalogo.vozOpenAIPorDefecto : catalogo.vozPorDefecto,
            );
          }}
        >
          <option value="gemini">Gemini</option>
          <option value="openai">OpenAI</option>
        </select>
      </div>
      <div>
        <label htmlFor="modeloVoz">Modelo de voz</label>
        <input
          id="modeloVoz"
          value={valor.modelo}
          onChange={(e) => alCambiar({ ...valor, modelo: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="nombreVoz">Voz</label>
        <select
          id="nombreVoz"
          value={valor.nombre}
          onChange={(e) => alCambiar({ ...valor, nombre: e.target.value })}
        >
          {nombres.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </>
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
