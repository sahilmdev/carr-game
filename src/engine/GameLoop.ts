export type UpdateFn = (dt: number, time: number) => void
export type RenderFn = (dt: number) => void

/** requestAnimationFrame loop with capped delta time (prevents spiral of death). */
export class GameLoop {
  private rafHandle = 0
  private lastTimestamp = 0
  private running = false

  private frameCount = 0
  private fpsAccumulator = 0
  public currentFPS = 60

  constructor(
    private readonly update: UpdateFn,
    private readonly render: RenderFn,
    private readonly maxDeltaTime = 0.05
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTimestamp = performance.now()
    this.rafHandle = requestAnimationFrame(this.tick)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.rafHandle)
  }

  private tick = (timestamp: number): void => {
    if (!this.running) return
    const rawDelta = (timestamp - this.lastTimestamp) / 1000
    const dt = Math.min(rawDelta, this.maxDeltaTime)
    this.lastTimestamp = timestamp

    this.fpsAccumulator += rawDelta
    this.frameCount++
    if (this.fpsAccumulator >= 1.0) {
      this.currentFPS = this.frameCount
      this.frameCount = 0
      this.fpsAccumulator = 0
    }

    this.update(dt, timestamp / 1000)
    this.render(dt)
    this.rafHandle = requestAnimationFrame(this.tick)
  }
}
