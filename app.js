// ── Constantes ────────────────────────────────────────────
const ANNOTATION_COLOR = '#849FFF';
const ARTBOARD_BG      = '#E8E8E8';
const BLUR_RADIUS      = 12;

// ── Estado ────────────────────────────────────────────────
const state = {
  image:       null,   // HTMLImageElement original
  padding:     80,
  radius:      8,
  zoom:        1,
  tool:        'select',
  annotations: [],     // historial de anotaciones
  history:     [],     // pila undo
  redoStack:   [],     // pila redo
  drawing:     false,
  startX:      0,
  startY:      0,
  currentAnnotation: null,
  // Selección
  selected:           null,
  dragging:           false,
  hasMoved:           false,
  resizingHandle:     null,
  dragOffset:         { x: 0, y: 0 },
  annotationSnapshot: null,
  // Recorte
  cropRect:    null,   // { x, y, w, h } en coords de canvas
  cropDrawing: false,
};

// ── Referencias DOM ───────────────────────────────────────
const dropzone     = document.getElementById('dropzone');
const fileInput    = document.getElementById('file-input');
const canvasWrapper = document.getElementById('canvas-wrapper');
const canvas       = document.getElementById('canvas');
const ctx          = canvas.getContext('2d');

const btnExport    = document.getElementById('btn-export');
const btnCopy      = document.getElementById('btn-copy');
const btnShare     = document.getElementById('btn-share');
const shareMenu    = document.getElementById('share-menu');
const btnUndo      = document.getElementById('btn-undo');
const btnRedo      = document.getElementById('btn-redo');
const btnClear     = document.getElementById('btn-clear');

const radiusBtns = document.querySelectorAll('[data-radius]');

// ── Inicialización ────────────────────────────────────────
function init() {
  setupDragDrop();
  setupFileInput();
  setupToolbar();
  setupCanvas();
  setupControls();
  setupShareDropdown();
  setupKeyboard();
  setupPaste();
  initSegCtrls();
}

// ── Drag & Drop ───────────────────────────────────────────
function setupDragDrop() {
  // Dropzone (estado vacío)
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImage(file);
  });

  // Workspace (estado con imagen cargada)
  const workspace = document.querySelector('.workspace');
  const dropOverlay = document.getElementById('drop-overlay');
  workspace.addEventListener('dragover', (e) => {
    if (!state.image) return;
    e.preventDefault();
    dropOverlay.hidden = false;
  });
  workspace.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !workspace.contains(e.relatedTarget)) {
      dropOverlay.hidden = true;
    }
  });
  workspace.addEventListener('drop', (e) => {
    if (!state.image) return;
    e.preventDefault();
    dropOverlay.hidden = true;
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImage(file);
  });
}

function setupFileInput() {
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadImage(fileInput.files[0]);
  });
  document.getElementById('file-input-replace').addEventListener('change', (e) => {
    if (e.target.files[0]) loadImage(e.target.files[0]);
  });
}

// ── Pegar desde portapapeles ──────────────────────────────
function setupPaste() {
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        loadImage(item.getAsFile());
        break;
      }
    }
  });
}

// ── Cargar imagen ─────────────────────────────────────────
function loadImage(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      state.image = img;
      state.annotations = [];
      state.history = [];
      state.redoStack = [];
      showCanvas();
      // Auto-fit: escalar para que el artboard quepa en el workspace
      const artW = img.width  + state.padding * 2;
      const artH = img.height + state.padding * 2;
      state.zoom = computeFitZoom(artW, artH);
      renderCanvas();
      updateZoomLabel();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function showCanvas() {
  dropzone.hidden = true;
  canvasWrapper.hidden = false;
  document.getElementById('zoom-controls').hidden = false;
  document.getElementById('btn-new-image').hidden = false;
}

// ── Render principal ──────────────────────────────────────
function renderCanvas() {
  if (!state.image) return;

  const img = state.image;
  const p   = state.padding;
  const r   = state.radius;

  // Tamaño del artboard (resolución interna completa)
  const artW = img.width  + p * 2;
  const artH = img.height + p * 2;

  canvas.width  = artW;
  canvas.height = artH;

  // Aplicar zoom al tamaño visual (la resolución interna queda intacta)
  canvas.style.width  = Math.round(artW * state.zoom) + 'px';
  canvas.style.height = Math.round(artH * state.zoom) + 'px';

  // Fondo artboard
  ctx.fillStyle = ARTBOARD_BG;
  ctx.fillRect(0, 0, artW, artH);

  // Imagen con border radius
  ctx.save();
  roundedRect(ctx, p, p, img.width, img.height, r);
  ctx.clip();
  ctx.drawImage(img, p, p);
  ctx.restore();

  // Anotaciones
  state.annotations.forEach(a => drawAnnotation(a));

  // Anotación en curso (preview)
  if (state.drawing && state.currentAnnotation) {
    drawAnnotation(state.currentAnnotation);
  }

  // Selección activa
  if (state.selected !== null && state.selected < state.annotations.length) {
    drawSelection(state.annotations[state.selected]);
  }

  // Overlay de recorte
  if (state.tool === 'crop') renderCropOverlay();
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Recorte ───────────────────────────────────────────────
function renderCropOverlay() {
  const img  = state.image;
  const p    = state.padding;
  const artW = img.width  + p * 2;
  const artH = img.height + p * 2;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';

  if (state.cropRect && (Math.abs(state.cropRect.w) > 2 || Math.abs(state.cropRect.h) > 2)) {
    const { x, y, w, h } = getNormalizedCrop();
    // Máscara: 4 rectángulos alrededor del área seleccionada
    ctx.fillRect(0, 0, artW, y);
    ctx.fillRect(0, y + h, artW, artH - y - h);
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, artW - x - w, h);

    // Borde punteado
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.setLineDash([]);

    // Handles en esquinas
    const hs = 8;
    ctx.fillStyle = '#fff';
    [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([hx, hy]) => {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    });
  } else {
    ctx.fillRect(0, 0, artW, artH);
  }
  ctx.restore();
}

function getNormalizedCrop() {
  const { x, y, w, h } = state.cropRect;
  return {
    x: Math.min(x, x + w),
    y: Math.min(y, y + h),
    w: Math.abs(w),
    h: Math.abs(h),
  };
}

function confirmCrop() {
  if (!state.cropRect || !state.image) return;

  const p   = state.padding;
  const img = state.image;
  const { x, y, w, h } = getNormalizedCrop();

  // Limitar al área de la imagen
  const cx  = Math.max(p, x);
  const cy  = Math.max(p, y);
  const cx2 = Math.min(p + img.width,  x + w);
  const cy2 = Math.min(p + img.height, y + h);
  const cw  = cx2 - cx;
  const ch  = cy2 - cy;

  if (cw <= 0 || ch <= 0) { cancelCrop(); return; }

  // Dibujar región recortada en canvas offscreen
  const off    = document.createElement('canvas');
  off.width    = cw;
  off.height   = ch;
  const offCtx = off.getContext('2d');
  offCtx.drawImage(img, cx - p, cy - p, cw, ch, 0, 0, cw, ch);

  const newImg  = new Image();
  newImg.onload = () => {
    state.image       = newImg;
    state.annotations = [];
    state.history     = [];
    state.redoStack   = [];
    state.selected    = null;
    state.cropRect    = null;
    hideCropBar();
    activateTool('select');
    zoomFit();
  };
  newImg.src = off.toDataURL('image/png');
}

function cancelCrop() {
  state.cropRect    = null;
  state.cropDrawing = false;
  hideCropBar();
  activateTool('select');
}

function showCropBar() {
  document.getElementById('crop-bar').hidden = false;
}

function hideCropBar() {
  document.getElementById('crop-bar').hidden = true;
  document.getElementById('btn-crop-confirm').disabled = true;
}

// ── Dibujar anotaciones ───────────────────────────────────
function drawAnnotation(a) {
  ctx.save();
  ctx.strokeStyle = ANNOTATION_COLOR;
  ctx.fillStyle   = ANNOTATION_COLOR;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  if (a.type === 'rect') {
    ctx.lineWidth = 4;
    ctx.strokeRect(a.x, a.y, a.w, a.h);

  } else if (a.type === 'arrow') {
    drawArrow(a.x1, a.y1, a.x2, a.y2);

  } else if (a.type === 'blur') {
    applyBlur(a);
  }

  ctx.restore();
}

function drawArrow(x1, y1, x2, y2) {
  const angle   = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 28;
  const headAngle = Math.PI / 7;

  // Cuerpo de la flecha — termina un poco antes para que no sobresalga de la punta
  const bodyEnd = headLen * 0.75;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - bodyEnd * Math.cos(angle), y2 - bodyEnd * Math.sin(angle));
  ctx.stroke();

  // Cabeza rellena (triángulo sólido)
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - headAngle),
    y2 - headLen * Math.sin(angle - headAngle)
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + headAngle),
    y2 - headLen * Math.sin(angle + headAngle)
  );
  ctx.closePath();
  ctx.fill();
}

function applyBlur(a) {
  const x = Math.min(a.x, a.x + a.w);
  const y = Math.min(a.y, a.y + a.h);
  const w = Math.abs(a.w);
  const h = Math.abs(a.h);
  if (w < 2 || h < 2) return;

  // Blur mediante pixelado
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width  = w;
  tempCanvas.height = h;
  const tempCtx = tempCanvas.getContext('2d');

  // Recortar zona original
  const scale = 10;
  tempCtx.drawImage(canvas, x, y, w, h, 0, 0, w / scale, h / scale);
  tempCtx.imageSmoothingEnabled = false;
  tempCtx.drawImage(tempCanvas, 0, 0, w / scale, h / scale, 0, 0, w, h);

  ctx.drawImage(tempCanvas, x, y);
}

// ── Selección: helpers ────────────────────────────────────
function normalizeBounds(a) {
  return {
    x: Math.min(a.x, a.x + a.w),
    y: Math.min(a.y, a.y + a.h),
    w: Math.abs(a.w),
    h: Math.abs(a.h),
  };
}

function getHandles(a) {
  if (a.type === 'rect' || a.type === 'blur') {
    const b = normalizeBounds(a);
    return [
      { id: 'nw', x: b.x,       y: b.y       },
      { id: 'ne', x: b.x + b.w, y: b.y       },
      { id: 'sw', x: b.x,       y: b.y + b.h },
      { id: 'se', x: b.x + b.w, y: b.y + b.h },
    ];
  }
  if (a.type === 'arrow') {
    return [
      { id: 'start', x: a.x1, y: a.y1 },
      { id: 'end',   x: a.x2, y: a.y2 },
    ];
  }
  return [];
}

function hitAnnotation(a, x, y) {
  if (a.type === 'rect' || a.type === 'blur') {
    const b = normalizeBounds(a);
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  }
  if (a.type === 'arrow') {
    return distToSegment(x, y, a.x1, a.y1, a.x2, a.y2) < 10 / state.zoom;
  }
  return false;
}

function hitHandle(handles, x, y) {
  const r = 8 / state.zoom;
  return handles.find(h => Math.hypot(x - h.x, y - h.y) < r) || null;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function applyResize(a, handleId, x, y) {
  if (a.type === 'rect' || a.type === 'blur') {
    const b = normalizeBounds(state.annotationSnapshot);
    const fixedX = handleId.includes('e') ? b.x         : b.x + b.w;
    const fixedY = handleId.includes('s') ? b.y         : b.y + b.h;
    a.x = Math.min(x, fixedX);
    a.y = Math.min(y, fixedY);
    a.w = Math.abs(x - fixedX);
    a.h = Math.abs(y - fixedY);
  } else if (a.type === 'arrow') {
    if (handleId === 'start') { a.x1 = x; a.y1 = y; }
    else                      { a.x2 = x; a.y2 = y; }
  }
}

function drawSelection(a) {
  if (!a) return;
  const lw = 1.5 / state.zoom;
  const hr =   5 / state.zoom;

  ctx.save();
  ctx.strokeStyle = '#849FFF';
  ctx.lineWidth   = lw;

  if (a.type === 'rect' || a.type === 'blur') {
    const b = normalizeBounds(a);
    ctx.setLineDash([5 / state.zoom, 3 / state.zoom]);
    ctx.strokeRect(b.x - lw, b.y - lw, b.w + lw * 2, b.h + lw * 2);
    ctx.setLineDash([]);
  }

  getHandles(a).forEach(h => {
    ctx.beginPath();
    ctx.arc(h.x, h.y, hr, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.stroke();
  });

  ctx.restore();
}

function snapshotAnnotations() {
  return state.annotations.map(a => ({ ...a }));
}

// ── Interacción con canvas ────────────────────────────────
function setupCanvas() {
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup',   onMouseUp);
}

function getCanvasPos(e) {
  const rect  = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top)  * scaleY,
  };
}

function onMouseDown(e) {
  const pos = getCanvasPos(e);

  if (state.tool === 'select') {
    // 1. Comprobar handles de la anotación seleccionada
    if (state.selected !== null) {
      const ann = state.annotations[state.selected];
      const handle = hitHandle(getHandles(ann), pos.x, pos.y);
      if (handle) {
        state.annotationSnapshot = { ...ann };
        state.resizingHandle = handle.id;
        state.hasMoved = false;
        renderCanvas();
        return;
      }
    }
    // 2. Hit-test anotaciones (la última dibujada primero)
    let found = null;
    for (let i = state.annotations.length - 1; i >= 0; i--) {
      if (hitAnnotation(state.annotations[i], pos.x, pos.y)) { found = i; break; }
    }
    if (found !== null) {
      state.selected = found;
      state.dragging = true;
      state.hasMoved = false;
      const ann = state.annotations[found];
      if (ann.type === 'rect' || ann.type === 'blur') {
        state.dragOffset = { x: pos.x - ann.x, y: pos.y - ann.y };
      } else if (ann.type === 'arrow') {
        state.dragOffset = { x: pos.x - ann.x1, y: pos.y - ann.y1 };
      }
    } else {
      state.selected = null;
    }
    renderCanvas();
    return;
  }

  if (state.tool === 'crop') {
    state.cropRect    = { x: pos.x, y: pos.y, w: 0, h: 0 };
    state.cropDrawing = true;
    document.getElementById('btn-crop-confirm').disabled = true;
    renderCanvas();
    return;
  }

  state.drawing = true;
  state.startX  = pos.x;
  state.startY  = pos.y;

  if (state.tool === 'rect') {
    state.currentAnnotation = { type: 'rect', x: pos.x, y: pos.y, w: 0, h: 0 };
  } else if (state.tool === 'arrow') {
    state.currentAnnotation = { type: 'arrow', x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
  } else if (state.tool === 'blur') {
    state.currentAnnotation = { type: 'blur', x: pos.x, y: pos.y, w: 0, h: 0 };
  }
}

function onMouseMove(e) {
  const pos = getCanvasPos(e);

  if (state.tool === 'select') {
    // Redimensionar
    if (state.resizingHandle !== null && state.selected !== null) {
      if (!state.hasMoved) {
        state.history.push(snapshotAnnotations());
        state.redoStack = [];
        state.hasMoved = true;
      }
      applyResize(state.annotations[state.selected], state.resizingHandle, pos.x, pos.y);
      renderCanvas();
      return;
    }
    // Mover
    if (state.dragging && state.selected !== null) {
      if (!state.hasMoved) {
        state.history.push(snapshotAnnotations());
        state.redoStack = [];
        state.hasMoved = true;
      }
      const ann = state.annotations[state.selected];
      if (ann.type === 'rect' || ann.type === 'blur') {
        ann.x = pos.x - state.dragOffset.x;
        ann.y = pos.y - state.dragOffset.y;
      } else if (ann.type === 'arrow') {
        const newX1 = pos.x - state.dragOffset.x;
        const newY1 = pos.y - state.dragOffset.y;
        const dx = newX1 - ann.x1, dy = newY1 - ann.y1;
        ann.x1 = newX1; ann.y1 = newY1;
        ann.x2 += dx;   ann.y2 += dy;
      }
      renderCanvas();
      return;
    }
    // Cursor según hover
    if (state.selected !== null) {
      const handle = hitHandle(getHandles(state.annotations[state.selected]), pos.x, pos.y);
      if (handle) {
        const cursors = { nw: 'nw-resize', ne: 'ne-resize', sw: 'sw-resize', se: 'se-resize', start: 'crosshair', end: 'crosshair' };
        canvas.style.cursor = cursors[handle.id] || 'crosshair';
        return;
      }
    }
    const hovered = state.annotations.some(a => hitAnnotation(a, pos.x, pos.y));
    canvas.style.cursor = hovered ? 'move' : 'default';
    return;
  }

  if (state.tool === 'crop' && state.cropDrawing && state.cropRect) {
    state.cropRect.w = pos.x - state.cropRect.x;
    state.cropRect.h = pos.y - state.cropRect.y;
    renderCanvas();
    return;
  }

  if (!state.drawing) return;

  if (state.tool === 'rect' || state.tool === 'blur') {
    state.currentAnnotation.w = pos.x - state.startX;
    state.currentAnnotation.h = pos.y - state.startY;
  } else if (state.tool === 'arrow') {
    state.currentAnnotation.x2 = pos.x;
    state.currentAnnotation.y2 = pos.y;
  }

  renderCanvas();
}

function onMouseUp() {
  if (state.tool === 'select') {
    state.dragging      = false;
    state.resizingHandle = null;
    state.annotationSnapshot = null;
    canvas.style.cursor = 'default';
    return;
  }

  if (state.tool === 'crop') {
    state.cropDrawing = false;
    if (state.cropRect && Math.abs(state.cropRect.w) > 5 && Math.abs(state.cropRect.h) > 5) {
      document.getElementById('btn-crop-confirm').disabled = false;
    }
    return;
  }

  if (!state.drawing) return;
  state.drawing = false;

  if (state.currentAnnotation) {
    state.history.push(snapshotAnnotations());
    state.redoStack = [];
    state.annotations.push(state.currentAnnotation);
    state.currentAnnotation = null;
    renderCanvas();
  }
}

// ── Toolbar ───────────────────────────────────────────────
function setupToolbar() {
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      // Si salimos del modo crop sin confirmar, cancelar
      if (state.tool === 'crop' && btn.dataset.tool !== 'crop') {
        state.cropRect = null;
        hideCropBar();
      }

      state.tool = btn.dataset.tool;
      document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (state.tool === 'crop') {
        showCropBar();
        canvas.style.cursor = 'crosshair';
      } else {
        canvas.style.cursor = state.tool === 'select' ? 'default' : 'crosshair';
      }

      renderCanvas();
    });
  });

  // Botones confirmar / cancelar recorte
  document.getElementById('btn-crop-confirm').addEventListener('click', confirmCrop);
  document.getElementById('btn-crop-cancel').addEventListener('click', cancelCrop);

  // Activar 'select' por defecto
  document.querySelector('[data-tool="select"]').classList.add('active');
}

function setupControls() {
  // Segmented control: padding
  document.querySelectorAll('[data-padding]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.padding = parseInt(btn.dataset.padding);
      document.querySelectorAll('[data-padding]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      moveSegThumb(btn);
      renderCanvas();
    });
  });

  // Segmented control: border radius
  radiusBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      radiusBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      moveSegThumb(btn);
      state.radius = parseInt(btn.dataset.radius);
      renderCanvas();
    });
  });

  // Zoom
  document.getElementById('btn-zoom-in') .addEventListener('click', zoomIn);
  document.getElementById('btn-zoom-out').addEventListener('click', zoomOut);
  document.getElementById('btn-zoom-fit').addEventListener('click', zoomFit);

  // Undo / Redo / Clear
  btnUndo.addEventListener('click', undo);
  btnRedo.addEventListener('click', redo);
  btnClear.addEventListener('click', clearAll);

}

// ── Share dropdown ────────────────────────────────────────
function setupShareDropdown() {
  btnShare.addEventListener('click', (e) => {
    e.stopPropagation();
    shareMenu.hidden = !shareMenu.hidden;
  });

  btnExport.addEventListener('click', () => {
    shareMenu.hidden = true;
    exportPNG();
  });

  btnCopy.addEventListener('click', () => {
    shareMenu.hidden = true;
    copyToClipboard();
  });

  document.addEventListener('click', () => {
    shareMenu.hidden = true;
  });
}

// ── Teclado ───────────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); undo(); }
    if (e.key === 'z' && (e.ctrlKey || e.metaKey) &&  e.shiftKey) { e.preventDefault(); redo(); }
    if (e.key === 'y' && (e.ctrlKey || e.metaKey))                { e.preventDefault(); redo(); }
    if ((e.key === '+' || e.key === '=') && !e.metaKey && !e.ctrlKey) zoomIn();
    if  (e.key === '-'                  && !e.metaKey && !e.ctrlKey) zoomOut();
    if   (e.key === '0'                 && !e.metaKey && !e.ctrlKey) zoomFit();
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected !== null) {
      e.preventDefault();
      state.history.push(snapshotAnnotations());
      state.redoStack = [];
      state.annotations.splice(state.selected, 1);
      state.selected = null;
      renderCanvas();
    }
    if (e.key === 'v') activateTool('select');
    if (e.key === 'r') activateTool('rect');
    if (e.key === 'a') activateTool('arrow');
    if (e.key === 'b') activateTool('blur');
    if (e.key === 'c' && !e.ctrlKey && !e.metaKey) activateTool('crop');
    if (e.key === 'Enter' && state.tool === 'crop') { e.preventDefault(); confirmCrop(); }
    if (e.key === 'Escape' && state.tool === 'crop') cancelCrop();
  });
}

function activateTool(name) {
  const btn = document.querySelector(`[data-tool="${name}"]`);
  if (btn) btn.click();
}

// ── Zoom ──────────────────────────────────────────────────
function computeFitZoom(artW, artH) {
  const maxW = window.innerWidth  - 48;  // padding lateral
  const maxH = window.innerHeight - 160; // top (logo) + toolbar + margen
  return Math.min(1, maxW / artW, maxH / artH);
}

function zoomIn() {
  state.zoom = Math.min(3, Math.round((state.zoom + 0.1) * 10) / 10);
  renderCanvas();
  updateZoomLabel();
}

function zoomOut() {
  state.zoom = Math.max(0.1, Math.round((state.zoom - 0.1) * 10) / 10);
  renderCanvas();
  updateZoomLabel();
}

function zoomFit() {
  if (!state.image) return;
  const artW = state.image.width  + state.padding * 2;
  const artH = state.image.height + state.padding * 2;
  state.zoom = computeFitZoom(artW, artH);
  renderCanvas();
  updateZoomLabel();
}

function updateZoomLabel() {
  document.getElementById('zoom-value').textContent = Math.round(state.zoom * 100) + '%';
}

// ── Undo / Redo ───────────────────────────────────────────
function undo() {
  if (state.history.length === 0) return;
  state.redoStack.push(snapshotAnnotations());
  state.annotations = state.history.pop();
  state.selected = null;
  renderCanvas();
}

function redo() {
  if (state.redoStack.length === 0) return;
  state.history.push(snapshotAnnotations());
  state.annotations = state.redoStack.pop();
  state.selected = null;
  renderCanvas();
}

function clearAll() {
  if (state.annotations.length === 0) return;
  state.history.push(snapshotAnnotations());
  state.redoStack = [];
  state.annotations = [];
  state.selected = null;
  renderCanvas();
}

// ── Exportar ──────────────────────────────────────────────
function getExportCanvas() {
  if (!state.image) return null;

  // Renderizar con radius=8 fijo para la exportación
  const prevRadius = state.radius;
  state.radius = 8;
  renderCanvas();

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width  = canvas.width;
  exportCanvas.height = canvas.height;
  const exportCtx = exportCanvas.getContext('2d');
  exportCtx.drawImage(canvas, 0, 0);

  // Restaurar el radius del preview
  state.radius = prevRadius;
  renderCanvas();

  return exportCanvas;
}

function getFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `SL-support-${date}-${time}.png`;
}

function exportPNG() {
  const exportCanvas = getExportCanvas();
  if (!exportCanvas) return;

  const link = document.createElement('a');
  link.download = getFilename();
  link.href = exportCanvas.toDataURL('image/png');
  link.click();
}

async function copyToClipboard() {
  const exportCanvas = getExportCanvas();
  if (!exportCanvas) return;

  try {
    exportCanvas.toBlob(async (blob) => {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      const original = btnShare.textContent;
      btnShare.textContent = 'Copied!';
      setTimeout(() => { btnShare.textContent = original; }, 2000);
    }, 'image/png');
  } catch {
    alert('Your browser does not support copying to clipboard. Use "Download PNG".');
  }
}

// ── Segmented control thumb ───────────────────────────────
function moveSegThumb(btn) {
  const ctrl  = btn.closest('.seg-ctrl');
  const thumb = ctrl.querySelector('.seg-ctrl__thumb');
  thumb.style.width     = btn.offsetWidth + 'px';
  thumb.style.transform = `translateX(${btn.offsetLeft - 3}px)`;
}

function initSegCtrls() {
  document.querySelectorAll('.seg-ctrl').forEach(ctrl => {
    const active = ctrl.querySelector('.seg-ctrl__btn.active');
    if (!active) return;
    const thumb = ctrl.querySelector('.seg-ctrl__thumb');
    // Posición inicial sin animación
    thumb.style.transition = 'none';
    thumb.style.width      = active.offsetWidth + 'px';
    thumb.style.transform  = `translateX(${active.offsetLeft - 3}px)`;
    requestAnimationFrame(() => { thumb.style.transition = ''; });
  });
}

// ── Arranque ──────────────────────────────────────────────
init();
