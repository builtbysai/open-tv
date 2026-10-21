import { useEffect, useRef } from "react";
import { bandEdges, reduceBands, simulate, smooth } from "../playback/spectrum";
export type VisualizerMode = "bars" | "wave" | "rings";
export const visualizerModes: VisualizerMode[] = ["bars", "wave", "rings"];
const labels: Record<VisualizerMode, string> = {
  bars: "Bars",
  wave: "Wave",
  rings: "Rings",
};
export const visualizerLabel = (mode: VisualizerMode) => labels[mode];
interface Props {
  analyser: AnalyserNode | null;
  playing: boolean;
  hue: number;
  mode: VisualizerMode;
  // Television and reduced-motion viewers get a lighter, slower drawing loop.
  light: boolean;
}
// A canvas visualizer that reads the real spectrum when the stream can be analysed and
// falls back to a gentle simulated motion when it cannot.
export function AudioVisualizer({
  analyser,
  playing,
  hue,
  mode,
  light,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ analyser, playing, hue, mode, light });
  live.current = { analyser, playing, hue, mode, light };
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const bands = 48;
    const edges = bandEdges(256, bands);
    let levels: number[] = new Array(bands).fill(0);
    let wave: number[] = new Array(128).fill(0.5);
    let width = 0,
      height = 0,
      frame = 0,
      last = 0;
    const resize = () => {
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        live.current.light ? 1 : 2,
      );
      width = element.clientWidth;
      height = element.clientHeight;
      element.width = Math.max(1, Math.round(width * ratio));
      element.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const freq = new Uint8Array(256);
    const time = new Uint8Array(512);
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const { analyser, playing, hue, mode, light } = live.current;
      if (now - last < (light ? 66 : 16)) return;
      // Hidden while the player is docked: nothing to draw, nothing to spend.
      if (!element.clientWidth) return;
      last = now;
      const seconds = now / 1000;
      let target: number[];
      if (analyser && playing) {
        analyser.getByteFrequencyData(freq);
        target = reduceBands(freq, edges);
        analyser.getByteTimeDomainData(time);
        wave = Array.from({ length: 128 }, (_, i) => time[i * 4] / 255);
      } else {
        target = simulate(seconds, bands, playing);
        wave = wave.map((_, i) =>
          playing
            ? 0.5 +
              Math.sin(seconds * 3 + i * 0.22) * 0.18 * target[i % bands] +
              Math.sin(seconds * 5.3 + i * 0.07) * 0.08
            : 0.5,
        );
      }
      levels = smooth(levels, target);
      context.clearRect(0, 0, width, height);
      const gradient = context.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, `hsl(${hue} 85% 52%)`);
      gradient.addColorStop(1, `hsl(${(hue + 70) % 360} 90% 66%)`);
      context.fillStyle = gradient;
      context.strokeStyle = gradient;
      if (mode === "bars") {
        const gap = Math.max(2, width / bands / 4);
        const barWidth = (width - gap * (bands - 1)) / bands;
        for (let i = 0; i < bands; i++) {
          const h = Math.max(3, levels[i] * height * 0.92);
          const x = i * (barWidth + gap);
          context.beginPath();
          context.roundRect(
            x,
            height - h,
            barWidth,
            h,
            Math.min(6, barWidth / 2),
          );
          context.fill();
        }
      } else if (mode === "wave") {
        context.lineWidth = light ? 3 : 4;
        context.lineJoin = "round";
        if (!light) {
          context.shadowColor = `hsl(${hue} 90% 60%)`;
          context.shadowBlur = 18;
        }
        context.beginPath();
        wave.forEach((v, i) => {
          const x = (i / (wave.length - 1)) * width;
          const y = height / 2 + (v - 0.5) * height * 0.9;
          if (i) context.lineTo(x, y);
          else context.moveTo(x, y);
        });
        context.stroke();
        context.shadowBlur = 0;
      } else {
        const cx = width / 2,
          cy = height / 2,
          radius = Math.min(width, height) * 0.28,
          reach = Math.min(width, height) * 0.2;
        context.lineWidth = Math.max(2, (radius * 2 * Math.PI) / bands / 2.2);
        context.lineCap = "round";
        for (let i = 0; i < bands; i++) {
          const angle = (i / bands) * Math.PI * 2 - Math.PI / 2;
          const inner = radius,
            outer = radius + 4 + levels[i] * reach;
          context.beginPath();
          context.moveTo(
            cx + Math.cos(angle) * inner,
            cy + Math.sin(angle) * inner,
          );
          context.lineTo(
            cx + Math.cos(angle) * outer,
            cy + Math.sin(angle) * outer,
          );
          context.stroke();
        }
      }
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return (
    <canvas
      ref={canvas}
      className={`visualizer visualizer-${mode}`}
      aria-hidden="true"
    />
  );
}
