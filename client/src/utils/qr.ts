import QRCode from "qrcode";

export async function drawQr(canvas: HTMLCanvasElement, text: string): Promise<void> {
  await QRCode.toCanvas(canvas, text, {
    width: canvas.width || 256,
    margin: 2,
    errorCorrectionLevel: "M",
    color: {
      dark: "#000000ff",
      light: "#ffffffff",
    },
  });
}
