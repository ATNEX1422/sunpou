"use client";

import React, { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';

const FloorPlanEditor = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
  const [isPlacing, setIsPlacing] = useState<boolean>(false);
  const [dimMode, setDimMode] = useState<'W' | 'W_D' | 'W_H' | 'W_D_H'>('W');

  // ★共通ヘルパー：【左揃えベース】で文字数に応じて右側へ美しく自動整列させるロジック
  const updateCombinedTextPosition = (target: fabric.Group, parts: any) => {
    if (!parts || !parts.textElements) return;

    const angleRad = (target.angle || 0) * (Math.PI / 180);
    
    // 寸法線の右上45度のデフォルト位置を計算
    const offsetX = (target.width / 2) + 12;
    const offsetY = -((target.height / 2) + 12);

    // 寸法線の中心からの絶対座標を割り出す
    const rotatedX = target.left! + (offsetX * Math.cos(angleRad) - offsetY * Math.sin(angleRad));
    const rotatedY = target.top! + (offsetX * Math.sin(angleRad) + offsetY * Math.cos(angleRad));

    let currentLeft = rotatedX;
    const padding = 2; // 文字同士のスキマ

    parts.textElements.forEach((textObj: fabric.Object) => {
      if ((textObj as any)._isNewLine) {
        currentLeft = rotatedX;
      }

      textObj.set({
        scaleX: 1,
        scaleY: 1,
        left: currentLeft,
        top: rotatedY + ((textObj as any)._customTopOffset || 0)
      });
      textObj.setCoords();

      currentLeft += (textObj.width || 0) + padding;
    });
  };

  useEffect(() => {
    if (!canvasRef.current) return;

    const fabricCanvas = new fabric.Canvas(canvasRef.current, {
      width: 800,
      height: 600,
      backgroundColor: '#f3f4f6',
      centeredScaling: true,
    });

    // 1. 移動時の追従
    fabricCanvas.on('object:moving', (options: any) => {
      const target = options.target;
      if (!target) return;

      if (target instanceof fabric.Group) {
        updateCombinedTextPosition(target, (target as any)._dimensionParts);
      }
      fabricCanvas.requestRenderAll();
    });

    // 2. 伸縮時の追従
    fabricCanvas.on('object:scaling', (options: any) => {
      const target = options.target;
      if (!target || !(target instanceof fabric.Group)) return;

      const parts = (target as any)._dimensionParts;
      if (!parts) return;

      const sX = target.scaleX || 1;
      const sY = target.scaleY || 1;
      const currentGroupWidth = target.width * sX;
      const currentGroupHeight = target.height * sY;

      if (parts.wLine && sX !== 1) {
        const newWidth = currentGroupWidth;
        parts.wLine.set({ width: newWidth });
        const halfWidth = newWidth / 2;
        parts.wLeft.set({ left: -halfWidth, scaleX: 1, scaleY: 1 });
        parts.wRight.set({ left: halfWidth, scaleX: 1, scaleY: 1 });
        parts.wLine.setCoords(); parts.wLeft.setCoords(); parts.wRight.setCoords();
      }

      if (parts.dLine && sY !== 1) {
        const newHeight = currentGroupHeight;
        parts.dLine.set({ height: newHeight });
        const halfHeight = newHeight / 2;
        parts.dTop.set({ top: -halfHeight, scaleX: 1, scaleY: 1 });
        parts.dBottom.set({ top: halfHeight, scaleX: 1, scaleY: 1 });
        parts.dLine.setCoords(); parts.dTop.setCoords(); parts.dBottom.setCoords();
      }

      target.set({ width: currentGroupWidth, height: currentGroupHeight, scaleX: 1, scaleY: 1 });
      
      updateCombinedTextPosition(target, parts);
      target.setCoords();
      fabricCanvas.requestRenderAll();
    });

    // 3. 回転時の制御
    fabricCanvas.on('object:rotating', (options: any) => {
      const target = options.target;
      if (!target || !(target instanceof fabric.Group)) return;

      const rawEvent = options.e as MouseEvent;
      if (rawEvent && rawEvent.shiftKey) {
        const snapAngle = 15;
        const currentAngle = target.angle || 0;
        target.set('angle', Math.round(currentAngle / snapAngle) * snapAngle);
      }

      const parts = (target as any)._dimensionParts;
      if (parts) {
        updateCombinedTextPosition(target, parts);
      }

      fabricCanvas.requestRenderAll();
    });

    // 4. ★核心：Fabric.js v6 のイベント透過をバイパスして、数字のダブルクリック再編集を強制起動する処理
    fabricCanvas.on('mouse:dblclick', (options) => {
      const target = options.target;
      if (!target) return;

      // ダブルクリックされたのが「数字（ITextかつ親グループを持つ）」だった場合
      if (target instanceof fabric.IText && (target as any)._parentGroup) {
        // キャンバスの最前面に一時的に引っ張り上げてフォーカスを叩き込む
        fabricCanvas.setActiveObject(target);
        target.enterEditing();
        target.selectAll();
        fabricCanvas.requestRenderAll();
      }
    });

    setCanvas(fabricCanvas);

    // 配置トリガー
    fabricCanvas.on('mouse:down', (options) => {
      if (!(fabricCanvas as any)._isPlacingMode) return;

      const pointer = fabricCanvas.getScenePoint(options.e);
      if (pointer) {
        const currentMode = (fabricCanvas as any)._currentDimMode || 'W';
        
        createDimensionAtPosition(fabricCanvas, pointer.x, pointer.y, '#ef4444', currentMode);

        (fabricCanvas as any)._isPlacingMode = false;
        setIsPlacing(false);
        fabricCanvas.defaultCursor = 'default';
        
        setTimeout(() => {
          fabricCanvas.getObjects().forEach(obj => {
            // 寸法線本体（矢印）グループのみを選択可能にする
            if (!(obj as any)._parentGroup) {
              obj.selectable = true;
              obj.evented = true;
            }
          });
          fabricCanvas.renderAll();
        }, 10);
      }
    });    

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      fabricCanvas.dispose();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (active && (active as any).isEditing) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      const activeObjects = canvas.getActiveObjects();
      activeObjects.forEach(obj => {
        if (obj && (obj as any)._dimensionParts && (obj as any)._dimensionParts.textElements) {
          (obj as any)._dimensionParts.textElements.forEach((t: any) => canvas.remove(t));
        }
        if (obj && (obj as any)._parentGroup) {
          const parent = (obj as any)._parentGroup;
          if (parent._dimensionParts && parent._dimensionParts.textElements) {
            parent._dimensionParts.textElements.forEach((t: any) => canvas.remove(t));
          }
          canvas.remove(parent);
        }
        canvas.remove(obj);
      });
      canvas.discardActiveObject();
      canvas.renderAll();
    }
  };

  // --- 次元（寸法線）生成ロジック ---
  const createDimensionAtPosition = (
    fCanvas: fabric.Canvas, 
    x: number, 
    y: number, 
    color: string = '#ef4444', 
    currentMode: 'W' | 'W_D' | 'W_H' | 'W_D_H' = 'W'
  ) => {    
    const dimMode = currentMode;
    const length = (dimMode === 'W' || dimMode === 'W_D' || dimMode === 'W_D_H') ? 80 : 150;
    const arrowSize = 8;
    const objectsToGroup: fabric.Object[] = [];
    const dimensionParts: any = {};

    // --- 1. 線と矢印のベース生成 ---
    const wLine = new fabric.Line([-length / 2, 0, length / 2, 0], {
      stroke: color, strokeWidth: 2, originX: 'center', originY: 'center',
    });
    const wLeft = new fabric.Triangle({
      width: arrowSize, height: arrowSize, fill: color, angle: -90, originX: 'center', originY: 'center', left: -length / 2
    });
    const wRight = new fabric.Triangle({
      width: arrowSize, height: arrowSize, fill: color, angle: 90, originX: 'center', originY: 'center', left: length / 2
    });

    objectsToGroup.push(wLine, wLeft, wRight);
    dimensionParts.wLine = wLine;
    dimensionParts.wLeft = wLeft;
    dimensionParts.wRight = wRight;

    if (dimMode === 'W_D' || dimMode === 'W_D_H') {
      const dLine = new fabric.Line([0, -length / 2, 0, length / 2], {
        stroke: color, strokeWidth: 2, originX: 'center', originY: 'center', height: length
      });
      const dTop = new fabric.Triangle({
        width: arrowSize, height: arrowSize, fill: color, angle: 0, originX: 'center', originY: 'center', top: -length / 2
      });
      const dBottom = new fabric.Triangle({
        width: arrowSize, height: arrowSize, fill: color, angle: 180, originX: 'center', originY: 'center', top: length / 2
      });

      objectsToGroup.push(dLine, dTop, dBottom);
      dimensionParts.dLine = dLine;
      dimensionParts.dTop = dTop;
      dimensionParts.dBottom = dBottom;
    }

    const group = new fabric.Group(objectsToGroup, {
      left: x, top: y, originX: 'center', originY: 'center', objectCaching: false,
    });

    // --- 2. 各テキストパーツの生成 ---
    const textElements: fabric.Object[] = [];
    const textGroupParts: any = {};

    // 左揃えベースの基本スタイル
    const baseStyle = { 
      fontSize: 12, fontWeight: 'bold' as const, fill: color, 
      originX: 'left' as const, originY: 'center' as const,
      hasControls: false, hasBorders: false, objectCaching: false,
      lockScalingX: true, lockScalingY: true, lockRotation: true
    };

    // 固定ラベル（完全にクリックをスルーさせて、下のオブジェクトやキャンバスにイベントを流す）
    const labelStyle = { 
      ...baseStyle, 
      selectable: false, 
      evented: false 
    };

    // 数字部分（移動は完全に禁止するが、キャンバスのダブルクリック検知に引っかけるために evented: true にする）
    const numStyle = { 
      ...baseStyle, 
      backgroundColor: 'rgba(255, 255, 255, 0.85)',
      selectable: false, 
      evented: true, 
      lockMovementX: true, 
      lockMovementY: true
    };

    if (dimMode === 'W') {
      const lblW = new fabric.IText('W: ', labelStyle);
      const numW = new fabric.IText('00', numStyle);
      textElements.push(lblW, numW);
      textGroupParts.numW = numW;
    } 
    else if (dimMode === 'W_H') {
      const lblW = new fabric.IText('W: ', labelStyle);
      const numW = new fabric.IText('00', numStyle);
      const lblH = new fabric.IText('H: ', labelStyle);
      const numH = new fabric.IText('00', numStyle);
      
      (lblH as any)._isNewLine = true;
      (lblH as any)._customTopOffset = 16;
      (numH as any)._customTopOffset = 16;

      textElements.push(lblW, numW, lblH, numH);
      textGroupParts.numW = numW;
      textGroupParts.numH = numH;
    } 
    else if (dimMode === 'W_D') {
      const lblW = new fabric.IText('W: ', labelStyle);
      const numW = new fabric.IText('00', numStyle);
      const slash = new fabric.IText(' / ', labelStyle);
      const lblD = new fabric.IText('D: ', labelStyle);
      const numD = new fabric.IText('00', numStyle);
      textElements.push(lblW, numW, slash, lblD, numD);
      textGroupParts.numW = numW;
      textGroupParts.numD = numD;
    } 
    else if (dimMode === 'W_D_H') {
      const lblW = new fabric.IText('W: ', labelStyle);
      const numW = new fabric.IText('00', numStyle);
      const slash = new fabric.IText(' / ', labelStyle);
      const lblD = new fabric.IText('D: ', labelStyle);
      const numD = new fabric.IText('00', numStyle);
      const lblH = new fabric.IText('H: ', labelStyle);
      const numH = new fabric.IText('00', numStyle);

      (lblH as any)._isNewLine = true;
      (lblH as any)._customTopOffset = 16;
      (numH as any)._customTopOffset = 16;

      textElements.push(lblW, numW, slash, lblD, numD, lblH, numH);
      textGroupParts.numW = numW;
      textGroupParts.numD = numD;
      textGroupParts.numH = numH;
    }

    // 相互リンクの構築
    (group as any)._dimensionParts = dimensionParts;
    (group as any)._dimMode = dimMode;
    dimensionParts.textElements = textElements;
    
    textElements.forEach((t) => {
      (t as any)._parentGroup = group;
    });

    fCanvas.add(group);
    textElements.forEach(t => fCanvas.add(t));

    // 位置合わせ
    updateCombinedTextPosition(group, dimensionParts);

    // --- 3. ★核心：エンターキーで次の数値へバトンタッチする連続入力ロジック ---
    const setupSequence = (currentNum: fabric.IText, nextNum?: fabric.IText) => {
      if (!currentNum) return;

      currentNum.on('changed', () => {
        currentNum.text = currentNum.text.replace(/[^0-9\n]/g, '');
        updateCombinedTextPosition(group, dimensionParts);
        fCanvas.requestRenderAll();
      });

      currentNum.onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          if (e.shiftKey) {
            (currentNum as any).insertChars('\n');
            currentNum.canvas?.requestRenderAll();
            updateCombinedTextPosition(group, dimensionParts);
            return;
          } else {
            e.preventDefault();
            currentNum.exitEditing();
            return;
          }
        }
        fabric.IText.prototype.onKeyDown.call(currentNum, e);
        setTimeout(() => updateCombinedTextPosition(group, dimensionParts), 10);
      };

      currentNum.on('editing:entered', () => {
        group.selectable = false;
      });

      currentNum.on('editing:exited', () => {
        group.selectable = true;
        
        // 入力された文字のトリミング処理
        const isInitialValue = (currentNum.text.trim() === '' || currentNum.text.trim() === '00');
        if (isInitialValue) {
          currentNum.text = '00';
        } else {
          currentNum.text = currentNum.text.trim();
        }
        
        currentNum.setCoords();
        updateCombinedTextPosition(group, dimensionParts);
        fCanvas.requestRenderAll();

        // ★核心：編集が終わったテキストが「初期値（00）」のままで、かつ「次の入力欄」があるなら新規配置とみなしてワープ！
        if (nextNum && isInitialValue) {
          setTimeout(() => {
            fCanvas.setActiveObject(nextNum);
            nextNum.enterEditing();
            nextNum.selectAll();
            fCanvas.requestRenderAll();
          }, 50);
        } 
        // すでに数値が書き換わっている（再編集）、または最後の項目まで入力しきった場合
        else {
          group.setCoords();
          fCanvas.setActiveObject(group); // その場でピタッとフリーな状態に戻す
          fCanvas.requestRenderAll();
        }
      });
    };

    if (dimMode === 'W') setupSequence(textGroupParts.numW);
    else if (dimMode === 'W_H') {
      setupSequence(textGroupParts.numW, textGroupParts.numH);
      setupSequence(textGroupParts.numH);
    } 
    else if (dimMode === 'W_D') {
      setupSequence(textGroupParts.numW, textGroupParts.numD);
      setupSequence(textGroupParts.numD);
    } 
    else if (dimMode === 'W_D_H') {
      setupSequence(textGroupParts.numW, textGroupParts.numD);
      setupSequence(textGroupParts.numD, textGroupParts.numH);
      setupSequence(textGroupParts.numH);
    }

    if (dimMode === 'W' || dimMode === 'W_H') {
      group.setControlsVisibility({
        mt: false, mb: false, ml: true, mr: true, bl: false, br: false, tl: false, tr: false, mtr: true,
      });
      group.lockScalingY = true;
    } else {
      group.setControlsVisibility({
        mt: true, mb: true, ml: true, mr: true, bl: false, br: false, tl: false, tr: false, mtr: true,
      });
    }

    setTimeout(() => {
      if (textGroupParts.numW) {
        fCanvas.setActiveObject(textGroupParts.numW);
        textGroupParts.numW.enterEditing();
        textGroupParts.numW.selectAll();
        fCanvas.requestRenderAll();
      }
    }, 100);

    fCanvas.requestRenderAll();
  };
  
  const addDimension = () => {
    if (!canvas) return;
    (canvas as any)._currentDimMode = dimMode;
    const nextMode = !isPlacing;
    setIsPlacing(nextMode);
    (canvas as any)._isPlacingMode = nextMode;

    if (nextMode) {
      canvas.defaultCursor = 'crosshair';
      canvas.getObjects().forEach(obj => {
        obj.selectable = false;
        obj.evented = false;
      });
      canvas.discardActiveObject();
    } else {
      canvas.defaultCursor = 'default';
      canvas.getObjects().forEach(obj => {
        if (!(obj as any)._parentGroup) {
          obj.selectable = true;
          obj.evented = true;
        }
      });
    }
    canvas.renderAll();
  };
  
  const rotateSelected = (angleStep: number) => {
    if (!canvas) return;
    const active = canvas.getActiveObject() as any;
    if (active && active.type === 'group') {
      const newAngle = (active.angle + angleStep) % 360;
      active.set('angle', newAngle);
      if (active._dimensionParts) {
        updateCombinedTextPosition(active, active._dimensionParts);
      }
      canvas.renderAll();
    }
  };

  const changeSelectedColor = (newColor: string) => {
    if (!canvas) return;

    canvas.getActiveObjects().forEach((obj: any) => {
      if (obj && obj._dimensionParts) {
        const parts = obj._dimensionParts;
        if (parts.wLine) parts.wLine.set('stroke', newColor);
        if (parts.wLeft) parts.wLeft.set('fill', newColor);
        if (parts.wRight) parts.wRight.set('fill', newColor);
        if (parts.dLine) parts.dLine.set('stroke', newColor);
        if (parts.dTop) parts.dTop.set('fill', newColor);
        if (parts.dBottom) parts.dBottom.set('fill', newColor);

        if (parts.textElements) {
          parts.textElements.forEach((textObj: any) => {
            textObj.set('fill', newColor);
          });
        }
      }
      else if (obj && obj._parentGroup) {
        const parent = obj._parentGroup;
        if (parent._dimensionParts && parent._dimensionParts.textElements) {
          parent._dimensionParts.textElements.forEach((textObj: any) => {
            textObj.set('fill', newColor);
          });
        }
        const parentParts = parent._dimensionParts;
        if (parentParts) {
          if (parentParts.wLine) parentParts.wLine.set('stroke', newColor);
          if (parentParts.wLeft) parentParts.wLeft.set('fill', newColor);
          if (parentParts.wRight) parentParts.wRight.set('fill', newColor);
          if (parentParts.dLine) parentParts.dLine.set('stroke', newColor);
          if (parentParts.dTop) parentParts.dTop.set('fill', newColor);
          if (parentParts.dBottom) parentParts.dBottom.set('fill', newColor);
        }
      }
    });

    canvas.requestRenderAll();
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canvas) return;
    const reader = new FileReader();
    reader.onload = async (f) => {
      const img = await fabric.FabricImage.fromURL(f.target?.result as string);
      const scale = Math.min(canvas.width! / img.width!, canvas.height! / img.height!);
      img.scale(scale < 1 ? scale : 1);
      img.set({ left: canvas.width! / 2, top: canvas.height! / 2, originX: 'center', originY: 'center' });
      canvas.backgroundImage = img;
      canvas.renderAll();
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col items-center gap-4 p-8 bg-gray-50 min-h-screen font-sans">
      <div className="flex flex-wrap gap-4 mb-4 items-center bg-white p-4 rounded-xl shadow-md border border-gray-100">
        <input type="file" accept="image/*" onChange={handleImageUpload} className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer" />
        <div className="h-8 w-px bg-gray-200 mx-2" />
        
          <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200 text-sm font-medium">
            <button onClick={() => setDimMode('W')} className={`px-3 py-1.5 rounded-md transition ${dimMode === 'W' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}>↔ W</button>
            <button onClick={() => setDimMode('W_D')} className={`px-3 py-1.5 rounded-md transition ${dimMode === 'W_D' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}>✛ W×D</button>
            <button onClick={() => setDimMode('W_H')} className={`px-3 py-1.5 rounded-md transition ${dimMode === 'W_H' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}>↔ W×H</button>
            <button onClick={() => setDimMode('W_D_H')} className={`px-3 py-1.5 rounded-md transition ${dimMode === 'W_D_H' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}>✛ W×D×H</button>
          </div>

        <button onClick={addDimension} className={`px-4 py-2 rounded-lg transition font-medium shadow-sm ${isPlacing ? 'bg-amber-500 text-white animate-pulse ring-2 ring-amber-300' : 'bg-green-600 text-white hover:bg-green-700'}`}>寸法追加</button>

        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          <button onClick={() => rotateSelected(-90)} className="p-2 hover:bg-white rounded-md transition shadow-sm" title="左90度回転">↺</button>
          <button onClick={() => rotateSelected(90)} className="p-2 hover:bg-white rounded-md transition shadow-sm" title="右90度回転">↻</button>
        </div>
        <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
          {['#ef4444', '#3b82f6', '#22c55e', '#000000'].map(c => (
            <button key={c} onClick={() => changeSelectedColor(c)} className="w-8 h-8 rounded-md border border-gray-200 shadow-sm transition hover:scale-105" style={{ backgroundColor: c }} title={c === '#000000' ? '黒' : ''} />
          ))}
        </div>

        <button onClick={async () => {
          if (typeof window === "undefined" || !canvas) return;
          const now = new Date();
          const yyyymmdd = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
          const defaultName = `${yyyymmdd}_寸法図.jpg`;
          const dataURL = canvas.toDataURL({ format: 'jpeg', quality: 0.8, multiplier: 1 });
          const response = await fetch(dataURL);
          const blob = await response.blob();

          if ('showSaveFilePicker' in window) {
            try {
              const handle = await (window as any).showSaveFilePicker({
                suggestedName: defaultName,
                types: [{ description: 'JPEG Image', accept: { 'image/jpeg': ['.jpg'] } }],
              });
              const writable = await handle.createWritable();
              await writable.write(blob);
              await writable.close();
              return;
            } catch (err) { return; }
          }
          const link = document.createElement('a');
          link.download = defaultName;
          link.href = dataURL;
          link.click();
        }} className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-black transition font-medium ml-auto">保存 (JPEG)</button>
      </div>

      <div className="border-4 border-white shadow-2xl rounded-lg overflow-hidden bg-white">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};

export default FloorPlanEditor;