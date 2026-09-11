const tiempo = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${seg}`;
};

/** ASS interpreta \, { y } como comandos: se eliminan del texto narrado. */
const limpiar = (t: string) => t.replace(/[\\{}]/g, "").replace(/\s+/g, " ").trim();

export type EstiloSubtitulo = "Voz" | "Gancho";

export type Tramo = {
  inicio: number;
  fin: number;
  texto: string;
  /** El gancho se rotula mas grande y mas arriba que el resto. */
  estilo?: EstiloSubtitulo;
};

export function crearASS(tramos: Tramo[]) {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Voz,DejaVu Serif,66,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,4,2,2,90,90,460,1
Style: Gancho,DejaVu Serif,84,&H0000E5FF,&H0000E5FF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,1,5,2,2,80,80,700,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${tramos
  .map(
    (t) =>
      `Dialogue: 0,${tiempo(t.inicio)},${tiempo(t.fin)},${t.estilo ?? "Voz"},,0,0,0,,${limpiar(
        t.texto,
      )}`,
  )
  .join("\n")}
`;
}
