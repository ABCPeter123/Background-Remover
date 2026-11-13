import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowLeftRight, Brush, Check, ChevronRight, CircleHelp,
  Eraser, Eye, EyeOff, FileImage, Github, ImagePlus, Layers2,
  LockKeyhole, MousePointer2, Redo2, RotateCcw, Scissors, SlidersHorizontal,
  Sparkles, Undo2, UploadCloud, WandSparkles, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import {
  alphaMaskFromBlob, composeImage, decodeImage, frameToBlob,
  pngBlob, stampBrush, wandSelect, type Frame, type BrushMode,
} from './lib/editor';

type Tool = 'magic' | 'erase' | 'restore';
type Backdrop = 'checker' | 'white' | 'dark' | 'mint';

const MAX_HISTORY = 12;
const GITHUB_URL = 'https://github.com/ABCPeter123/Background-Remover';

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? (bytes / 1024).toFixed(0) + ' KB' : (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function ToolButton({
  active, disabled, icon: Icon, title, description, shortcut, onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: typeof WandSparkles;
  title: string;
  description: string;
  shortcut: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={'tool-button ' + (active ? 'is-active' : '')} disabled={disabled} onClick={onClick} aria-pressed={active}>
      <span className="tool-icon"><Icon size={19} strokeWidth={1.8} /></span>
      <span className="tool-copy"><strong>{title}</strong><small>{description}</small></span>
      <kbd>{shortcut}</kbd>
    </button>
  );
}

function RangeControl({ label, value, unit, min, max, onChange, hint }: {
  label: string; value: number; unit: string; min: number; max: number;
  onChange: (value: number) => void; hint?: string;
}) {
  return (
    <div className="range-control">
      <div className="range-head"><label>{label}</label><span>{value}{unit}</span></div>
      <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} />
      {hint && <p className="range-hint">{hint}</p>}
    </div>
  );
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<Frame | null>(null);
  const maskRef = useRef<Uint8Array | null>(null);
  const historyRef = useRef<{ past: Uint8Array[]; future: Uint8Array[] }>({ past: [], future: [] });
  const strokeRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const animationRef = useRef<number | null>(null);
  const taskIdRef = useRef(0);
  const originalRef = useRef(false);

  const [frame, setFrame] = useState<Frame | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [tool, setTool] = useState<Tool>('magic');
  const [tolerance, setTolerance] = useState(24);
  const [feather, setFeather] = useState(2);
  const [brushSize, setBrushSize] = useState(46);
  const [softness, setSoftness] = useState(28);
  const [backdrop, setBackdrop] = useState<Backdrop>('checker');
  const [zoom, setZoom] = useState(100);
  const [showOriginal, setShowOriginal] = useState(false);
  const [trim, setTrim] = useState(false);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [historyState, setHistoryState] = useState({ undo: false, redo: false });
  const [isDragging, setIsDragging] = useState(false);

  const syncHistory = useCallback(() => {
    setHistoryState({
      undo: historyRef.current.past.length > 0,
      redo: historyRef.current.future.length > 0,
    });
  }, []);

  const saveHistory = useCallback(() => {
    if (!maskRef.current) return;
    historyRef.current.past.push(maskRef.current.slice());
    if (historyRef.current.past.length > MAX_HISTORY) historyRef.current.past.shift();
    historyRef.current.future = [];
    syncHistory();
  }, [syncHistory]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const currentFrame = frameRef.current;
    const currentMask = maskRef.current;
    if (!canvas || !currentFrame || !currentMask) return;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.putImageData(composeImage(currentFrame, currentMask, originalRef.current), 0, 0);
  }, []);

  const scheduleRedraw = useCallback(() => {
    if (animationRef.current !== null) return;
    animationRef.current = requestAnimationFrame(() => {
      animationRef.current = null;
      redraw();
    });
  }, [redraw]);

  useEffect(() => { redraw(); }, [frame, revision, redraw]);

  useEffect(() => {
    originalRef.current = showOriginal;
    redraw();
  }, [showOriginal, redraw]);

  useEffect(() => () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(id);
  }, [notice]);

  const loadFile = useCallback(async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose a PNG, JPEG, WebP, or another image supported by your browser.');
      return;
    }
    const task = ++taskIdRef.current;
    setBusy('Opening image...');
    setError('');
    setNotice('');
    try {
      const decoded = await decodeImage(file);
      if (task !== taskIdRef.current) return;
      frameRef.current = decoded;
      maskRef.current = new Uint8Array(decoded.width * decoded.height);
      historyRef.current = { past: [], future: [] };
      strokeRef.current.active = false;
      originalRef.current = false;
      setShowOriginal(false);
      setFrame(decoded);
      setFileName(file.name);
      setFileSize(file.size);
      setTool('magic');
      setZoom(100);
      setProgress(0);
      setRevision((v) => v + 1);
      syncHistory();
      if (decoded.width * decoded.height < 50) setNotice('Image loaded.');
    } catch (reason) {
      if (task === taskIdRef.current) setError(reason instanceof Error ? reason.message : 'Could not open that image.');
    } finally {
      if (task === taskIdRef.current) setBusy('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [syncHistory]);

  const undo = useCallback(() => {
    const current = maskRef.current;
    const previous = historyRef.current.past.pop();
    if (!current || !previous) return;
    historyRef.current.future.push(current.slice());
    maskRef.current = previous;
    setRevision((v) => v + 1);
    syncHistory();
  }, [syncHistory]);

  const redo = useCallback(() => {
    const current = maskRef.current;
    const next = historyRef.current.future.pop();
    if (!current || !next) return;
    historyRef.current.past.push(current.slice());
    maskRef.current = next;
    setRevision((v) => v + 1);
    syncHistory();
  }, [syncHistory]);

  const resetMask = useCallback(() => {
    const current = maskRef.current;
    if (!current || !current.some((v) => v > 0)) return;
    saveHistory();
    maskRef.current = new Uint8Array(current.length);
    setRevision((v) => v + 1);
  }, [saveHistory]);

  const invertMask = useCallback(() => {
    const current = maskRef.current;
    if (!current) return;
    saveHistory();
    const next = current.slice();
    for (let i = 0; i < next.length; i++) next[i] = 255 - next[i];
    maskRef.current = next;
    setRevision((v) => v + 1);
    setNotice('Selection inverted.');
  }, [saveHistory]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if (modifier || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'v') setTool('magic');
      if (key === 'e') setTool('erase');
      if (key === 'r') setTool('restore');
    };
    const onPaste = (event: ClipboardEvent) => {
      const image = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'));
      if (!image) return;
      const pasted = image.getAsFile();
      if (pasted) { event.preventDefault(); void loadFile(pasted); }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
    };
  }, [loadFile, redo, undo]);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const current = frameRef.current!;
    return {
      x: Math.max(0, Math.min(current.width - 0.001, ((event.clientX - rect.left) / rect.width) * current.width)),
      y: Math.max(0, Math.min(current.height - 0.001, ((event.clientY - rect.top) / rect.height) * current.height)),
    };
  };

  const drawStroke = (x: number, y: number) => {
    const current = frameRef.current;
    const mask = maskRef.current;
    if (!current || !mask) return;
    const previous = strokeRef.current;
    const distance = Math.hypot(x - previous.x, y - previous.y);
    const step = Math.max(1, brushSize * 0.23);
    const count = Math.max(1, Math.ceil(distance / step));
    const mode: BrushMode = tool === 'restore' ? 'restore' : 'erase';
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      stampBrush(mask, current.width, current.height,
        previous.x + (x - previous.x) * t,
        previous.y + (y - previous.y) * t,
        brushSize / 2, softness / 100, mode);
    }
    strokeRef.current.x = x;
    strokeRef.current.y = y;
    scheduleRedraw();
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || busy || showOriginal || !frameRef.current || !maskRef.current) return;
    const point = getPoint(event);
    saveHistory();
    if (tool === 'magic') {
      maskRef.current = wandSelect(frameRef.current, maskRef.current, point.x, point.y, tolerance, feather,
        event.shiftKey ? 'restore' : 'erase');
      setRevision((v) => v + 1);
      return;
    }
    strokeRef.current = { active: true, ...point };
    event.currentTarget.setPointerCapture(event.pointerId);
    stampBrush(maskRef.current, frameRef.current.width, frameRef.current.height, point.x, point.y,
      brushSize / 2, softness / 100, tool === 'restore' ? 'restore' : 'erase');
    scheduleRedraw();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!strokeRef.current.active || !maskRef.current || !frameRef.current) return;
    const point = getPoint(event);
    drawStroke(point.x, point.y);
  };

  const onPointerUp = () => {
    if (!strokeRef.current.active) return;
    strokeRef.current.active = false;
    setRevision((v) => v + 1);
  };

  const runAI = async () => {
    const current = frameRef.current;
    if (!current || busy) return;
    const task = ++taskIdRef.current;
    setError('');
    setBusy('Loading the AI model...');
    setProgress(0);
    try {
      const input = await frameToBlob(current);
      const { default: removeBackground } = await import('@imgly/background-removal');
      if (task !== taskIdRef.current) return;
      const output = await removeBackground(input, {
        model: 'isnet_quint8',
        device: 'cpu',
        output: { type: 'foreground', format: 'image/png', quality: 1 },
        progress: (_key: string, done: number, total: number) => {
          if (task !== taskIdRef.current || total <= 0) return;
          setProgress(Math.max(0, Math.min(99, Math.round(done / total * 100))));
        },
      });
      if (task !== taskIdRef.current) return;
      const next = await alphaMaskFromBlob(output, current);
      if (task !== taskIdRef.current) return;
      saveHistory();
      maskRef.current = next;
      setRevision((v) => v + 1);
      setProgress(100);
      setNotice('AI cutout ready. Refine any areas with the brushes.');
    } catch (reason) {
      if (task === taskIdRef.current) setError(reason instanceof Error ? reason.message : 'AI cutout failed. Try the magic select tool.');
    } finally {
      if (task === taskIdRef.current) setBusy('');
    }
  };

  const exportPng = async () => {
    const current = frameRef.current;
    const mask = maskRef.current;
    if (!current || !mask || busy) return;
    setBusy('Preparing your PNG...');
    setError('');
    try {
      const blob = await pngBlob(current, mask, trim);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = (fileName.replace(/\.[^.]+$/, '') || 'cutout') + '-cutout.png';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      setNotice('Transparent PNG downloaded.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not export image.');
    } finally {
      setBusy('');
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith('image/'));
    if (file) void loadFile(file);
    else setError('Please drop an image file.');
  };

  const selectedToolName = tool === 'magic' ? 'Magic select' : tool === 'erase' ? 'Erase brush' : 'Restore brush';

  return (
    <div className="application">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Cutout Studio home">
          <span className="brand-mark"><Scissors size={20} strokeWidth={2.4} /></span>
          <span className="brand-name">cutout<span>.</span></span>
          <span className="brand-tag">STUDIO</span>
        </a>
        <div className="topbar-right">
          <span className="privacy-note"><LockKeyhole size={14} /> Private by design. Your photos stay here.</span>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="github-link" aria-label="View source on GitHub"><Github size={18} /></a>
        </div>
      </header>

      <main className="main-content">
        <div className="page-heading">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> YOUR CREATIVE WORKSPACE <span className="eyebrow-index">/ 01</span></div>
            <h1>Remove what you <em>don't need.</em></h1>
            <p>Tap a background, let AI find the subject, or refine every edge yourself.</p>
          </div>
          <div className="heading-steps">
            <span><b>01</b> Upload</span><ChevronRight size={13} /><span><b>02</b> Select</span><ChevronRight size={13} /><span><b>03</b> Export</span>
          </div>
        </div>

        <div className="editor-grid">
          <aside className="side-panel tools-panel">
            <div className="panel-topline"><span>01 / TOOLS</span><SlidersHorizontal size={15} /></div>
            <h2>Your toolkit</h2>
            <p className="panel-subtitle">Choose how you want to edit.</p>
            <div className="tool-list">
              <ToolButton active={tool === 'magic'} disabled={!frame || !!busy} icon={WandSparkles} title="Magic select" description="Click a region to remove" shortcut="V" onClick={() => setTool('magic')} />
              <ToolButton active={tool === 'erase'} disabled={!frame || !!busy} icon={Eraser} title="Erase brush" description="Remove any detail" shortcut="E" onClick={() => setTool('erase')} />
              <ToolButton active={tool === 'restore'} disabled={!frame || !!busy} icon={Brush} title="Restore brush" description="Bring pixels back" shortcut="R" onClick={() => setTool('restore')} />
            </div>

            <div className="panel-divider" />
            <div className="section-kicker">EDIT HISTORY</div>
            <div className="edit-actions">
              <button type="button" disabled={!historyState.undo || !!busy} onClick={undo} title="Undo (Ctrl/Cmd+Z)"><Undo2 size={17} /><span>Undo</span></button>
              <button type="button" disabled={!historyState.redo || !!busy} onClick={redo} title="Redo (Ctrl/Cmd+Shift+Z)"><Redo2 size={17} /><span>Redo</span></button>
            </div>
            <button type="button" className="text-action" disabled={!frame || !!busy} onClick={resetMask}><RotateCcw size={15} /> Reset all edits</button>

            <div className="left-help">
              <span className="help-badge"><CircleHelp size={15} /> QUICK TIP</span>
              <p>{tool === 'magic' ? 'Click any part of the image to erase connected pixels with similar colors. Hold Shift and click to restore.' : tool === 'erase' ? 'Paint over anything you want to remove. Make the brush smaller for fine details.' : 'Paint over erased parts to bring them back. Great for hair, clothes, and edges.'}</p>
            </div>
          </aside>

          <section className="editor-center" aria-label="Image editing workspace">
            <div className="canvas-header">
              <div className="canvas-header-left"><span className="live-dot" /><strong>{frame ? 'EDITING CANVAS' : 'READY WHEN YOU ARE'}</strong><span className="canvas-header-separator">/</span><span>{frame ? selectedToolName : 'No image selected'}</span></div>
              <div className="canvas-header-actions">
                <button type="button" className={showOriginal ? 'icon-button selected' : 'icon-button'} disabled={!frame || !!busy} onClick={() => setShowOriginal((v) => !v)} title={showOriginal ? 'Show edited image' : 'Show original image'} aria-label={showOriginal ? 'Show edited image' : 'Show original image'}>{showOriginal ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                <span className="vertical-divider" />
                <button type="button" className="icon-button" disabled={!frame || zoom <= 50} onClick={() => setZoom((v) => Math.max(50, v - 25))} title="Zoom out" aria-label="Zoom out"><ZoomOut size={17} /></button>
                <span className="zoom-value">{zoom}%</span>
                <button type="button" className="icon-button" disabled={!frame || zoom >= 200} onClick={() => setZoom((v) => Math.min(200, v + 25))} title="Zoom in" aria-label="Zoom in"><ZoomIn size={17} /></button>
              </div>
            </div>
            <div
              className={'canvas-stage backdrop-' + backdrop + (isDragging ? ' dragging' : '') + (frame ? ' has-image' : '')}
              onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false); }}
              onDrop={handleDrop}
            >
              {frame ? (
                <>
                  <div className="canvas-scroll">
                    <canvas
                      ref={canvasRef}
                      width={frame.width}
                      height={frame.height}
                      className={'image-canvas ' + (tool === 'magic' ? 'cursor-wand' : 'cursor-brush')}
                      style={{ transform: 'scale(' + (zoom / 100) + ')' }}
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                      onLostPointerCapture={onPointerUp}
                      aria-label="Interactive image canvas. Click a region to remove it or use the brushes."
                    />
                  </div>
                  {showOriginal && <div className="original-pill"><Eye size={13} /> ORIGINAL PREVIEW</div>}
                  {isDragging && <div className="drop-overlay"><ImagePlus size={32} /><strong>Drop to replace your image</strong></div>}
                </>
              ) : (
                <div className="empty-state">
                  <div className="empty-art" aria-hidden="true">
                    <div className="art-frame"><span className="art-sun" /><span className="art-hill art-hill-back" /><span className="art-hill art-hill-front" /><span className="art-spark art-spark-one" /><span className="art-spark art-spark-two" /></div>
                    <span className="art-cursor"><MousePointer2 size={24} /></span>
                    <span className="art-corner art-corner-a" /><span className="art-corner art-corner-b" />
                  </div>
                  <div className="empty-kicker"><Sparkles size={14} /> THE CANVAS IS YOURS</div>
                  <h2>Your image, your rules.</h2>
                  <p>Drop an image to start removing backgrounds, objects, or anything in between.</p>
                  <button type="button" className="primary-button upload-main" onClick={() => fileInputRef.current?.click()}><UploadCloud size={19} /> Choose an image <ChevronRight size={18} /></button>
                  <div className="empty-meta">Drag & drop an image here <span>·</span> or paste from clipboard</div>
                  <div className="format-tags"><span>PNG</span><span>JPG</span><span>WEBP</span><span>AVIF*</span></div>
                </div>
              )}
              {!!busy && <div className="busy-overlay" role="status" aria-live="polite"><div className="loading-spinner" /><strong>{busy}</strong><span>{busy.includes('AI') || busy.includes('model') ? 'The model runs on your device. First use downloads the AI model.' : 'Processing your image...'}</span>{progress > 0 && progress < 100 && <div className="progress-track"><div style={{ width: progress + '%' }} /></div>}</div>}
            </div>
            <div className="canvas-status">
              <div className="status-left"><span className="status-dot" /> {frame ? fileName : 'No file uploaded'} {frame && <span className="status-details">{frame.width} × {frame.height} px <span className="dot-separator">·</span> {formatBytes(fileSize)}</span>}</div>
              <div className="status-right">
                {frame && <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!!busy}><ImagePlus size={15} /> Replace</button>}
                <span className="status-suffix">LOCAL PROCESSING <LockKeyhole size={12} /></span>
              </div>
            </div>
          </section>

          <aside className="side-panel settings-panel">
            <div className="panel-topline"><span>02 / EDITOR</span><Sparkles size={15} /></div>
            <h2>Make it yours</h2>
            <p className="panel-subtitle">A little magic, a lot of control.</p>

            <div className="ai-card">
              <div className="ai-top"><span className="ai-badge"><Sparkles size={13} /> AI POWERED</span><span className="ai-star">✳</span></div>
              <h3>One-click cutout.</h3>
              <p>Automatically find the main subject and remove what's behind it.</p>
              <button type="button" className="ai-action" disabled={!frame || !!busy} onClick={() => void runAI()}><WandSparkles size={18} /> Remove background <ChevronRight size={18} /></button>
              <small>No upload. Model downloads on first use.</small>
            </div>

            <div className="settings-section">
              <div className="settings-title"><span>SELECTION CONTROLS</span><span className="small-tag">{tool === 'magic' ? 'MAGIC' : 'BRUSH'}</span></div>
              {tool === 'magic' ? (
                <>
                  <RangeControl label="Color tolerance" value={tolerance} unit="%" min={1} max={100} onChange={setTolerance} hint="Higher values select a wider range of colors." />
                  <RangeControl label="Edge feather" value={feather} unit="px" min={0} max={12} onChange={setFeather} hint="Softens the border of your selection." />
                </>
              ) : (
                <>
                  <RangeControl label="Brush size" value={brushSize} unit="px" min={4} max={240} onChange={setBrushSize} hint="Adjust for broad areas or small details." />
                  <RangeControl label="Brush softness" value={softness} unit="%" min={0} max={100} onChange={setSoftness} hint="Use a soft brush to refine delicate edges." />
                </>
              )}
              <button type="button" className="invert-button" onClick={invertMask} disabled={!frame || !!busy}><ArrowLeftRight size={16} /><span>Invert removed area</span><ChevronRight size={15} /></button>
            </div>

            <div className="settings-section preview-section">
              <div className="settings-title"><span>CANVAS PREVIEW</span><span className="small-tag">VIEW</span></div>
              <p className="settings-hint">Preview transparency against any background.</p>
              <div className="swatch-row">
                {(['checker', 'white', 'dark', 'mint'] as Backdrop[]).map((option) => (
                  <button key={option} type="button" className={'swatch swatch-' + option + (backdrop === option ? ' is-selected' : '')} aria-label={'Use ' + option + ' background'} title={option + ' background'} aria-pressed={backdrop === option} onClick={() => setBackdrop(option)}>{backdrop === option && <Check size={16} />}</button>
                ))}
              </div>
            </div>

            <div className="export-section">
              <div className="settings-title"><span>03 / EXPORT</span><span className="small-tag">PNG</span></div>
              <label className="checkbox-line"><input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} disabled={!frame} /><span>Trim transparent edges</span></label>
              <button type="button" className="export-button" onClick={() => void exportPng()} disabled={!frame || !!busy}><ArrowDownToLine size={19} /> Download transparent PNG <ChevronRight size={17} /></button>
              <p className="export-hint">No watermark. No sign-up. Your image stays yours.</p>
            </div>
          </aside>
        </div>

        {(error || notice) && <div className={'feedback ' + (error ? 'feedback-error' : 'feedback-success')} role="status"><span>{error || notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => { setError(''); setNotice(''); }}><X size={15} /></button></div>}
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" className="sr-only" onChange={(event) => void loadFile(event.target.files?.[0])} aria-label="Upload image" />
      </main>

      <footer className="site-footer">
        <div><span className="footer-brand"><Layers2 size={16} /> cutout studio</span><span className="footer-separator">/</span><span>Precision made simple.</span></div>
        <div><span>Runs in your browser</span><span className="footer-separator">·</span><a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">Open source <Github size={13} /></a></div>
      </footer>
    </div>
  );
}
