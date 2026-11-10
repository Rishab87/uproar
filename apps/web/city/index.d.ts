export type City = {
  start(): void;
  stop(): void;
  setProgress(p: number): void;
  jump(p: number): void;
  pointer(x: number, y: number): void;
  glitch(amount: number): void;
  setVisible(visible: boolean): void;
  renderOnce(): void;
  destroy(): void;
  readonly mode: string;
};

export function createCity(
  canvas: HTMLCanvasElement,
  options?: { tier?: 'high' | 'mid' | 'low'; reduced?: boolean; handles?: { handle: string; accent?: number }[]; onGiveUp?: (() => void) | null },
): Promise<City>;
