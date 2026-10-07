export type Tool = 'select' | 'text' | 'highlight' | 'pen' | 'shape' | 'whiteout' | 'image' | 'signature' | 'link' | 'forms';
export type MarkKind = 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'highlight' | 'pen' | 'whiteout' | 'image' | 'link';
export type Point = { x: number; y: number };
export type TextSource = { id: string; page: number; quad: number[] };
export type Mark = {
  id: string; pageId: string; kind: MarkKind;
  x: number; y: number; width: number; height: number;
  color: string; stroke: number; opacity: number;
  text?: string; fontSize?: number; font?: 'sans' | 'serif' | 'mono' | 'signature'; bold?: boolean;
  src?: string; points?: Point[]; url?: string;
  filled?: boolean;
  replaces?: TextSource; angle?: number;
};
export type PageInfo = { id: string; source: number | null; width: number; height: number; originalRotation: number; rotation: number; originX?: number; originY?: number; userUnit?: number };
export type EditorState = { pages: PageInfo[]; marks: Mark[]; fields: Record<string, string | boolean | string[]> };
export type Draft = { bytes: Uint8Array; name: string; state: EditorState; updated: number };
export type FormWidget = { id: string; name: string; type: string; x: number; y: number; width: number; height: number; value: string | boolean | string[]; options?: { displayValue: string; exportValue: string }[]; multiline?: boolean; radio?: boolean; buttonValue?: string; readOnly?: boolean };
export const uid = () => crypto.randomUUID();
export const palette = ['#252322', '#ed655c', '#3976d6', '#348c68', '#b077d8', '#eab746', '#ffffff'];
export const emptyState: EditorState = { pages: [], marks: [], fields: {} };
export function normalizeRotation(angle: number) { return ((angle % 360) + 360) % 360; }
export function displaySize(page: PageInfo) { return page.rotation % 180 ? { width: page.height, height: page.width } : { width: page.width, height: page.height }; }
export function pageTransform(page: PageInfo) {
  const r = normalizeRotation(page.rotation);
  if (r === 90) return `translate(${page.height}px, 0) rotate(90deg)`;
  if (r === 180) return `translate(${page.width}px, ${page.height}px) rotate(180deg)`;
  if (r === 270) return `translate(0, ${page.width}px) rotate(270deg)`;
  return 'none';
}
export function rotatedToBase(p: Point, page: PageInfo): Point {
  const r = normalizeRotation(page.rotation);
  if (r === 90) return { x: p.y, y: page.height - p.x };
  if (r === 180) return { x: page.width - p.x, y: page.height - p.y };
  if (r === 270) return { x: page.width - p.y, y: p.x };
  return p;
}

export function safeUrl(input: string) {
  try { const u = new URL(input); return ["http:", "https:", "mailto:"].includes(u.protocol) ? u.href : null; } catch { return null; }
}
