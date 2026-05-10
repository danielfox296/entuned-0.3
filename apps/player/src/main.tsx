import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.js'
import './index.css'

// Patch the global Audio constructor so every <audio> Howler creates carries
// `crossOrigin="anonymous"` before its src is set. Without this, attempting
// to feed the audio into a Web Audio AnalyserNode (for the visualizer) taints
// the source and the analyser silently returns zeros. R2 must serve the
// matching CORS headers for this to actually unlock real frequency data —
// audio still plays without it; only the visualizer goes flat.
const NativeAudio = window.Audio
window.Audio = function PatchedAudio(...args: ConstructorParameters<typeof Audio>) {
  const el = new NativeAudio(...args)
  el.crossOrigin = 'anonymous'
  return el
} as unknown as typeof Audio
window.Audio.prototype = NativeAudio.prototype

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
