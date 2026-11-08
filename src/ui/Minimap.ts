import type * as THREE from 'three'
import type { Track } from '../game/Track'

/** Stylized minimap: track ribbon cached offscreen, car dot blitted per frame. */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D
  private readonly base: HTMLCanvasElement
  private readonly scale: number
  private readonly offsetX: number
  private readonly offsetY: number

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly track: Pick<Track, 'samples' | 'tangents' | 'spawnPosition'>
  ) {
    this.ctx = canvas.getContext('2d')!

    // Fit track bounds into the canvas with padding
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const p of track.samples) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)
    }
    const pad = 18
    const sx = (canvas.width - pad * 2) / (maxX - minX)
    const sy = (canvas.height - pad * 2) / (maxZ - minZ)
    this.scale = Math.min(sx, sy)
    this.offsetX = pad + (canvas.width - pad * 2 - (maxX - minX) * this.scale) / 2 - minX * this.scale
    this.offsetY = pad + (canvas.height - pad * 2 - (maxZ - minZ) * this.scale) / 2 - minZ * this.scale

    // Pre-render the track ribbon
    this.base = document.createElement('canvas')
    this.base.width = canvas.width
    this.base.height = canvas.height
    const bctx = this.base.getContext('2d')!
    bctx.beginPath()
    track.samples.forEach((p, i) => {
      const [x, y] = this.toCanvas(p.x, p.z)
      if (i === 0) bctx.moveTo(x, y)
      else bctx.lineTo(x, y)
    })
    bctx.closePath()
    bctx.lineJoin = 'round'
    bctx.strokeStyle = 'rgba(255,255,255,0.85)'
    bctx.lineWidth = 11
    bctx.stroke()
    bctx.strokeStyle = '#1a0b30'
    bctx.lineWidth = 8
    bctx.stroke()

    // Start line tick
    const s = track.spawnPosition
    const t = track.tangents[0]!
    const [sxp, syp] = this.toCanvas(s.x, s.z)
    bctx.save()
    bctx.translate(sxp, syp)
    bctx.rotate(Math.atan2(t.z, t.x))
    bctx.fillStyle = '#ffffff'
    bctx.fillRect(-1.5, -7, 3, 14)
    bctx.restore()
  }

  private toCanvas(x: number, z: number): [number, number] {
    return [x * this.scale + this.offsetX, z * this.scale + this.offsetY]
  }

  update(carPos: THREE.Vector3, others: THREE.Vector3[] = []): void {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.drawImage(this.base, 0, 0)
    ctx.fillStyle = '#ffd24a'
    for (const o of others) {
      const [ox, oy] = this.toCanvas(o.x, o.z)
      ctx.beginPath()
      ctx.arc(ox, oy, 3.4, 0, Math.PI * 2)
      ctx.fill()
    }

    const [x, y] = this.toCanvas(carPos.x, carPos.z)
    ctx.beginPath()
    ctx.arc(x, y, 5, 0, Math.PI * 2)
    ctx.fillStyle = '#ff3333'
    ctx.shadowColor = '#ff5555'
    ctx.shadowBlur = 8
    ctx.fill()
    ctx.shadowBlur = 0
  }

  drawStatic(): void {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.drawImage(this.base, 0, 0)
  }
}
