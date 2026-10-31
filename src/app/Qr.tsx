import qrcode from "qrcode-generator";

// A QR code as inline SVG, so it stays sharp at any TV size and needs no canvas.
export function Qr({ text, label }: { text: string; label: string }) {
  if (!text) return <div class="qr qr-empty" role="img" aria-label={label} />;
  let svg = "";
  try {
    const code = qrcode(0, "M");
    code.addData(text);
    code.make();
    svg = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch {
    svg = "";
  }
  return <div class="qr" role="img" aria-label={label} data-text={text} dangerouslySetInnerHTML={{ __html: svg }} />;
}
