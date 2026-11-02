/**
 * coverPhoto — turns a picture chosen for a binder cover (or just taken with the phone) into a small JPEG,
 * stored as text in the binder's cover field: the longest side at most 640 px, so it stays around 60 KB.
 *
 * USED BY: room3d/ItemPanel.jsx (a binder's cover photo)
 */
const LONGEST = 640

export async function coverFromFile(file: File): Promise<string> {
  const picture = await createImageBitmap(file)
  const scale = Math.min(1, LONGEST / Math.max(picture.width, picture.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(picture.width * scale)
  canvas.height = Math.round(picture.height * scale)
  canvas.getContext('2d')!.drawImage(picture, 0, 0, canvas.width, canvas.height)
  picture.close()
  return canvas.toDataURL('image/jpeg', 0.82)
}
