//消すな！！！
//セキュリティ エラー → Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
//消すな！！！

"use client";

import React, { useEffect, useRef, useState } from 'react';

declare const fabric: any;

// ─── モジュールレベル定数（再renderごとの再生成を防ぐ） ───────────────────────

type AxisKey = 'W' | 'D' | 'H';
type DimMode = 'W' | 'W_D' | 'W_H' | 'W_D_H' | 'TEXT_ONLY' | 'ARROW_ONLY';

const DEFAULT_AXIS_COLORS: Record<AxisKey, string> = { W: '#ef4444', D: '#3b82f6', H: '#22c55e' };

const FONT_FAMILY = 'Inter, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif';

const TEXT_BASE_STYLE = {
  fontSize: 12,
  fontWeight: '500' as const,
  fontFamily: FONT_FAMILY,
};

const SERIALIZE_PROPERTIES = [
  '_dimMode', '_dimensionParts', '_parentGroup', '_isNewLine', '_customTopOffset',
  '_isTextBoxContainer', '_targetGroupId', '_isPropertyTitle',
  '_colorCoded', '_axisColors', '_axisLabel', '_arrowFlipped',
  'selectable', 'evented',
  'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY', 'lockRotation', 'lockUniScaling',
  'hasControls', 'hasBorders', 'objectCaching', 'noScaleCache', 'id',
];

// グループの伸縮ハンドルとスケールロックを dimMode に応じて設定する共通ヘルパー
const applyGroupControls = (group: any, dimMode: string) => {
  const isWOnly = dimMode === 'W' || dimMode === 'W_H';
  group.setControlsVisibility({
    mt: !isWOnly, mb: !isWOnly, ml: true, mr: true,
    bl: false, br: false, tl: false, tr: false, mtr: true,
  });
  group.lockScalingY = isWOnly;
};

// ─── 色分け適用ヘルパー ──────────────────────────────────────────────────────

const applyAxisColors = (group: any, parts: any) => {
  if (!group || !parts) return;
  const colorCoded: boolean = !!group._colorCoded;
  const axisColors: Record<AxisKey, string> = { ...DEFAULT_AXIS_COLORS, ...(group._axisColors || {}) };
  const flipped: boolean = !!group._arrowFlipped;

  // テキスト色は _axisColors がそのまま対応
  const wTextColor = colorCoded ? axisColors.W : axisColors.W;
  const dTextColor = colorCoded ? axisColors.D : axisColors.W;
  const hTextColor = colorCoded ? axisColors.H : axisColors.W;

  // 矢印線色は flipped 時に W↔D を入れ替え
  const wArrowColor = colorCoded ? (flipped ? axisColors.D : axisColors.W) : axisColors.W;
  const dArrowColor = colorCoded ? (flipped ? axisColors.W : axisColors.D) : axisColors.W;

  if (parts.wLine)   parts.wLine.set('stroke', wArrowColor);
  if (parts.wLeft)   parts.wLeft.set('fill',   wArrowColor);
  if (parts.wRight)  parts.wRight.set('fill',  wArrowColor);
  if (parts.dLine)   parts.dLine.set('stroke', dArrowColor);
  if (parts.dTop)    parts.dTop.set('fill',    dArrowColor);
  if (parts.dBottom) parts.dBottom.set('fill', dArrowColor);

  // テキストは常に _axisLabel → テキスト色
  parts.textElements?.forEach((t: any) => {
    const label: AxisKey = t._axisLabel || 'W';
    const colorMap: Record<AxisKey, string> = { W: wTextColor, D: dTextColor, H: hTextColor };
    t.set('fill', colorMap[label]);
  });
};

// ─── UIステート型 ────────────────────────────────────────────────────────────

type ColorPanelState = {
  groupId: string | null;
  dimMode: string | null;
  colorCoded: boolean;
  axisColors: Record<AxisKey, string>;
};

const COLOR_PANEL_RESET: ColorPanelState = {
  groupId: null, dimMode: null, colorCoded: false, axisColors: { ...DEFAULT_AXIS_COLORS },
};

// ─── コンポーネント ──────────────────────────────────────────────────────────

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvas, setCanvas] = useState<any>(null);
  const [isPlacing, setIsPlacing] = useState(false);
  const [dimMode, setDimMode] = useState<DimMode>('W');
  const [isSelectedHasHighlight, setIsSelectedHasHighlight] = useState(false);
  const [colorPanel, setColorPanel] = useState<ColorPanelState>(COLOR_PANEL_RESET);
  const [fabricLoaded, setFabricLoaded] = useState(false);

  const copiedJsonRef = useRef<string | null>(null);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const isRespondingToHistory = useRef(false);

  // ── 履歴 ─────────────────────────────────────────────────────────────────

  const saveHistory = (fCanvas: any) => {
    if (isRespondingToHistory.current) return;
    const json = JSON.stringify(fCanvas.toObject(SERIALIZE_PROPERTIES));
    if (undoStack.current.at(-1) === json) return;
    undoStack.current.push(json);
    redoStack.current = [];
  };

  const loadHistoryState = async (fCanvas: any, jsonStr: string) => {
    isRespondingToHistory.current = true;
    try {
      fCanvas.discardActiveObject();
      const bgImage = fCanvas.backgroundImage;

      fCanvas.getObjects().filter((o: any) => o._isTextBoxContainer).forEach((o: any) => fCanvas.remove(o));
      await fCanvas.loadFromJSON(jsonStr);
      if (bgImage) fCanvas.backgroundImage = bgImage;

      fCanvas.getObjects().filter((o: any) => o._isTextBoxContainer).forEach((o: any) => {
        o.selectable = false;
        o.evented = false;
      });

      const allObjs = fCanvas.getObjects();
      const groups = allObjs.filter((o: any) => o.type === 'group');
      const texts  = allObjs.filter((o: any) => o.type === 'i-text');

      groups.forEach((group: any) => {
        if (!group.id) group.id = genId();

        const parts: any = {};
        group.getObjects().forEach((child: any, i: number) => {
          const keys = ['wLine','wLeft','wRight','dLine','dTop','dBottom'];
          if (keys[i]) parts[keys[i]] = child;
        });

        const linkedTexts = texts.filter((t: any) =>
          t._parentGroup &&
          Math.abs(t._parentGroup.left - group.left) < 50 &&
          Math.abs(t._parentGroup.top  - group.top)  < 50
        );
        linkedTexts.forEach((t: any) => { t._parentGroup = group; });

        parts.textElements = linkedTexts.sort((a: any, b: any) =>
          ((a._customTopOffset || 0) - (b._customTopOffset || 0)) || (a.left - b.left)
        );

        group._dimensionParts = parts;
        applyAxisColors(group, parts);
        applyGroupControls(group, group._dimMode || 'W');
        updateCombinedTextPosition(group, parts);
      });

      fCanvas.requestRenderAll();
    } finally {
      isRespondingToHistory.current = false;
    }
  };

  // ── テキスト位置・座布団同期 ──────────────────────────────────────────────

  const updateCombinedTextPosition = (target: any, parts: any) => {
    if (!parts?.textElements) return;

    const angleRad = (target.angle || 0) * (Math.PI / 180);
    const mode = target._dimMode || 'W';
    let rotatedX = target.left!;
    let rotatedY = target.top!;

    if (mode === 'W' || mode === 'W_H') {
      const base = target.height / 2;
      const [aOff, bOff, aMin, bMin] = mode === 'W' ? [20, 12, 28, 18] : [28, 18, 34, 24];
      const a = Math.max(base + aOff, aMin);
      const b = Math.max(base + bOff, bMin);
      rotatedX = target.left! + a * Math.sin(angleRad);
      rotatedY = target.top!  - b * Math.cos(angleRad);
    } else {
      const pad = 16;
      const ox =  Math.max(target.width  / 2 + pad, 45);
      const oy = -Math.max(target.height / 2 + pad, 45);
      rotatedX = target.left! + ox * Math.cos(angleRad) - oy * Math.sin(angleRad);
      rotatedY = target.top!  + ox * Math.sin(angleRad) + oy * Math.cos(angleRad);
    }

    // 行ごとの最大幅・総高さを算出
    let maxLineWidth = 0;
    let curWidth = 0;
    let totalLines = 1;
    parts.textElements.forEach((t: any) => {
      if (t._isNewLine) { maxLineWidth = Math.max(maxLineWidth, curWidth); curWidth = 0; totalLines++; }
      curWidth += (t.width || 0) + 2;
    });
    maxLineWidth = Math.max(maxLineWidth, curWidth);
    const lineHeight = 18;
    const totalH = totalLines * lineHeight;

    // テキスト要素を行ごとに配置
    let lineStart = 0;
    let lineIdx = 0;
    while (lineStart < parts.textElements.length) {
      const line: any[] = [];
      let i = lineStart;
      while (i < parts.textElements.length) {
        if (i > lineStart && parts.textElements[i]._isNewLine) break;
        line.push(parts.textElements[i]);
        i++;
      }
      lineStart = i;

      const lineY = rotatedY - totalH / 2 + lineIdx * lineHeight + lineHeight / 2;
      let cx = rotatedX - maxLineWidth / 2;
      line.forEach((t: any) => {
        const w = t.width || 0;
        t.set({ scaleX: 1, scaleY: 1, originX: 'center', originY: 'center', left: cx + w / 2, top: lineY });
        t.setCoords();
        cx += w + 2;
      });
      lineIdx++;
    }

    // 座布団 Rect の同期
    if (target.canvas?.id || target.canvas) {
      const bgRect = target.canvas?.getObjects().find(
        (o: any) => o._isTextBoxContainer && o._targetGroupId === target.id
      );
      if (bgRect) {
        bgRect.set({ left: rotatedX, top: rotatedY, width: maxLineWidth + 8, height: totalH + 6 });
        bgRect.setCoords();
        const ti = target.canvas.getObjects().indexOf(target);
        if (ti !== -1) {
          target.canvas.moveObjectTo(bgRect, ti + 1);
          parts.textElements.forEach((t: any, idx: number) =>
            target.canvas.moveObjectTo(t, ti + 2 + idx)
          );
        }
      }
    }
  };

  // ── カラーパネルのUIステート同期 ──────────────────────────────────────────

  const syncColorPanel = (group: any) => {
    if (!group || group.type !== 'group') { setColorPanel(COLOR_PANEL_RESET); return; }
    setColorPanel({
      groupId:    group.id || null,
      dimMode:    group._dimMode || null,
      colorCoded: !!group._colorCoded,
      axisColors: { ...DEFAULT_AXIS_COLORS, ...(group._axisColors || {}) },
    });
  };

  const resolveGroup = (obj: any) => obj?._parentGroup || obj;

  // ── ハイライト（座布団 Rect）─────────────────────────────────────────────

  const toggleSelectedObjectsHighlight = () => {
    if (!canvas) return;
    const actives = canvas.getActiveObjects();
    if (!actives.length) return;

    saveHistory(canvas);
    const fabricObj = (window as any).fabric;
    const next = !isSelectedHasHighlight;

    actives.forEach((obj: any) => {
      if (obj._isPropertyTitle) return;

      if (obj.type === 'i-text' && !obj._parentGroup) {
        obj.set('backgroundColor', next ? 'rgba(255, 255, 255, 0.85)' : 'transparent');
        return;
      }

      const g = resolveGroup(obj);
      if (g?.type !== 'group' || !g.id) return;

      let bgRect = canvas.getObjects().find(
        (r: any) => r._isTextBoxContainer && r._targetGroupId === g.id
      );

      if (next) {
        if (!bgRect) {
          bgRect = new fabricObj.Rect({
            selectable: false, evented: false,
            originX: 'center', originY: 'center',
            rx: 2, ry: 2, fill: 'rgba(255, 255, 255, 0.85)', objectCaching: false,
          });
          bgRect._isTextBoxContainer = true;
          bgRect._targetGroupId = g.id;
          canvas.add(bgRect);
        } else {
          bgRect.set('fill', 'rgba(255, 255, 255, 0.85)');
        }
        if (g._dimensionParts) updateCombinedTextPosition(g, g._dimensionParts);
      } else {
        if (bgRect) canvas.remove(bgRect);
      }
    });

    setIsSelectedHasHighlight(next);
    canvas.requestRenderAll();
  };

  const updateHighlightButtonState = (fCanvas: any) => {
    const active = fCanvas.getActiveObject() as any;
    if (!active || active._isPropertyTitle) { setIsSelectedHasHighlight(false); return; }

    if (active.type === 'i-text' && !active._parentGroup) {
      setIsSelectedHasHighlight(!!active.backgroundColor && active.backgroundColor !== 'transparent');
    } else {
      const g = resolveGroup(active);
      const hasBg = g?.id && !!fCanvas.getObjects().find(
        (o: any) => o._isTextBoxContainer && o._targetGroupId === g.id
      );
      setIsSelectedHasHighlight(!!hasBg);
    }
  };

  // ── 配置モード ────────────────────────────────────────────────────────────

  const handleDimModeChange = (targetMode: DimMode) => {
    if (!canvas) return;

    if (isPlacing && dimMode === targetMode) {
      // 同ボタン再押し → キャンセル
      (canvas as any)._isPlacingMode = false;
      (canvas as any)._currentDimMode = null;
      setIsPlacing(false);
      canvas.defaultCursor = 'default';
      canvas.getObjects().forEach((obj: any) => {
        if (!obj._parentGroup && !obj._isTextBoxContainer) {
          obj.selectable = true; obj.evented = true;
        }
      });
      canvas.discardActiveObject();
      canvas.renderAll();
      return;
    }

    setDimMode(targetMode);
    (canvas as any)._currentDimMode = targetMode;
    (canvas as any)._isPlacingMode = true;
    setIsPlacing(true);
    canvas.defaultCursor = 'crosshair';
    canvas.getObjects().forEach((obj: any) => { obj.selectable = false; obj.evented = false; });
    canvas.discardActiveObject();
    canvas.renderAll();
  };

  // ── 色分けトグル・軸色変更 ────────────────────────────────────────────────

  const toggleColorCoded = () => {
    if (!canvas) return;
    const g = resolveGroup(canvas.getActiveObject() as any);
    if (!g || g.type !== 'group' || !g._dimensionParts) return;

    g._colorCoded = !g._colorCoded;
    applyAxisColors(g, g._dimensionParts);
    syncColorPanel(g);
    saveHistory(canvas);
    canvas.requestRenderAll();
  };

  const handleAxisColorChange = (axis: AxisKey, newColor: string) => {
    if (!canvas) return;
    const g = resolveGroup(canvas.getActiveObject() as any);
    if (!g || g.type !== 'group' || !g._dimensionParts) return;

    if (!g._axisColors) g._axisColors = { ...DEFAULT_AXIS_COLORS };
    g._axisColors[axis] = newColor;
    applyAxisColors(g, g._dimensionParts);
    setColorPanel(prev => ({ ...prev, axisColors: { ...prev.axisColors, [axis]: newColor } }));
    saveHistory(canvas);
    canvas.requestRenderAll();
  };

  // ── 軸ラベル入れ替え ─────────────────────────────────────────────────────
  // 寸法線の矢印形状はそのままに、どの矢印にどの軸ラベル（W/D/H）と数値・色が
  // 対応するかだけを入れ替える。横矢印←→縦矢印の対応を逆にしたい時に使う。

  // W↔D 矢印線の色対応を反転する（テキスト色・_axisColors は不変）
  const swapAxes = (_axisA: AxisKey, _axisB: AxisKey) => {
    if (!canvas) return;
    const g = resolveGroup(canvas.getActiveObject() as any);
    if (!g || g.type !== 'group' || !g._dimensionParts) return;

    saveHistory(canvas);
    g._arrowFlipped = !g._arrowFlipped;
    applyAxisColors(g, g._dimensionParts);
    // パネルはテキスト色(_axisColors)を表示するため syncColorPanel はそのまま
    syncColorPanel(g);
    saveHistory(canvas);
    canvas.requestRenderAll();
  };

  // ── 全体色変更（単色モード） ──────────────────────────────────────────────

  const changeSelectedColor = (newColor: string) => {
    if (!canvas) return;

    canvas.getActiveObjects().forEach((obj: any) => {
      // グループ自身かグループの子（数値テキスト）かを解決
      const g = (obj._dimensionParts ? obj : null) ?? (obj._parentGroup || null);

      if (g?.type === 'group' && g._dimensionParts) {
        g._colorCoded = false;
        g._axisColors = { W: newColor, D: newColor, H: newColor };
        applyAxisColors(g, g._dimensionParts);
        syncColorPanel(g);
      } else if (obj.type === 'i-text') {
        obj.set('fill', newColor);
      } else if (obj.type === 'group') {
        obj.getObjects().forEach((child: any) => {
          if (child.stroke) child.set('stroke', newColor);
          if (child.fill)   child.set('fill', newColor);
        });
      }
    });

    saveHistory(canvas);
    canvas.requestRenderAll();
  };

  // ── 回転 ──────────────────────────────────────────────────────────────────

  const rotateSelected = (step: number) => {
    if (!canvas) return;
    const active = canvas.getActiveObject() as any;
    if (!active) return;
    active.set('angle', (active.angle + step) % 360);
    if (active.type === 'group' && active._dimensionParts)
      updateCombinedTextPosition(active, active._dimensionParts);
    active.setCoords();
    saveHistory(canvas);
    canvas.requestRenderAll();
  };

  // ── ID生成 ────────────────────────────────────────────────────────────────

  const genId = () => Math.random().toString(36).substring(2, 9);

  // ── 寸法グループ生成 ──────────────────────────────────────────────────────

  const createDimensionAtPosition = (fCanvas: any, x: number, y: number, mode: 'W' | 'W_D' | 'W_H' | 'W_D_H') => {
    const F = (window as any).fabric;
    const len = (mode === 'W' || mode === 'W_D' || mode === 'W_D_H') ? 80 : 150;
    const sz = 8;
    const axisColors = { ...DEFAULT_AXIS_COLORS };
    const wc = axisColors.W;
    const dc = axisColors.D;

    const wLine  = new F.Line([-len/2, 0, len/2, 0], { stroke: wc, strokeWidth: 2, originX: 'center', originY: 'center' });
    const wLeft  = new F.Triangle({ width: sz, height: sz, fill: wc, angle: -90, originX: 'center', originY: 'center', left: -len/2 });
    const wRight = new F.Triangle({ width: sz, height: sz, fill: wc, angle:  90, originX: 'center', originY: 'center', left:  len/2 });

    const groupObjs: any[] = [wLine, wLeft, wRight];
    const parts: any = { wLine, wLeft, wRight };

    if (mode === 'W_D' || mode === 'W_D_H') {
      const dLine   = new F.Line([0, -len/2, 0, len/2], { stroke: dc, strokeWidth: 2, originX: 'center', originY: 'center', height: len });
      const dTop    = new F.Triangle({ width: sz, height: sz, fill: dc, angle:   0, originX: 'center', originY: 'center', top: -len/2 });
      const dBottom = new F.Triangle({ width: sz, height: sz, fill: dc, angle: 180, originX: 'center', originY: 'center', top:  len/2 });
      groupObjs.push(dLine, dTop, dBottom);
      Object.assign(parts, { dLine, dTop, dBottom });
    }

    const group = new F.Group(groupObjs, { left: x, top: y, originX: 'center', originY: 'center', objectCaching: false });
    group.id          = genId();
    group._colorCoded = true;
    group._axisColors = axisColors;
    group._dimMode    = mode;

    // テキスト生成ヘルパー
    const makeText = (content: string, axis: AxisKey, isNum: boolean, extra: object = {}) => {
      const style = {
        ...TEXT_BASE_STYLE,
        fill: axisColors[axis],
        originX: 'center', originY: 'center',
        objectCaching: false, noScaleCache: true,
        backgroundColor: 'transparent',
        ...(isNum
          ? { selectable: true, evented: true, hasControls: false, hasBorders: true,
              lockMovementX: true, lockMovementY: true, lockRotation: true, borderColor: '#3b82f6' }
          : { selectable: false, evented: false, hasControls: false, hasBorders: false }
        ),
        ...extra,
      };
      const t = new F.IText(content, style);
      t._axisLabel    = axis;
      t._parentGroup  = group;
      return t;
    };

    const textElements: any[] = [];
    const numMap: any = {};

    const addAxis = (axis: AxisKey, offset: number) => {
      const lbl = makeText(`${axis}: `, axis, false, offset ? { _isNewLine: true, _customTopOffset: offset } : {});
      const num = makeText('00', axis, true,  offset ? { _customTopOffset: offset } : {});
      if (offset) { lbl._isNewLine = true; lbl._customTopOffset = offset; num._customTopOffset = offset; }
      textElements.push(lbl, num);
      numMap[`num${axis}`] = num;
    };

    addAxis('W', 0);
    if (mode === 'W_D' || mode === 'W_D_H') addAxis('D', 18);
    if (mode === 'W_H' || mode === 'W_D_H') addAxis('H', mode === 'W_D_H' ? 36 : 18);

    parts.textElements = textElements;
    group._dimensionParts = parts;

    fCanvas.add(group);
    textElements.forEach((t: any) => fCanvas.add(t));
    updateCombinedTextPosition(group, parts);

    // 入力シーケンス設定
    const numSeq: any[] = [numMap.numW, numMap.numD, numMap.numH].filter(Boolean);
    numSeq.forEach((num, idx) => {
      const next = numSeq[idx + 1] ?? null;

      num.on('changed', () => {
        num.text = num.text.replace(/[^0-9\n]/g, '');
        updateCombinedTextPosition(group, parts);
        fCanvas.requestRenderAll();
      });

      num.onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          if (e.shiftKey) { num.insertChars('\n'); num.canvas?.requestRenderAll(); updateCombinedTextPosition(group, parts); }
          else { e.preventDefault(); num.exitEditing(); }
          return;
        }
        F.IText.prototype.onKeyDown.call(num, e);
        setTimeout(() => updateCombinedTextPosition(group, parts), 10);
      };

      num.on('editing:entered', () => {
        group.selectable = false;
        parts.textElements.forEach((t: any) => { if (t !== num) { t.selectable = false; t.evented = false; } });
      });

      num.on('editing:exited', () => {
        group.selectable = true;
        num.text = num.text.trim() || '00';
        num.setCoords();
        updateCombinedTextPosition(group, parts);
        saveHistory(fCanvas);
        fCanvas.requestRenderAll();
        if (next) {
          setTimeout(() => {
            next.selectable = true; next.evented = true;
            fCanvas.setActiveObject(next); next.enterEditing(); next.selectAll(); fCanvas.requestRenderAll();
          }, 50);
        } else {
          parts.textElements.forEach((t: any) => { if (t._axisLabel) { t.evented = true; t.selectable = true; } });
          group.setCoords(); fCanvas.setActiveObject(group); fCanvas.requestRenderAll();
        }
      });
    });

    applyGroupControls(group, mode);

    setTimeout(() => {
      if (numMap.numW) {
        fCanvas.setActiveObject(numMap.numW);
        numMap.numW.enterEditing(); numMap.numW.selectAll(); fCanvas.requestRenderAll();
      }
    }, 100);

    fCanvas.requestRenderAll();
  };

  // ── テキストボックス単体生成 ─────────────────────────────────────────────

  const createTextBoxOnly = (fCanvas: any, x: number, y: number) => {
    const F = (window as any).fabric;
    const t = new F.IText('テキスト入力', {
      left: x, top: y, ...TEXT_BASE_STYLE,
      fill: DEFAULT_AXIS_COLORS.W, backgroundColor: 'transparent',
      padding: 4, originX: 'center', originY: 'center',
      hasControls: true, hasBorders: true, borderColor: '#3b82f6',
      lockUniScaling: true, noScaleCache: true,
    });
    t.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false, bl: true, br: true, tl: true, tr: true, mtr: true });
    t.onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) { t.insertChars('\n'); t.canvas?.requestRenderAll(); }
        else { e.preventDefault(); t.exitEditing(); }
        return;
      }
      F.IText.prototype.onKeyDown.call(t, e);
    };
    t.on('editing:exited', () => {
      if (!t.text.trim()) t.text = 'テキスト入力';
      saveHistory(fCanvas); fCanvas.requestRenderAll();
    });
    fCanvas.add(t); fCanvas.setActiveObject(t); t.enterEditing(); t.selectAll(); fCanvas.requestRenderAll();
  };

  // ── 片方矢印生成 ─────────────────────────────────────────────────────────

  const createSingleArrow = (fCanvas: any, x: number, y: number) => {
    const F = (window as any).fabric;
    const len = 80; const sz = 8; const c = DEFAULT_AXIS_COLORS.W;
    const wLine  = new F.Line([-len/2, 0, len/2, 0], { stroke: c, strokeWidth: 2, originX: 'center', originY: 'center' });
    const wLeft  = new F.Triangle({ width: sz, height: sz, fill: c, angle: -90, originX: 'center', originY: 'center', left: -len/2, opacity: 0, selectable: false, evented: false });
    const wRight = new F.Triangle({ width: sz, height: sz, fill: c, angle:  90, originX: 'center', originY: 'center', left:  len/2 });
    const parts = { wLine, wLeft, wRight };
    const group = new F.Group([wLine, wLeft, wRight], { left: x, top: y, originX: 'center', originY: 'center', objectCaching: false });
    group.id = genId();
    group._dimensionParts = parts;
    group._dimMode = 'W';
    applyGroupControls(group, 'W');
    group.on('modified', () => saveHistory(fCanvas));
    fCanvas.add(group); fCanvas.setActiveObject(group); fCanvas.requestRenderAll();
  };

  // ── 画像アップロード ─────────────────────────────────────────────────────

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canvas) return;
    const baseName = file.name.replace(/\.[^/.]+$/, '') || '【ここに物件名を入力】';
    const F = (window as any).fabric;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      // 既存の物件名・座布団を削除
      canvas.getObjects().filter((o: any) => o._isPropertyTitle || o._isTextBoxContainer).forEach((o: any) => canvas.remove(o));

      const img = await F.FabricImage.fromURL(ev.target?.result as string);
      const scale = Math.min(canvas.width! / img.width!, canvas.height! / img.height!);
      img.scale(scale < 1 ? scale : 1);
      img.set({ left: canvas.width! / 2, top: canvas.height! / 2, originX: 'center', originY: 'center' });
      canvas.backgroundImage = img;
      undoStack.current = []; redoStack.current = [];

      const title = new F.IText(baseName, {
        fontSize: 14, fontWeight: '500', fontFamily: FONT_FAMILY,
        fill: '#1f2937', backgroundColor: 'rgba(255, 255, 255, 0.9)',
        padding: 6, originX: 'right', originY: 'bottom',
        left: canvas.width! - 20, top: canvas.height! - 20,
        hasControls: false, hasBorders: true, borderColor: '#3b82f6', cornerSize: 0,
      });
      title._isPropertyTitle = true;
      title.onKeyDown = (ev2: KeyboardEvent) => {
        if (ev2.key === 'Enter') {
          if (ev2.shiftKey) { title.insertChars('\n'); title.canvas?.requestRenderAll(); }
          else { ev2.preventDefault(); title.exitEditing(); }
          return;
        }
        F.IText.prototype.onKeyDown.call(title, ev2);
      };

      // オブジェクトの選択可否を整理
      const LABEL_TEXTS = new Set(['W: ', 'D: ', 'H: ', ' / ']);
      canvas.getObjects().forEach((obj: any) => {
        if (obj._parentGroup) return;
        if (obj._isTextBoxContainer) { obj.selectable = false; obj.evented = false; return; }
        const isLabel = obj.type === 'i-text' && LABEL_TEXTS.has(obj.text);
        obj.selectable = !isLabel;
        obj.evented    = !isLabel;
      });

      canvas.add(title);
      canvas.getObjects().filter((o: any) => o.type === 'group' && o._dimensionParts)
            .forEach((o: any) => updateCombinedTextPosition(o, o._dimensionParts));

      saveHistory(canvas);
      canvas.discardActiveObject(); canvas.setActiveObject(title); canvas.renderAll();
    };
    reader.readAsDataURL(file);
  };

  // ── 保存 ─────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!canvas) return;
    const titleObj = canvas.getObjects().find((o: any) => o._isPropertyTitle) as any;
    if (titleObj?.isEditing) { titleObj.exitEditing(); canvas.requestRenderAll(); }
    const rawName = titleObj?.text?.trim() ?? '';
    const name = rawName && rawName !== '【ここに物件名を入力】' ? `寸法_${rawName}.jpg` : '寸法.jpg';
    const dataURL = canvas.toDataURL({ format: 'jpeg', quality: 0.8, multiplier: 1 });
    const blob = await fetch(dataURL).then(r => r.blob());
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({ suggestedName: name, types: [{ description: 'JPEG Image', accept: { 'image/jpeg': ['.jpg'] } }] });
        const w = await handle.createWritable(); await w.write(blob); await w.close();
        return;
      } catch { return; }
    }
    const a = document.createElement('a'); a.download = name; a.href = dataURL; a.click();
  };

  // ── グループのペースト後イベント設定（create/pasteで共通） ───────────────

  const setupNumTextEvents = (num: any, next: any, group: any, parts: any, fCanvas: any) => {
    const F = (window as any).fabric;
    num.on('changed', () => {
      num.text = num.text.replace(/[^0-9\n]/g, '');
      updateCombinedTextPosition(group, parts); fCanvas.requestRenderAll();
    });
    num.onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) { num.insertChars('\n'); num.canvas?.requestRenderAll(); updateCombinedTextPosition(group, parts); }
        else { e.preventDefault(); num.exitEditing(); }
        return;
      }
      F.IText.prototype.onKeyDown.call(num, e);
      setTimeout(() => updateCombinedTextPosition(group, parts), 10);
    };
    num.on('editing:entered', () => {
      group.selectable = false;
      parts.textElements.forEach((t: any) => { if (t !== num) { t.selectable = false; t.evented = false; } });
    });
    num.on('editing:exited', () => {
      group.selectable = true;
      num.text = num.text.trim() || '00';
      num.setCoords(); updateCombinedTextPosition(group, parts); saveHistory(fCanvas); fCanvas.requestRenderAll();
      if (next) {
        setTimeout(() => { next.selectable = true; next.evented = true; fCanvas.setActiveObject(next); next.enterEditing(); next.selectAll(); fCanvas.requestRenderAll(); }, 50);
      } else {
        parts.textElements.forEach((t: any) => { if (t._axisLabel) { t.evented = true; t.selectable = true; } });
        group.setCoords(); fCanvas.setActiveObject(group); fCanvas.requestRenderAll();
      }
    });
  };

  // ── Fabric.js CDN ロード ──────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ((window as any).fabric) { setFabricLoaded(true); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/fabric@6.0.2/dist/index.min.js';
    s.async = true;
    s.onload = () => setFabricLoaded(true);
    document.body.appendChild(s);
  }, []);

  // ── キャンバス初期化 ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!fabricLoaded || !canvasRef.current) return;
    const F = (window as any).fabric;

    const fc = new F.Canvas(canvasRef.current, {
      width: 800, height: 600, backgroundColor: '#f3f4f6', centeredScaling: true,
    });

    fc.on('object:modified', () => saveHistory(fc));

    const onSelect = () => {
      updateHighlightButtonState(fc);
      const active = fc.getActiveObject() as any;
      syncColorPanel(resolveGroup(active)?.type === 'group' ? resolveGroup(active) : null);
    };
    fc.on('selection:created', onSelect);
    fc.on('selection:updated', onSelect);
    fc.on('selection:cleared', () => { setIsSelectedHasHighlight(false); setColorPanel(COLOR_PANEL_RESET); });

    fc.on('object:moving', ({ target }: any) => {
      if (target?.type === 'group') updateCombinedTextPosition(target, target._dimensionParts);
      fc.requestRenderAll();
    });

    fc.on('object:scaling', ({ target }: any) => {
      if (!target || target.type !== 'group') return;
      const parts = target._dimensionParts;
      if (!parts) return;
      const sX = target.scaleX || 1;
      const sY = target.scaleY || 1;
      const gW = target.width * sX;
      const gH = target.height * sY;
      if (parts.wLine && sX !== 1) {
        parts.wLine.set({ width: gW });
        parts.wLeft.set({ left: -gW/2, scaleX: 1, scaleY: 1 });
        parts.wRight.set({ left: gW/2, scaleX: 1, scaleY: 1 });
        [parts.wLine, parts.wLeft, parts.wRight].forEach((p: any) => p.setCoords());
      }
      if (parts.dLine && sY !== 1) {
        parts.dLine.set({ height: gH });
        parts.dTop.set({ top: -gH/2, scaleX: 1, scaleY: 1 });
        parts.dBottom.set({ top: gH/2, scaleX: 1, scaleY: 1 });
        [parts.dLine, parts.dTop, parts.dBottom].forEach((p: any) => p.setCoords());
      }
      target.set({ width: gW, height: gH, scaleX: 1, scaleY: 1 });
      parts.textElements?.forEach((t: any) => t.set({ scaleX: 1, scaleY: 1 }));
      updateCombinedTextPosition(target, parts);
      target.setCoords(); fc.requestRenderAll();
    });

    fc.on('object:rotating', ({ target, e }: any) => {
      if (!target || target.type !== 'group') return;
      if ((e as MouseEvent)?.shiftKey) {
        target.set('angle', Math.round((target.angle || 0) / 15) * 15);
      }
      if (target._dimensionParts) updateCombinedTextPosition(target, target._dimensionParts);
      fc.requestRenderAll();
    });

    fc.on('mouse:dblclick', ({ target }: any) => {
      if (target?.type === 'i-text' && target._parentGroup) {
        fc.setActiveObject(target); target.enterEditing(); target.selectAll(); fc.requestRenderAll();
      }
    });

    fc.on('object:removed', ({ target }: any) => {
      if (!target?.id) return;
      const rect = fc.getObjects().find((o: any) => o._isTextBoxContainer && o._targetGroupId === target.id);
      if (rect) fc.remove(rect);
    });

    fc.on('mouse:down', (options: any) => {
      if (!(fc as any)._isPlacingMode) return;
      const ptr = fc.getScenePoint(options.e);
      if (!ptr) return;

      saveHistory(fc);
      const mode = (fc as any)._currentDimMode as DimMode || 'W';
      if (mode === 'TEXT_ONLY') createTextBoxOnly(fc, ptr.x, ptr.y);
      else if (mode === 'ARROW_ONLY') createSingleArrow(fc, ptr.x, ptr.y);
      else createDimensionAtPosition(fc, ptr.x, ptr.y, mode as any);

      (fc as any)._isPlacingMode = false;
      setIsPlacing(false);
      fc.defaultCursor = 'default';

      setTimeout(() => {
        const activeObj = fc.getActiveObject();
        fc.getObjects().forEach((obj: any) => {
          if (!obj._parentGroup && obj !== activeObj && !obj._isTextBoxContainer) {
            obj.selectable = true; obj.evented = true;
          }
        });
        saveHistory(fc); fc.renderAll();
      }, 10);
    });

    // キーボード操作
    const el = fc.getSelectionElement();
    if (el) {
      el.tabIndex = 1000;
      el.style.outline = 'none';

      el.addEventListener('keydown', (e: KeyboardEvent) => {
        const key = e.key.toLowerCase();
        const active = fc.getActiveObject() as any;
        if (active?.isEditing) return;

        const isCtrl = e.ctrlKey || e.metaKey;

        // Undo
        if (isCtrl && key === 'z') {
          e.preventDefault();
          if (!undoStack.current.length) return;
          redoStack.current.push(JSON.stringify(fc.toObject(SERIALIZE_PROPERTIES)));
          loadHistoryState(fc, undoStack.current.pop()!);
          return;
        }
        // Redo
        if (isCtrl && key === 'y') {
          e.preventDefault();
          if (!redoStack.current.length) return;
          undoStack.current.push(JSON.stringify(fc.toObject(SERIALIZE_PROPERTIES)));
          loadHistoryState(fc, redoStack.current.pop()!);
          return;
        }
        // Copy
        if (isCtrl && key === 'c') {
          if (!active) return;
          const target = resolveGroup(active);
          if (target.type === 'group') {
            e.preventDefault();
            copiedJsonRef.current = JSON.stringify({
              isGroup: true,
              group: target.toObject(SERIALIZE_PROPERTIES),
              texts: target._dimensionParts.textElements.map((t: any) => t.toObject(SERIALIZE_PROPERTIES)),
              dimMode: target._dimMode,
              hasHighlight: !!fc.getObjects().find((o: any) => o._isTextBoxContainer && o._targetGroupId === target.id),
            });
          } else if (target.type === 'i-text' && !target._isPropertyTitle) {
            e.preventDefault();
            copiedJsonRef.current = JSON.stringify({ isGroup: false, textData: target.toObject(SERIALIZE_PROPERTIES) });
          }
          return;
        }
        // Paste
        if (isCtrl && key === 'v') {
          if (!copiedJsonRef.current) return;
          e.preventDefault();
          saveHistory(fc);
          const clip = JSON.parse(copiedJsonRef.current);

          if (!clip.isGroup) {
            (async () => {
              const t = await F.IText.fromObject(clip.textData) as any;
              t.set({ left: (clip.textData.left || 0) + 20, top: (clip.textData.top || 0) + 20, selectable: true, evented: true, lockUniScaling: true });
              t.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false, bl: true, br: true, tl: true, tr: true, mtr: true });
              t.onKeyDown = (ev: KeyboardEvent) => {
                if (ev.key === 'Enter') {
                  if (ev.shiftKey) { t.insertChars('\n'); t.canvas?.requestRenderAll(); }
                  else { ev.preventDefault(); t.exitEditing(); }
                  return;
                }
                F.IText.prototype.onKeyDown.call(t, ev);
              };
              t.on('editing:exited', () => { if (!t.text.trim()) t.text = 'テキスト入力'; saveHistory(fc); fc.requestRenderAll(); });
              fc.add(t); fc.discardActiveObject(); fc.setActiveObject(t); t.setCoords(); saveHistory(fc); fc.requestRenderAll();
            })();
            return;
          }

          (async () => {
            const clonedGroup = await F.Group.fromObject(clip.group);
            clonedGroup.set({ left: (clip.group.left || 0) + 20, top: (clip.group.top || 0) + 20, selectable: true, evented: true, objectCaching: false });
            clonedGroup.id          = genId();
            clonedGroup._colorCoded = clip.group._colorCoded;
            clonedGroup._axisColors = clip.group._axisColors ? { ...clip.group._axisColors } : { ...DEFAULT_AXIS_COLORS };
            clonedGroup._dimMode    = clip.dimMode;

            const clonedParts: any = {};
            const partKeys = ['wLine','wLeft','wRight','dLine','dTop','dBottom'];
            clonedGroup.getObjects().forEach((o: any, i: number) => { if (partKeys[i]) clonedParts[partKeys[i]] = o; });

            const newTexts: any[] = [];
            const LABELS = new Set(['W: ', 'D: ', 'H: ', ' / ']);
            for (const td of clip.texts) {
              const ct = await F.IText.fromObject(td) as any;
              const isNum = !LABELS.has(td.text);
              ct.set({
                originX: 'left', originY: 'center',
                hasControls: !isNum, hasBorders: true, objectCaching: false,
                selectable: true, evented: isNum,
                lockMovementX: isNum, lockMovementY: isNum, lockRotation: isNum,
                lockUniScaling: true, borderColor: '#3b82f6',
              });
              if (!isNum) ct.setControlsVisibility({ mt:false,mb:false,ml:false,mr:false,bl:false,br:false,tl:false,tr:false,mtr:false });
              ct._parentGroup     = clonedGroup;
              ct._isNewLine       = td._isNewLine;
              ct._customTopOffset = td._customTopOffset;
              ct._axisLabel       = td._axisLabel;
              newTexts.push(ct);
            }

            clonedParts.textElements = newTexts;
            clonedGroup._dimensionParts = clonedParts;
            applyGroupControls(clonedGroup, clip.dimMode);
            fc.add(clonedGroup);
            newTexts.forEach((t: any) => fc.add(t));
            applyAxisColors(clonedGroup, clonedParts);

            if (clip.hasHighlight) {
              const bg = new F.Rect({ selectable: false, evented: false, originX: 'center', originY: 'center', rx: 2, ry: 2, fill: 'rgba(255,255,255,0.85)', objectCaching: false });
              bg._isTextBoxContainer = true; bg._targetGroupId = clonedGroup.id;
              fc.add(bg);
            }

            updateCombinedTextPosition(clonedGroup, clonedParts);

            // 数値テキストにイベントを付与
            const numTexts = newTexts.filter((t: any) => t.evented);
            numTexts.forEach((num: any, idx: number) => {
              setupNumTextEvents(num, numTexts[idx + 1] ?? null, clonedGroup, clonedParts, fc);
            });

            fc.discardActiveObject(); fc.setActiveObject(clonedGroup);
            clonedGroup.setCoords(); saveHistory(fc); fc.requestRenderAll();
          })();
          return;
        }

        // Delete / Backspace
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          const actives = fc.getActiveObjects();
          if (!actives.length) return;
          saveHistory(fc);
          actives.forEach((obj: any) => {
            const g = obj._dimensionParts ? obj : obj._parentGroup;
            if (g?._dimensionParts?.textElements) g._dimensionParts.textElements.forEach((t: any) => fc.remove(t));
            if (obj._parentGroup) fc.remove(obj._parentGroup);
            fc.remove(obj);
          });
          fc.discardActiveObject(); saveHistory(fc); fc.requestRenderAll();
          return;
        }

        // 矢印キー移動
        if (['arrowup','arrowdown','arrowleft','arrowright'].includes(key)) {
          if (!active) return;
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          saveHistory(fc);
          if (key === 'arrowup')    active.set('top',  active.top!  - step);
          if (key === 'arrowdown')  active.set('top',  active.top!  + step);
          if (key === 'arrowleft')  active.set('left', active.left! - step);
          if (key === 'arrowright') active.set('left', active.left! + step);
          if (active.type === 'group' && active._dimensionParts)
            updateCombinedTextPosition(active, active._dimensionParts);
          active.setCoords(); fc.requestRenderAll();
        }
      });
    }

    setCanvas(fc);
    return () => fc.dispose();
  }, [fabricLoaded]);

  // ── レンダリング ──────────────────────────────────────────────────────────

  const showColorPanel = !!colorPanel.groupId;
  const hasDAxis = colorPanel.dimMode === 'W_D' || colorPanel.dimMode === 'W_D_H';
  const hasHAxis = colorPanel.dimMode === 'W_H' || colorPanel.dimMode === 'W_D_H';

  const modeLabel: Record<string, string> = {
    W: '↔ W', W_D: '✛ W×D', W_H: '↔ W×H', W_D_H: '✛ W×D×H', TEXT_ONLY: 'テキスト', ARROW_ONLY: '➔',
  };

  const modeBtnCls = (m: DimMode) =>
    `px-3 py-1.5 rounded-md transition ${
      dimMode === m && isPlacing ? 'bg-amber-500 text-white animate-pulse' :
      dimMode === m             ? 'bg-white shadow-sm text-gray-900'       :
                                  'text-gray-500 hover:text-gray-900'
    }`;

  if (!fabricLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-gray-500">エディタを読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    // 画面全体を h-screen で固定し、ページスクロールを発生させない
    <div className="flex flex-col h-screen overflow-hidden bg-gray-50 font-sans">

      {/* ヘッダー（固定高さ） */}
      <div className="flex-none flex flex-col gap-1 px-4 pt-3 pb-2 bg-gray-50 border-b border-gray-200">

        {/* メインツールバー */}
        <div className="flex flex-wrap gap-3 items-center bg-white px-3 py-2 rounded-xl shadow-sm border border-gray-100">
          <input type="file" accept="image/*" onChange={handleImageUpload}
            className="text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
          />
          <div className="h-7 w-px bg-gray-200" />

          {/* 配置モード */}
          <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200 text-sm font-medium">
            {(['W','W_D','W_H','W_D_H','TEXT_ONLY','ARROW_ONLY'] as DimMode[]).map(m => (
              <button key={m} onClick={() => handleDimModeChange(m)} className={modeBtnCls(m)}>
                {modeLabel[m]}
              </button>
            ))}
          </div>

          {/* 回転 */}
          <div className="flex gap-0.5 bg-gray-100 p-0.5 rounded-lg">
            <button onClick={() => rotateSelected(-90)} className="p-1.5 hover:bg-white rounded-md transition shadow-sm" title="左90度回転">↺</button>
            <button onClick={() => rotateSelected( 90)} className="p-1.5 hover:bg-white rounded-md transition shadow-sm" title="右90度回転">↻</button>
          </div>

          {/* ハイライト */}
          <button onClick={toggleSelectedObjectsHighlight}
            className={`px-3 py-1.5 rounded-lg transition font-medium shadow-sm text-sm border ${
              isSelectedHasHighlight ? 'bg-blue-600 text-white border-blue-700 hover:bg-blue-700'
                                     : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
            title="選択したテキストの背景白を切り替えます"
          >
            ハイライト
          </button>

          {/* 単色パレット */}
          <div className="flex items-center gap-1.5 bg-gray-100 p-0.5 rounded-lg">
            <span className="text-xs text-gray-500 pl-1">単色</span>
            {(['#ef4444','#3b82f6','#22c55e','#000000'] as const).map(c => (
              <button key={c} onClick={() => changeSelectedColor(c)}
                className="w-7 h-7 rounded-md border border-gray-200 shadow-sm transition hover:scale-105"
                style={{ backgroundColor: c }} title="全体をこの色に変更（色分けOFF）"
              />
            ))}
          </div>

          <button onClick={handleSave} className="px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-black transition font-medium text-sm ml-auto">
            保存 (JPEG)
          </button>
        </div>

        {/* 軸別色分けパネル（常時レンダリング・非選択時は invisible で高さを保持しレイアウトを固定） */}
        <div className={`flex flex-wrap items-center gap-3 bg-white px-3 py-2 rounded-xl shadow-sm border border-gray-100 ${showColorPanel ? 'visible' : 'invisible'}`}>
          <button onClick={toggleColorCoded}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium border transition ${
              colorPanel.colorCoded ? 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700'
                                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            🎨 色分け{colorPanel.colorCoded ? 'ON' : 'OFF'}
          </button>

          <div className="h-5 w-px bg-gray-200" />

          {(['W', ...(hasDAxis ? ['D'] : []), ...(hasHAxis ? ['H'] : [])] as AxisKey[]).map(axis => (
            <div key={axis} className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-gray-600 w-4">{axis}</span>
              {(['#ef4444','#3b82f6','#22c55e','#000000'] as const).map(c => (
                <button key={c} onClick={() => colorPanel.colorCoded && handleAxisColorChange(axis, c)}
                  className={`w-6 h-6 rounded-md border-2 transition hover:scale-110 ${
                    colorPanel.axisColors[axis] === c ? 'border-gray-700 scale-110' : 'border-transparent'
                  } ${!colorPanel.colorCoded ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                  style={{ backgroundColor: c }}
                  title={`${axis}軸をこの色に`}
                />
              ))}
            </div>
          ))}

          <span className="text-xs text-gray-400">
            {colorPanel.colorCoded ? '各軸を個別の色で表示' : '「単色」パレットで全体色を変更できます'}
          </span>

          {/* 軸入れ替えボタン（複数軸モード時のみ表示） */}
          {(hasDAxis || hasHAxis) && (
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-xs text-gray-400">入替</span>
              {hasDAxis && (
                <button onClick={() => swapAxes('W', 'D')}
                  className="px-2 py-1 text-xs font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50 transition"
                  title="横矢印(W)と縦矢印(D)のラベル・数値・色を入れ替えます"
                >W↔D</button>
              )}
              {hasHAxis && hasDAxis && (
                <button onClick={() => swapAxes('D', 'H')}
                  className="px-2 py-1 text-xs font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50 transition"
                  title="D と H のラベル・数値・色を入れ替えます"
                >D↔H</button>
              )}
              {hasHAxis && (
                <button onClick={() => swapAxes('W', 'H')}
                  className="px-2 py-1 text-xs font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50 transition"
                  title="横矢印(W)と H のラベル・数値・色を入れ替えます"
                >W↔H</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* キャンバスエリア（残りの高さをすべて使い、内側のみスクロール） */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        <div className="border-4 border-white shadow-2xl rounded-lg overflow-hidden bg-white flex-none">
          <canvas ref={canvasRef} />
        </div>
      </div>
    </div>
  );
}
