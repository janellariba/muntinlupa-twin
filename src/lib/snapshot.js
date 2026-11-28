// snapshot.js: a JPEG of the current video frame with the detection boxes drawn on it,
// plus the camera name and time, for saving to the database's picture storage.
const JPEG_QUALITY = 0.8; // picture compression: about 100-250 KB for a 720p frame

export function annotatedJpeg(video, dets, camName) {
  const W = video.videoWidth, H = video.videoHeight;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.drawImage(video, 0, 0, W, H);
  const lw = Math.max(2, W / 320), fs = Math.max(12, Math.round(W / 40));
  g.font = `700 ${fs}px "IBM Plex Mono", monospace`;
  for (const d of dets) {
    const col = /fire|flame/i.test(d.name) ? "#ff3b30" : "#d0d6d4";
    g.strokeStyle = col; g.lineWidth = lw;
    g.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1);
    const label = `${d.name} ${Math.round(d.conf * 100)}%`, tw = g.measureText(label).width;
    const ty = d.y1 > fs + 6 ? d.y1 - 4 : d.y2 + fs + 2;
    g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(d.x1, ty - fs, tw + 8, fs + 4);
    g.fillStyle = col; g.fillText(label, d.x1 + 4, ty);
  }
  const stamp = `${camName}  ${new Date().toLocaleString()}`;
  g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(0, H - fs - 10, g.measureText(stamp).width + 16, fs + 10);
  g.fillStyle = "#ffffff"; g.fillText(stamp, 8, H - 8);
  return c.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1]; // base64 without the "data:" prefix
}
