export type Crop = { x: number; y: number; width: number; height: number };
export async function prepareINEImage(source: Blob, crop?: Crop, enhance = false, rotate = false): Promise<Blob> {
  const image = await createImageBitmap(source, { imageOrientation: "from-image" });
  try {
    const region = crop ?? { x: 0, y: 0, width: 1, height: 1 };
    const sx = Math.max(0, Math.min(.99, region.x)) * image.width;
    const sy = Math.max(0, Math.min(.99, region.y)) * image.height;
    const sw = Math.max(1, Math.min(region.width * image.width, image.width - sx));
    const sh = Math.max(1, Math.min(region.height * image.height, image.height - sy));
    const scale = Math.min(3, 2200 / Math.max(sw, sh));
    const width = Math.round(sw * scale), height = Math.round(sh * scale);
    const border = 16;
    const canvas = document.createElement("canvas");
    canvas.width = (rotate ? height : width) + border * 2;
    canvas.height = (rotate ? width : height) + border * 2;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw Error("No se pudo preparar la foto.");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(border + (rotate ? height : 0), border);
    if (rotate) context.rotate(Math.PI / 2);
    context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
    if (enhance) {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const histogram = new Uint32Array(256);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const gray = Math.round(.299 * pixels.data[i] + .587 * pixels.data[i + 1] + .114 * pixels.data[i + 2]);
        histogram[gray]++;
      }
      const total = canvas.width * canvas.height;
      let count = 0, low = 0, high = 255;
      for (let v = 0; v < 256; v++) { count += histogram[v]; if (count > total * .01) { low = v; break; } }
      count = 0;
      for (let v = 255; v >= 0; v--) { count += histogram[v]; if (count > total * .01) { high = v; break; } }
      for (let i = 0; i < pixels.data.length; i += 4) {
        const gray = .299 * pixels.data[i] + .587 * pixels.data[i + 1] + .114 * pixels.data[i + 2];
        const value = Math.max(0, Math.min(255, (gray - low) * 255 / Math.max(40, high - low)));
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      }
      context.putImageData(pixels, 0, 0);
    }
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error("No se pudo preparar la foto.")), "image/png"));
  } finally { image.close(); }
}

