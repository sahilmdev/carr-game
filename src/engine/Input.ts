export interface InputState {
  readonly accelerate: boolean
  readonly brake: boolean
  readonly left: boolean
  readonly right: boolean
  /** Nitro boost (Shift / N / touch). Optional so scripted inputs can omit it. */
  readonly nitro?: boolean
}

/** Keyboard + touch input, polled once per frame by the game loop. */
export class InputManager {
  private keys: Record<string, boolean> = {}
  private touchAccelerate = false
  private touchBrake = false
  private touchLeft = false
  private touchRight = false
  private touchNitro = false

  constructor() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('keydown', this.preventScroll, { passive: false })
    window.addEventListener('blur', this.clearKeys)
  }

  private onKeyDown = (e: KeyboardEvent) => { this.keys[e.code] = true }
  private onKeyUp = (e: KeyboardEvent) => { this.keys[e.code] = false }
  private clearKeys = () => { this.keys = {} }

  private preventScroll = (e: KeyboardEvent) => {
    const gameCodes = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']
    if (gameCodes.includes(e.code)) e.preventDefault()
  }

  setTouchAccelerate(active: boolean) { this.touchAccelerate = active }
  setTouchBrake(active: boolean) { this.touchBrake = active }
  setTouchLeft(active: boolean) { this.touchLeft = active }
  setTouchRight(active: boolean) { this.touchRight = active }
  setTouchNitro(active: boolean) { this.touchNitro = active }

  /** True while a key is held (photo-mode camera controls). */
  isDown(code: string): boolean { return !!this.keys[code] }

  get(): InputState {
    return {
      accelerate: !!(this.keys['ArrowUp'] || this.keys['KeyW'] || this.touchAccelerate),
      brake: !!(this.keys['Space'] || this.keys['ArrowDown'] || this.keys['KeyS'] || this.touchBrake),
      left: !!(this.keys['ArrowLeft'] || this.keys['KeyA'] || this.touchLeft),
      right: !!(this.keys['ArrowRight'] || this.keys['KeyD'] || this.touchRight),
      nitro: !!(this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.keys['KeyN'] || this.touchNitro),
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('keydown', this.preventScroll)
    window.removeEventListener('blur', this.clearKeys)
  }
}
