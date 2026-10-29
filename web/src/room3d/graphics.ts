/**
 * graphics.ts — can this browser draw the 3D room at a usable speed?
 *
 * PURPOSE
 *   The room needs the graphics card. A browser can still offer WebGL without one: Chrome falls back to drawing 3D on
 *   the processor ("Microsoft Basic Render Driver", SwiftShader, llvmpipe) when graphics acceleration is turned off,
 *   the GPU driver is blocklisted or crashed, or on remote desktops and virtual machines. There the room runs at about
 *   one frame a second and the whole tab freezes, so the landing page checks first and offers Spaces instead.
 *
 * HOW IT WORKS
 *   One probe per page load (each probe creates a GL context, and browsers cap how many exist): the renderer's name
 *   (WEBGL_debug_renderer_info) is matched against known software rasterizers, and a context requested with
 *   failIfMajorPerformanceCaveat, which browsers refuse when they would have to draw in software.
 *   A visitor can still choose to open the room ("Open the 3D room anyway"), remembered in localStorage.
 *
 * USED BY: pages/RoomPage.tsx
 */

/** What the probe found. `software` = WebGL works but without the graphics card. */
export interface GraphicsProbe {
  webgl: boolean
  software: boolean
  renderer: string
}

/** Renderer names of WebGL drawn on the processor rather than the graphics card. */
const SOFTWARE_RENDERERS = /swiftshader|basic render driver|llvmpipe|softpipe|software rasterizer|software adapter|mesa offscreen/i

/** The localStorage key that records "open the 3D room even without graphics acceleration". */
export const ALLOW_SLOW_3D_KEY = 'cardstacks.room.allowSoftware'

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

/** PURPOSE: Whether this visitor chose to open the room even though their browser draws 3D in software. */
export function allowsSlow3D(): boolean {
  try { return localStorage.getItem(ALLOW_SLOW_3D_KEY) === '1' } catch { return false }
}

/** PURPOSE: Remembers that this visitor wants the room even without graphics acceleration. */
export function allowSlow3D(): void {
  try { localStorage.setItem(ALLOW_SLOW_3D_KEY, '1') } catch { /* private mode: the choice lasts until reload */ }
}
