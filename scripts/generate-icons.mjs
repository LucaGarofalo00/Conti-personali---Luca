// Genera i PNG per le icone home-screen (iOS/Android) dal master public/icon.svg.
// Richiede sharp:  npm i -D sharp   (oppure: npm i --no-save sharp)
// Esegui:          node scripts/generate-icons.mjs
import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pub = path.join(__dirname, '..', 'public')
const master = path.join(pub, 'icon.svg')

const targets = {
  'apple-touch-icon.png': 180,
  'icon-192.png': 192,
  'icon-512.png': 512,
}

for (const [name, size] of Object.entries(targets)) {
  await sharp(master, { density: 512 })
    .resize(size, size, { fit: 'cover' })
    .png()
    .toFile(path.join(pub, name))
  console.log('generato', name, `${size}x${size}`)
}
