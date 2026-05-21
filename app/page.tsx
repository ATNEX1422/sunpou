"use client";

import React, { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';

const FloorPlanEditor = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
  const [isPlacing, setIsPlacing] = useState<boolean>(false);
  const [dimMode, setDimMode] = useState<'W' | 'W_D' | 'W_H' | 'W_D_H' | 'TEXT_ONLY' | 'ARROW_ONLY'>('W');
  const copiedJsonRef = useRef<string | null>(null);

  // ★Undo/Redo用：履歴スタック
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const isRespondingToHistory = useRef<boolean>(false); // 履歴復元中のイベント重複防止フラグ

  // ★共通ヘルパー：すべてのテキストを「各行左揃え」のまま、寸法線の少し下に美しく縦並びにするロジック
  const updateCombinedTextPosition = (target: fabric.Group, parts: any) => {
    if (!parts || !parts.textElements) return;

    const angleRad = (target.angle || 0) * (Math.PI / 180);
    const dimMode = (target as any)._dimMode || 'W';

    // 1. 寸法線の形状に合わせて初期配置の基準点を決める
    let offsetX = 0;
    let offsetY = 0;

    if (dimMode === 'W' || dimMode === 'W_H') {
      // 直線タイプ（W, W_H）は中央
      offsetX = 0;
      offsetY = (target.height / 2) + 24; 
    } else {
      // 十字タイプ（W_D, W_D_H）は従来通り右上45度に逃がす
      offsetX = (target.width / 2) + 12;
      offsetY = -((target.height / 2) + 12);
    }

    const rotatedX = target.left! + (offsetX * Math.cos(angleRad) - offsetY * Math.sin(angleRad));
    const rotatedY = target.top! + (offsetX * Math.sin(angleRad) + offsetY * Math.cos(angleRad));

    // 縦に並んだテキストの最長幅（Wの行）を基準にして開始位置を左にずらす
    let maxLineWidth = 0;
    let currentLineWidth = 0;
    const padding = 2;

    parts.textElements.forEach((textObj: fabric.Object) => {
      if ((textObj as any)._isNewLine) {
        if (currentLineWidth > maxLineWidth) maxLineWidth = currentLineWidth;
        currentLineWidth = 0;
      }
      currentLineWidth += (textObj.width || 0) + padding;
    });
    if (currentLineWidth > maxLineWidth) maxLineWidth = currentLineWidth;

    let currentLeft = rotatedX - (maxLineWidth / 2);
    const startX = currentLeft; // 改行時のリセット用位置

    // --- 3. 【新ロジック】全モードの総行数と総高さを正確に計算する ---
    let totalLines = 1;
    parts.textElements.forEach((textObj: fabric.Object) => {
      if ((textObj as any)._isNewLine) totalLines++;
    });
    
    // 1行あたり18pxとして、テキストの塊全体の総高さを出す
    const lineHeight = 18;
    const totalTextHeight = totalLines * lineHeight;

    let lineStartIndex = 0;
    let currentLineIndex = 0; // 現在何行目を処理しているか

    // 全パーツを走査して、行ごとに配置を確定していく
    while (lineStartIndex < parts.textElements.length) {
      // 1. この行に属するパーツを抽出
      const lineParts: fabric.Object[] = [];
      let i = lineStartIndex;
      while (i < parts.textElements.length) {
        if (i > lineStartIndex && (parts.textElements[i] as any)._isNewLine) break;
        lineParts.push(parts.textElements[i]);
        i++;
      }
      lineStartIndex = i;

      // 2. この行の総横幅を計算
      let lineWidth = 0;
      lineParts.forEach((textObj, idx) => {
        lineWidth += textObj.width || 0;
        if (idx < lineParts.length - 1) lineWidth += 2;
      });

      // 3. ★核心：この行の「理想のY座標」を計算する
      const lineY = rotatedY - (totalTextHeight / 2) + (currentLineIndex * lineHeight) + (lineHeight / 2);

      // 4. 行頭揃えの左端から、中心基準で各パーツを配置
      let currentLeft = rotatedX - (maxLineWidth / 2);
      
      lineParts.forEach((textObj) => {
        const objWidth = textObj.width || 0;

        textObj.set({
          scaleX: 1,
          scaleY: 1,
          originX: 'center',
          originY: 'center',
          left: currentLeft + (objWidth / 2),
          top: lineY  
        });
        textObj.setCoords();

        // 次のパーツのために左端を進める
        currentLeft += objWidth + 2;
      });

      currentLineIndex++; // 次の行へ
    }
  };

  // ★Undo/Redo用：現在のキャンバスの状態を丸ごとセーブする関数
  const saveHistory = (fCanvas: fabric.Canvas) => {
    if (isRespondingToHistory.current) return;
    
    const json = JSON.stringify(fCanvas.toObject([
      '_dimMode', 
      '_dimensionParts', 
      '_parentGroup', 
      '_isNewLine', 
      '_customTopOffset',
      'selectable',
      'evented',
      'lockMovementX',
      'lockMovementY',
      'lockScalingX',
      'lockScalingY',
      'lockRotation',
      'hasControls',
      'hasBorders'
    ]));

    if (undoStack.current.length > 0 && undoStack.current[undoStack.current.length - 1] === json) return;

    undoStack.current.push(json);
    redoStack.current = []; 
  };

  // ★Undo/Redo用：歴史をロードしてオブジェクト間の参照リンクを再構築する関数
  const loadHistoryState = async (fCanvas: fabric.Canvas, jsonStr: string) => {
    isRespondingToHistory.current = true;
    fCanvas.discardActiveObject();
    
    const bgImage = fCanvas.backgroundImage;

    await fCanvas.loadFromJSON(jsonStr);

    if (bgImage) {
      fCanvas.backgroundImage = bgImage;
    }

    const objects = fCanvas.getObjects();
    const groups = objects.filter(obj => obj instanceof fabric.Group) as fabric.Group[];
    const texts = objects.filter(obj => obj instanceof fabric.IText) as fabric.IText[];

    groups.forEach((group: any) => {
      const parts: any = {};
      const linkedTexts: fabric.Object[] = [];

      group.getObjects().forEach((child: any, index: number) => {
        if (index === 0) parts.wLine = child;
        if (index === 1) parts.wLeft = child;
        if (index === 2) parts.wRight = child;
        if (index === 3) parts.dLine = child;
        if (index === 4) parts.dTop = child;
        if (index === 5) parts.dBottom = child;
      });

      texts.forEach((textObj: any) => {
        if (textObj._parentGroup && 
            Math.abs(textObj._parentGroup.left - group.left) < 50 && 
            Math.abs(textObj._parentGroup.top - group.top) < 50) {
          textObj._parentGroup = group;
          linkedTexts.push(textObj);
        }
      });

      parts.textElements = linkedTexts.sort((a: any, b: any) => {
        const topDiff = (a._customTopOffset || 0) - (b._customTopOffset || 0);
        if (topDiff !== 0) return topDiff;
        return a.left - b.left;
      });

      group._dimensionParts = parts;
      updateCombinedTextPosition(group, parts);
    });

    fCanvas.requestRenderAll();
    isRespondingToHistory.current = false;
  };

  useEffect(() => {
    if (!canvasRef.current) return;

    const fabricCanvas = new fabric.Canvas(canvasRef.current, {
      width: 800,
      height: 600,
      backgroundColor: '#f3f4f6',
      centeredScaling: true,
    });

    fabricCanvas.on('object:modified', () => saveHistory(fabricCanvas));

    fabricCanvas.on('object:moving', (options: any) => {
      const target = options.target;
      if (!target) return;

      if (target instanceof fabric.Group) {
        updateCombinedTextPosition(target, (target as any)._dimensionParts);
      }
      fabricCanvas.requestRenderAll();
    });

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

    fabricCanvas.on('mouse:dblclick', (options) => {
      const target = options.target;
      if (!target) return;

      if (target instanceof fabric.IText && (target as any)._parentGroup) {
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
        saveHistory(fabricCanvas);

        const currentMode = (fabricCanvas as any)._currentDimMode || 'W';

        // ★修正：型エラーが起きていた currentColor を除去し '#ef4444' 固定で完全に同期
        if (currentMode === 'TEXT_ONLY') {
          createTextBoxOnly(fabricCanvas, pointer.x, pointer.y, '#000000');
        } else if (currentMode === 'ARROW_ONLY') {
          createSingleArrow(fabricCanvas, pointer.x, pointer.y, '#ef4444');
        } else {
          createDimensionAtPosition(fabricCanvas, pointer.x, pointer.y, '#ef4444', currentMode);
        }

        (fabricCanvas as any)._isPlacingMode = false;
        setIsPlacing(false);
        fabricCanvas.defaultCursor = 'default';
        
        setTimeout(() => {
          fabricCanvas.getObjects().forEach(obj => {
            if (!(obj as any)._parentGroup) {
              obj.selectable = true;
              obj.evented = true;
            }
          });
          saveHistory(fabricCanvas);
          fabricCanvas.renderAll();
        }, 10);
      }
    });

    const canvasElement = fabricCanvas.getSelectionElement();
    if (canvasElement) {
      canvasElement.tabIndex = 1000;
      canvasElement.style.outline = 'none';

      canvasElement.addEventListener('keydown', (e: KeyboardEvent) => {
        const key = e.key.toLowerCase();
        const active = fabricCanvas.getActiveObject();
        if (active && (active as any).isEditing) return;

        if ((e.ctrlKey || e.metaKey) && key === 'z') {
          e.preventDefault();
          if (undoStack.current.length === 0) return;
          
          const currentJson = JSON.stringify(fabricCanvas.toObject(['_dimMode', '_dimensionParts', '_parentGroup', '_isNewLine', '_customTopOffset', 'selectable', 'evented', 'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY', 'lockRotation', 'hasControls', 'hasBorders']));
          redoStack.current.push(currentJson);

          const previousState = undoStack.current.pop()!;
          loadHistoryState(fabricCanvas, previousState);
          return;
        }

        if ((e.ctrlKey || e.metaKey) && key === 'y') {
          e.preventDefault();
          if (redoStack.current.length === 0) return;

          const currentJson = JSON.stringify(fabricCanvas.toObject(['_dimMode', '_dimensionParts', '_parentGroup', '_isNewLine', '_customTopOffset', 'selectable', 'evented', 'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY', 'lockRotation', 'hasControls', 'hasBorders']));
          undoStack.current.push(currentJson);

          const nextState = redoStack.current.pop()!;
          loadHistoryState(fabricCanvas, nextState);
          return;
        }

        if ((e.ctrlKey || e.metaKey) && key === 'c') {
          if (!active) return;

          let targetGroup = active;
          if ((active as any)._parentGroup) {
            targetGroup = (active as any)._parentGroup;
          }

          if (targetGroup.type === 'group') {
            e.preventDefault();
            
            const groupData = targetGroup.toObject(['_dimMode', '_dimensionParts']);
            const textDataArray = (targetGroup as any)._dimensionParts.textElements.map((t: any) => {
              return t.toObject(['_isNewLine', '_customTopOffset']);
            });

            copiedJsonRef.current = JSON.stringify({
              group: groupData,
              texts: textDataArray,
              dimMode: (targetGroup as any)._dimMode
            });
          }
          return;
        }

        if ((e.ctrlKey || e.metaKey) && key === 'v') {
          if (!copiedJsonRef.current) return;
          e.preventDefault();

          saveHistory(fabricCanvas);

          const clipboardData = JSON.parse(copiedJsonRef.current);

          (async () => {
            const clonedGroup = await fabric.Group.fromObject(clipboardData.group);
            const dimMode = clipboardData.dimMode;
            
            clonedGroup.set({
              left: (clipboardData.group.left || 0) + 20,
              top: (clipboardData.group.top || 0) + 20,
              selectable: true,
              evented: true,
              objectCaching: false
            });

            const clonedParts: any = {};
            const newTextElements: fabric.Object[] = [];

            clonedGroup.getObjects().forEach((obj: any, index: number) => {
              if (index === 0) clonedParts.wLine = obj;
              if (index === 1) clonedParts.wLeft = obj;
              if (index === 2) clonedParts.wRight = obj;
              if (index === 3) clonedParts.dLine = obj;
              if (index === 4) clonedParts.dTop = obj;
              if (index === 5) clonedParts.dBottom = obj;
            });

            for (const tData of clipboardData.texts) {
              const clonedText = await fabric.IText.fromObject(tData);
              const isNum = tData.text !== 'W: ' && tData.text !== ' / ' && tData.text !== 'D: ' && tData.text !== 'H: ';
              
              clonedText.set({
                originX: 'left',
                originY: 'center',
                hasControls: false,
                hasBorders: false,
                objectCaching: false,
                selectable: false,
                evented: isNum,
                lockMovementX: true,
                lockMovementY: true,
                lockScalingX: true,
                lockScalingY: true,
                lockRotation: true
              });
              
              (clonedText as any)._parentGroup = clonedGroup;
              (clonedText as any)._isNewLine = tData._isNewLine;
              (clonedText as any)._customTopOffset = tData._customTopOffset;
              
              newTextElements.push(clonedText);
            }

            (clonedGroup as any)._dimensionParts = clonedParts;
            (clonedGroup as any)._dimMode = dimMode;
            clonedParts.textElements = newTextElements;

            if (dimMode === 'W' || dimMode === 'W_H') {
              clonedGroup.setControlsVisibility({
                mt: false, mb: false, ml: true, mr: true, bl: false, br: false, tl: false, tr: false, mtr: true,
              });
              clonedGroup.lockScalingY = true;
            } else {
              clonedGroup.setControlsVisibility({
                mt: true, mb: true, ml: true, mr: true, bl: false, br: false, tl: false, tr: false, mtr: true,
              });
            }

            fabricCanvas.add(clonedGroup);
            newTextElements.forEach(t => fabricCanvas.add(t));

            updateCombinedTextPosition(clonedGroup, clonedParts);
            
            newTextElements.forEach((textObj: any) => {
              if (textObj.evented) {
                textObj.on('changed', () => {
                  textObj.text = textObj.text.replace(/[^0-9\n]/g, '');
                  updateCombinedTextPosition(clonedGroup, clonedParts);
                  fabricCanvas.requestRenderAll();
                });

                textObj.onKeyDown = (eEvent: KeyboardEvent) => {
                  if (eEvent.key === 'Enter') {
                    if (eEvent.shiftKey) {
                      (textObj as any).insertChars('\n');
                      textObj.canvas?.requestRenderAll();
                      updateCombinedTextPosition(clonedGroup, clonedParts);
                      return;
                    } else {
                      eEvent.preventDefault();
                      textObj.exitEditing();
                      return;
                    }
                  }
                  fabric.IText.prototype.onKeyDown.call(textObj, eEvent);
                  setTimeout(() => updateCombinedTextPosition(clonedGroup, clonedParts), 10);
                };

                textObj.on('editing:entered', () => { clonedGroup.selectable = false; });
                textObj.on('editing:exited', () => {
                  clonedGroup.selectable = true;
                  textObj.text = textObj.text.trim() === '' ? '00' : textObj.text.trim();
                  textObj.setCoords();
                  updateCombinedTextPosition(clonedGroup, clonedParts);
                  saveHistory(fabricCanvas);
                  fabricCanvas.requestRenderAll();
                });
              }
            });

            fabricCanvas.discardActiveObject();
            fabricCanvas.setActiveObject(clonedGroup);
            
            saveHistory(fabricCanvas);
            fabricCanvas.requestRenderAll();
          })();
          return;
        }

        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          const activeObjects = fabricCanvas.getActiveObjects();
          if (activeObjects.length === 0) return;

          saveHistory(fabricCanvas);
          
          activeObjects.forEach(obj => {
            if (obj && (obj as any)._dimensionParts && (obj as any)._dimensionParts.textElements) {
              (obj as any)._dimensionParts.textElements.forEach((t: any) => fabricCanvas.remove(t));
            }
            if (obj && (obj as any)._parentGroup) {
              const parent = (obj as any)._parentGroup;
              if (parent._dimensionParts && parent._dimensionParts.textElements) {
                parent._dimensionParts.textElements.forEach((t: any) => fabricCanvas.remove(t));
              }
              fabricCanvas.remove(parent);
            }
            fabricCanvas.remove(obj);
          });
          fabricCanvas.discardActiveObject();
          saveHistory(fabricCanvas);
          fabricCanvas.requestRenderAll();
        }
      });
    }

    return () => {
      fabricCanvas.dispose();
    };
  }, []);

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

    const textElements: fabric.Object[] = [];
    const textGroupParts: any = {};

    const baseStyle = { 
      fontSize: 12, 
      fontWeight: '500' as const, 
      fontFamily: 'Inter, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif',
      fill: color, 
      originX: 'center' as const, 
      originY: 'center' as const,
      hasControls: false, 
      hasBorders: false, 
      objectCaching: false,
      lockScalingX: true, 
      lockScalingY: true, 
      lockRotation: true
    };

    const labelStyle = { ...baseStyle, selectable: false, evented: false };
    const numStyle = { ...baseStyle, backgroundColor: 'rgba(255, 255, 255, 0.85)', selectable: false, evented: true, lockMovementX: true, lockMovementY: true };

    const lblW = new fabric.IText('W: ', labelStyle);
    const numW = new fabric.IText('00', numStyle);
    textElements.push(lblW, numW);
    textGroupParts.numW = numW;

    if (dimMode === 'W_D' || dimMode === 'W_D_H') {
      const lblD = new fabric.IText('D: ', labelStyle);
      const numD = new fabric.IText('00', numStyle);
      
      (lblD as any)._isNewLine = true;
      (lblD as any)._customTopOffset = 18;
      (numD as any)._customTopOffset = 18;

      textElements.push(lblD, numD);
      textGroupParts.numD = numD;
    }

    if (dimMode === 'W_H' || dimMode === 'W_D_H') {
      const lblH = new fabric.IText('H: ', labelStyle);
      const numH = new fabric.IText('00', numStyle);
      
      const hOffset = dimMode === 'W_D_H' ? 36 : 18;

      (lblH as any)._isNewLine = true;
      (lblH as any)._customTopOffset = hOffset;
      (numH as any)._customTopOffset = hOffset;

      textElements.push(lblH, numH);
      textGroupParts.numH = numH;
    }

    (group as any)._dimensionParts = dimensionParts;
    (group as any)._dimMode = dimMode;
    dimensionParts.textElements = textElements;
    
    textElements.forEach((t) => {
      (t as any)._parentGroup = group;
    });

    fCanvas.add(group);
    textElements.forEach(t => fCanvas.add(t));

    updateCombinedTextPosition(group, dimensionParts);

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
        
        const isInitialValue = (currentNum.text.trim() === '' || currentNum.text.trim() === '00');
        if (isInitialValue) {
          currentNum.text = '00';
        } else {
          currentNum.text = currentNum.text.trim();
        }
        
        currentNum.setCoords();
        updateCombinedTextPosition(group, dimensionParts);
        
        saveHistory(fCanvas);
        fCanvas.requestRenderAll();

        if (nextNum && isInitialValue) {
          setTimeout(() => {
            fCanvas.setActiveObject(nextNum);
            nextNum.enterEditing();
            nextNum.selectAll();
            fCanvas.requestRenderAll();
          }, 50);
        } 
        else {
          group.setCoords();
          fCanvas.setActiveObject(group);
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
  
  // ★修正：「寸法追加」ボタンを押したときのロジックに TEXT_ONLY と ARROW_ONLY のルートも完全マージ
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
    if (active) {
      // グループ（寸法線・片方矢印）または単体テキスト（テキストのみ）の両方の回転に対応
      const newAngle = (active.angle + angleStep) % 360;
      active.set('angle', newAngle);
      if (active.type === 'group' && active._dimensionParts) {
        updateCombinedTextPosition(active, active._dimensionParts);
      }
      saveHistory(canvas); 
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
      // 単体のテキストボックスや矢印の直系の色変更にも対応
      else if (obj) {
        if (obj.type === 'i-text') {
          obj.set('fill', newColor);
        } else if (obj.type === 'group') {
          obj.getObjects().forEach((child: any) => {
            if (child.stroke) child.set('stroke', newColor);
            if (child.fill) child.set('fill', newColor);
          });
        }
      }
    });

    saveHistory(canvas); 
    canvas.requestRenderAll();
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canvas) return;

    const reader = new FileReader();
    reader.onload = async (f) => {
      const existingObjects = canvas.getObjects();
      existingObjects.forEach((obj: any) => {
        if (obj && obj._isPropertyTitle) {
          canvas.remove(obj);
        }
      });

      const img = await fabric.FabricImage.fromURL(f.target?.result as string);
      const scale = Math.min(canvas.width! / img.width!, canvas.height! / img.height!);
      img.scale(scale < 1 ? scale : 1);
      img.set({ left: canvas.width! / 2, top: canvas.height! / 2, originX: 'center', originY: 'center' });
      canvas.backgroundImage = img;
      
      undoStack.current = [];
      redoStack.current = [];

      const propertyTitle = new fabric.IText('【ここに物件名を入力】', {
        fontSize: 14,
        fontWeight: '500',
        fontFamily: 'Inter, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif',
        fill: '#1f2937', 
        backgroundColor: 'rgba(255, 255, 255, 0.9)', 
        padding: 6,
        originX: 'right', 
        originY: 'bottom', 
        left: canvas.width! - 20, 
        top: canvas.height! - 20, 
        hasControls: false, 
        hasBorders: true,
        borderColor: '#3b82f6', 
        cornerSize: 0,
        lockMovementX: false, 
        lockMovementY: false,
      });

      (propertyTitle as any)._isPropertyTitle = true;

      propertyTitle.onKeyDown = (eEvent: KeyboardEvent) => {
        if (eEvent.key === 'Enter') {
          if (eEvent.shiftKey) {
            (propertyTitle as any).insertChars('\n');
            propertyTitle.canvas?.requestRenderAll();
            return;
          } else {
            eEvent.preventDefault();
            propertyTitle.exitEditing(); 
            return;
          }
        }
        fabric.IText.prototype.onKeyDown.call(propertyTitle, eEvent);
      };

      canvas.add(propertyTitle);
      saveHistory(canvas);
      
      canvas.discardActiveObject();
      canvas.setActiveObject(propertyTitle);
      canvas.renderAll();
    };
    reader.readAsDataURL(file);
  };

  // ★追加：テキストボックスのみを配置する関数（大きさ変更不可）
  const createTextBoxOnly = (fCanvas: fabric.Canvas, x: number, y: number, color: string = '#000000') => {
    const textObj = new fabric.IText('テキスト入力', {
      left: x,
      top: y,
      fontSize: 14,
      fontWeight: '500',
      fontFamily: 'Roboto, Inter, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif',
      fill: color,
      backgroundColor: 'rgba(255, 255, 255, 0.85)',
      padding: 4,
      originX: 'center',
      originY: 'center',
      hasControls: true, 
      hasBorders: true,
      borderColor: '#3b82f6',
    });

    textObj.setControlsVisibility({
      mt: false, mb: false, ml: false, mr: false, 
      bl: false, br: false, tl: false, tr: false, 
      mtr: true, 
    });

    textObj.onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          (textObj as any).insertChars('\n');
          textObj.canvas?.requestRenderAll();
          return;
        } else {
          e.preventDefault();
          textObj.exitEditing();
          return;
        }
      }
      fabric.IText.prototype.onKeyDown.call(textObj, e);
    };

    textObj.on('editing:exited', () => {
      if (textObj.text.trim() === '') {
        textObj.text = 'テキスト入力';
      }
      saveHistory(fCanvas);
      fCanvas.requestRenderAll();
    });

    fCanvas.add(textObj);
    fCanvas.setActiveObject(textObj);
    textObj.enterEditing();
    textObj.selectAll();
    fCanvas.requestRenderAll();
  };

 // ★修正：既存コードを100%流用し、wLeftを透明化することでエラーを完全回避した片方矢印関数
  const createSingleArrow = (fCanvas: fabric.Canvas, x: number, y: number, color: string = '#ef4444') => {
    const length = 80;
    const arrowSize = 8;
    const objectsToGroup: fabric.Object[] = [];
    const dimensionParts: any = {};

    // 1. 線（中心基準）
    const wLine = new fabric.Line([-length / 2, 0, length / 2, 0], {
      stroke: color, strokeWidth: 2, originX: 'center', originY: 'center',
    });
    
    // 2. ★核心：左側の矢印も作りますが、opacity: 0（完全に透明）にしてユーザーには見えなくします！
    // これにより、既存の object:scaling がエラーを吐かずに100%正常にすり抜けます。
    const wLeft = new fabric.Triangle({
      width: arrowSize, height: arrowSize, fill: color, angle: -90, originX: 'center', originY: 'center', 
      left: -length / 2,
      opacity: 0, // ★透明化
      selectable: false,
      evented: false
    });

    // 3. 右側の矢印（こちらは見える状態）
    const wRight = new fabric.Triangle({
      width: arrowSize, height: arrowSize, fill: color, angle: 90, originX: 'center', originY: 'center', 
      left: length / 2
    });

    // 既存の寸法線「W」と全く同じパーツ構成でグループに登録
    objectsToGroup.push(wLine, wLeft, wRight);
    
    dimensionParts.wLine = wLine;
    dimensionParts.wLeft = wLeft;
    dimensionParts.wRight = wRight;

    // グループ化
    const group = new fabric.Group(objectsToGroup, {
      left: x, top: y, originX: 'center', originY: 'center', objectCaching: false,
    });

    (group as any)._dimensionParts = dimensionParts;
    (group as any)._dimMode = 'W'; // 既存のWモードの伸縮ロジックを完全流用

    // コントロールの制限（左右の ml, mr と回転 mtr のみ）
    group.setControlsVisibility({
      mt: false, mb: false, 
      bl: false, br: false, tl: false, tr: false, 
      ml: true,  mr: true,  
      mtr: true, 
    });
    group.lockScalingY = true;

    group.on('modified', () => {
      saveHistory(fCanvas);
    });

    fCanvas.add(group);
    fCanvas.setActiveObject(group);
    fCanvas.requestRenderAll();
  };

  return (
    <div className="flex flex-col items-center gap-4 p-8 bg-gray-50 min-h-screen font-sans">
      <div className="flex flex-wrap gap-4 mb-4 items-center bg-white p-4 rounded-xl shadow-md border border-gray-100">
        <input type="file" accept="image/*" onChange={handleImageUpload} className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer" />
        <div className="h-8 w-px bg-gray-200 mx-2" />
        
        {/* モード選択ボタンの並び */}
        <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200 text-sm font-medium">
          <button onClick={() => setDimMode('W')} className={`px-3 py-1.5 rounded-md transition ${dimMode === 'W' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}>↔ W</button>
          <button onClick={() => setDimMode('W_D')} className={`px-3 py-1.5 rounded-md transition ${dimMode === 'W_D' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}>✛ W×D</button>
          <button onClick={() => setDimMode('W_H')} className={`px-3 py-1.5 rounded-md transition ${dimMode === 'W_H' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}>↔ W×H</button>
          <button onClick={() => setDimMode('W_D_H')} className={`px-3 py-1.5 rounded-md transition ${dimMode === 'W_D_H' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}>✛ W×D×H</button>
          
          {/* テキストのみモードを選択するボタン */}
          <button 
            onClick={() => setDimMode('TEXT_ONLY')} 
            className={`px-3 py-1.5 rounded-md transition ${dimMode === 'TEXT_ONLY' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
          >
            テキスト
          </button>
          
          {/* 片方矢印モードを選択するボタン */}
          <button 
            onClick={() => setDimMode('ARROW_ONLY')} 
            className={`px-3 py-1.5 rounded-md transition ${dimMode === 'ARROW_ONLY' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
          >
            ➔
          </button>
        </div>

        {/* 寸法追加ボタン */}
        <button 
          onClick={addDimension} 
          className={`px-4 py-2 rounded-lg transition font-medium shadow-sm ${isPlacing ? 'bg-amber-500 text-white animate-pulse ring-2 ring-amber-300' : 'bg-green-600 text-white hover:bg-green-700'}`}
        >
          寸法追加
        </button>

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

          // ① キャンバス内から物件名テキストボックスを検索して文字を抜き出す
          const objects = canvas.getObjects();
          const propertyTitleObj = objects.find((obj: any) => obj && obj._isPropertyTitle) as any;
          
          let propertyName = '';
          if (propertyTitleObj && propertyTitleObj.text) {
            const rawText = propertyTitleObj.text.trim();
            if (rawText !== '【ここに物件名を入力】' && rawText !== '') {
              propertyName = rawText;
            }
          }

          // ② 決定するデフォルト名
          const defaultName = propertyName ? `寸法_${propertyName}.jpg` : '寸法.jpg';

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