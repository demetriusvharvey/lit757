export type MapLogoPresentation = {
  name: string;
  score: number;
};

export function activityColor(score: number) {
  if (score >= 90) return "#ef4444";
  if (score >= 82) return "#fb923c";
  if (score >= 72) return "#facc15";
  if (score >= 60) return "#a3e635";
  if (score >= 45) return "#34d399";
  return "#64748b";
}

function venueInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "B";
}

/**
 * Builds one complete map sprite so activity color and logo placement cannot
 * drift apart. If a provider logo cannot be decoded, the same sprite becomes
 * a branded initials tile instead of leaving an anonymous circle behind.
 */
export function createVenueLogoSprite(
  image: ImageBitmap | HTMLImageElement | ImageData | undefined,
  presentation: MapLogoPresentation,
) {
  const size = 144;
  const center = size / 2;
  const outerRadius = 54;
  const innerRadius = 47;
  const color = activityColor(presentation.score);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.save();
  context.shadowColor = color;
  context.shadowBlur = 20;
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(center, center, outerRadius, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.save();
  context.beginPath();
  context.arc(center, center, innerRadius, 0, Math.PI * 2);
  context.clip();

  if (image) {
    let source: CanvasImageSource;
    if (image instanceof ImageData) {
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = image.width;
      sourceCanvas.height = image.height;
      sourceCanvas.getContext("2d")?.putImageData(image, 0, 0);
      source = sourceCanvas;
    } else {
      source = image;
    }
    const scale = Math.max(
      (innerRadius * 2) / image.width,
      (innerRadius * 2) / image.height,
    );
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(
      source,
      center - width / 2,
      center - height / 2,
      width,
      height,
    );
  } else {
    const gradient = context.createLinearGradient(24, 20, 120, 124);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "#111827");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    context.fillStyle = "#ffffff";
    context.font = "800 42px Inter, Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(venueInitials(presentation.name), center, center + 2);
  }
  context.restore();

  context.strokeStyle = color;
  context.lineWidth = 7;
  context.beginPath();
  context.arc(center, center, outerRadius - 3.5, 0, Math.PI * 2);
  context.stroke();

  return context.getImageData(0, 0, size, size);
}
