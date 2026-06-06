// CDN 読み込みの Chart.js を最小限の型で宣言（any を避ける）
interface ChartConfig {
  type: string;
  data: unknown;
  options?: unknown;
}
interface ChartInstance {
  destroy(): void;
  resize(): void;
  update(): void;
}
interface ChartStatic {
  new (ctx: HTMLCanvasElement | CanvasRenderingContext2D, config: ChartConfig): ChartInstance;
}

interface Window {
  Chart: ChartStatic;
}
