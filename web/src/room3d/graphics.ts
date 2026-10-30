/**
 * graphics.ts — can this browser draw 3D, and does it use the graphics card to do it?
 *
 * PURPOSE
 *   The room needs WebGL. Browsers can offer it without a graphics card: Chrome draws 3D on the processor ("Microsoft
 *   Basic Render Driver", SwiftShader, llvmpipe) when graphics acceleration is turned off, the GPU driver is
 *   blocklisted or crashed, or on remote desktops and virtual machines. The room runs there too; it skips edge
 *   smoothing (RoomScene.jsx), which costs about a fifth of every frame on the processor and almost nothing on a card.
 *
 * HOW IT WORKS
 *   One probe per page load (each probe creates a GL context, and browsers cap how many exist): the renderer's name
 *   (WEBGL_debug_renderer_info) is matched against known software rasterizers, and a context requested with
 *   failIfMajorPerformanceCaveat, which browsers refuse when they would have to draw in software.
 *
 * USED BY: pages/RoomPage.tsx (no WebGL at all → Spaces link), room3d/RoomScene.jsx
 */

/** What the probe found. `software` = WebGL works but without the graphics card. */
export interface GraphicsProbe {
  webgl: boolean
  software: boolean
  renderer: string
}

/** Renderer names of WebGL drawn on the processor rather than the graphics card. */
const SOFTWARE_RENDERERS = /swiftshader|basic render driver|llvmpipe|softpipe|software rasterizer|software adapter|mesa offscreen/i

/**
 * PURPOSE: True when a WebGL renderer name belongs to a software rasterizer.
 * @param renderer  e.g. "ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 …)"
 */
export function isSoftwareRenderer(renderer: string): boolean {
  return SOFTWARE_RENDERERS.test(renderer)
}

let probed: GraphicsProbe | null = null

/** PURPOSE: Checks (once per page load) whether WebGL is available and whether it uses the graphics card. */
export function probeGraphics(): GraphicsProbe {
  if (probed) return probed
  let result: GraphicsProbe = { webgl: false, software: false, renderer: '' }
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
      gl.getExtension('WEBGL_lose_context')?.loseContext() // hand the probe's context straight back
      // A browser that would have to draw in software refuses a context that asks it not to.
      const strict = document.createElement('canvas')
      const fast = (strict.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) || strict.getContext('webgl', { failIfMajorPerformanceCaveat: true })) as WebGLRenderingContext | null
      fast?.getExtension('WEBGL_lose_context')?.loseContext()
      result = { webgl: true, software: isSoftwareRenderer(renderer) || !fast, renderer }
    }
  } catch {
    result = { webgl: false, software: false, renderer: '' }
  }
  probed = result
  return result
}
