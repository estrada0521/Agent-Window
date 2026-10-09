const surface = document.querySelector('.image-surface');
const image = surface.querySelector('img');
const pointers = new Map();
let scale = 1;
let x = 0;
let y = 0;
let gesture;
let lastTap = 0;
let tapStart;

const draw = () => {
  const limitX = Math.max(0, (image.offsetWidth * scale - surface.clientWidth) / 2);
  const limitY = Math.max(0, (image.offsetHeight * scale - surface.clientHeight) / 2);
  x = Math.max(-limitX, Math.min(limitX, x));
  y = Math.max(-limitY, Math.min(limitY, y));
  image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
};
const position = () => {
  const points = [...pointers.values()];
  const rect = surface.getBoundingClientRect();
  const a = points[0];
  const b = points[1] || a;
  return {
    x: (a.x + b.x) / 2 - rect.left - rect.width / 2,
    y: (a.y + b.y) / 2 - rect.top - rect.height / 2,
    distance: Math.hypot(a.x - b.x, a.y - b.y),
  };
};
const begin = () => {
  gesture = { ...position(), scale, offsetX: x, offsetY: y };
};
surface.addEventListener('pointerdown', event => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  surface.setPointerCapture(event.pointerId);
  tapStart = pointers.size === 1 ? { x: event.clientX, y: event.clientY, time: performance.now() } : null;
  if (pointers.size > 1) lastTap = 0;
  begin();
});
surface.addEventListener('pointermove', event => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (tapStart && Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y) > 8) tapStart = null;
  const point = position();
  scale = gesture.distance ? Math.max(1, Math.min(6, gesture.scale * point.distance / gesture.distance)) : gesture.scale;
  x = point.x - (gesture.x - gesture.offsetX) * scale / gesture.scale;
  y = point.y - (gesture.y - gesture.offsetY) * scale / gesture.scale;
  draw();
});
const end = event => {
  if (!pointers.delete(event.pointerId)) return;
  if (event.type === 'pointerup' && tapStart && performance.now() - tapStart.time < 300) {
    const now = performance.now();
    if (lastTap && now - lastTap < 300) {
      const point = gesture;
      const nextScale = scale > 1 ? 1 : 2;
      x = point.x - (point.x - x) * nextScale / scale;
      y = point.y - (point.y - y) * nextScale / scale;
      scale = nextScale;
      lastTap = 0;
      draw();
    } else lastTap = now;
  }
  tapStart = null;
  if (pointers.size) begin();
};
surface.addEventListener('pointerup', end);
surface.addEventListener('pointercancel', end);
window.addEventListener('resize', draw);
image.addEventListener('load', draw);
