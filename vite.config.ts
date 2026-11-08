import { defineConfig, type Plugin } from 'vite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Dev server only: POST a JPEG data URL to /__shot?name=x and it is saved to
 * the temp folder (nitro-shots). Used by the track checks in devtools.ts so
 * frames can be inspected without a visible window. Not part of the build.
 */
function shots(): Plugin {
  return {
    name: 'nitro-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'shot').replace(/[^\w-]/g, '')
        let body = ''
        req.on('data', (d) => { body += d })
        req.on('end', () => {
          const dir = join(tmpdir(), 'nitro-shots')
          mkdirSync(dir, { recursive: true })
          const file = join(dir, `${name}.jpg`)
          writeFileSync(file, Buffer.from(body.replace(/^data:image\/\w+;base64,/, ''), 'base64'))
          res.end(file)
        })
      })
    },
  }
}

export default defineConfig({
  base: './',
  server: { port: 5188 },
  plugins: [shots()],
})
