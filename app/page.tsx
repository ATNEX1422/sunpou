"use client";

import React, { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';

const FloorPlanEditor = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
  const [isPlacing, setIsPlacing] = useState<boolean>(false);
  const [dimMode, setDimMode] = useState<'W' | 'W_D' | 'W_H' | 'W_D_H'>('W');

  // ★コピペ用：クリップボード（JSON文字列）
  const copiedJsonRef = useRef<string | null>(null);

  // ★Undo/Redo用：履歴スタック
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const isRespondingToHistory = useRef<boolean>(false); // 履歴復元中のイベント重複防止フラグ

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

  // ★Undo/Redo用：現在のキャンバスの状態を丸ごとセーブする関数
  const saveHistory = (fCanvas: fabric.Canvas) => {
    if (isRespondingToHistory.current) return;
    
    // カスタムプロパティ（_dimMode, _parentGroupなど）を網羅してシリアライズ
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

    // 直近と同じ状態ならスタックへの重複保存をスキップ
    if (undoStack.current.length > 0 && undoStack.current[undoStack.current.length - 1] === json) return;

    undoStack.current.push(json);
    redoStack.current = []; // 新しい操作をしたら進むスタックはクリア
  };

  // ★Undo/Redo用：歴史をロードしてオブジェクト間の参照リンクを再構築する関数
  const loadHistoryState = async (fCanvas: fabric.Canvas, jsonStr: string) => {
    isRespondingToHistory.current = true;
    fCanvas.discardActiveObject();
    
    // 背景画像を維持するために一時避難
    const bgImage = fCanvas.backgroundImage;

    await fCanvas.loadFromJSON(jsonStr);

    // 背景画像の再適用
    if (bgImage) {
      fCanvas.backgroundImage = bgImage;
    }

    // ロードされたオブジェクトたちの親子関係（紐付け参照リンク）を1から再構築する
    const objects = fCanvas.getObjects();
    const groups = objects.filter(obj => obj instanceof fabric.Group) as fabric.Group[];
    const texts = objects.filter(obj => obj instanceof fabric.IText) as fabric.IText[];

    groups.forEach((group: any) => {
      const parts: any = {};
      const linkedTexts: fabric.Object[] = [];

      // 内部パーツ（線、矢印）の再割り当て
      group.getObjects().forEach((child: any, index: number) => {
        if (index === 0) parts.wLine = child;
        if (index === 1) parts.wLeft = child;
        if (index === 2) parts.wRight = child;
        if (index === 3) parts.dLine = child;
        if (index === 4) parts.dTop = child;
        if (index === 5) parts.dBottom = child;
      });

      // このグループを親に持つテキスト群を探索して再リンク
      texts.forEach((textObj: any) => {
        // loadFromJSON時のIDや中身の座標参照から、元の親子関係を復元
        if (textObj._parentGroup && 
            Math.abs(textObj._parentGroup.left - group.left) < 50 && 
            Math.abs(textObj._parentGroup.top - group.top) < 50) {
          textObj._parentGroup = group;
          linkedTexts.push(textObj);
        }
      });

      // テキスト群を正しいレイアウト順（Wラベル➔W数字...）にソートして格納
      parts.textElements = linkedTexts.sort((a: any, b: any) => {
        const topDiff = (a._customTopOffset || 0) - (b._customTopOffset || 0);
        if (topDiff !== 0) return topDiff;
        return a.left - b.left;
      });

      group._dimensionParts = parts;

      // 復元された位置を美しく再計算
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

    // --- 歴史を記録するトリガーイベント群の登録 ---
    fabricCanvas.on('object:modified', () => saveHistory(fabricCanvas)); // 移動・変形・回転が「確定」した時

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

    // 4. 数字のダブルクリック再編集の強制起動処理
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
        // 配置直前の状態をセーブ
        saveHistory(fabricCanvas);

        const currentMode = (fabricCanvas as any)._currentDimMode || 'W';
        createDimensionAtPosition(fabricCanvas, pointer.x, pointer.y, '#ef4444', currentMode);

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
          // 配置完了後の状態を確定セーブ
          saveHistory(fabricCanvas);
          fabricCanvas.renderAll();
        }, 10);
      }
    });    
    // ★修正：windowではなく、Fabric.jsのキャンバスのコンテナ要素に直接キー監視を仕込む
    // これにより、Next.jsのクロージャバグや、Deleteキーが虚空に消える現象を100%シャットアウトします
    const canvasElement = fabricCanvas.getSelectionElement();
    if (canvasElement) {
      // キーボードイベントを受け取れるようにフォーカス可能にする
      canvasElement.tabIndex = 1000;
      canvasElement.style.outline = 'none';

      canvasElement.addEventListener('keydown', (e: KeyboardEvent) => {
        const key = e.key.toLowerCase();
        const active = fabricCanvas.getActiveObject();
        if (active && (active as any).isEditing) return; // 文字入力中はショートカットを無視

        // --- 1. Undo処理 (Ctrl + Z) ---
        if ((e.ctrlKey || e.metaKey) && key === 'z') {
          e.preventDefault();
          if (undoStack.current.length === 0) return;
          
          const currentJson = JSON.stringify(fabricCanvas.toObject(['_dimMode', '_dimensionParts', '_parentGroup', '_isNewLine', '_customTopOffset', 'selectable', 'evented', 'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY', 'lockRotation', 'hasControls', 'hasBorders']));
          redoStack.current.push(currentJson);

          const previousState = undoStack.current.pop()!;
          loadHistoryState(fabricCanvas, previousState);
          return;
        }

        // --- 2. Redo処理 (Ctrl + Y) ---
        if ((e.ctrlKey || e.metaKey) && key === 'y') {
          e.preventDefault();
          if (redoStack.current.length === 0) return;

          const currentJson = JSON.stringify(fabricCanvas.toObject(['_dimMode', '_dimensionParts', '_parentGroup', '_isNewLine', '_customTopOffset', 'selectable', 'evented', 'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY', 'lockRotation', 'hasControls', 'hasBorders']));
          undoStack.current.push(currentJson);

          const nextState = redoStack.current.pop()!;
          loadHistoryState(fabricCanvas, nextState);
          return;
        }

        // --- 3. コピー処理 (Ctrl + C) ---
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

        // --- 4. ペースト処理 (Ctrl + V) ---
        if ((e.ctrlKey || e.metaKey) && key === 'v') {
          if (!copiedJsonRef.current) return;
          e.preventDefault();

          saveHistory(fabricCanvas); // ペースト直前の状態をセーブ

          const clipboardData = JSON.parse(copiedJsonRef.current);

          (async () => {
            // ① 寸法線本体（矢印グループ）の復元
            const clonedGroup = await fabric.Group.fromObject(clipboardData.group);
            const dimMode = clipboardData.dimMode;
            
            // コピペ位置を少し右下にずらす
            clonedGroup.set({
              left: (clipboardData.group.left || 0) + 20,
              top: (clipboardData.group.top || 0) + 20,
              selectable: true,
              evented: true,
              objectCaching: false // ★追加：伸縮時に中身がボヤけたり見切れたりするのを防ぐ
            });

            const clonedParts: any = {};
            const newTextElements: fabric.Object[] = [];

            // 内部パーツ（線、三角形）の役割を再紐付け
            clonedGroup.getObjects().forEach((obj: any, index: number) => {
              if (index === 0) clonedParts.wLine = obj;
              if (index === 1) clonedParts.wLeft = obj;
              if (index === 2) clonedParts.wRight = obj;
              if (index === 3) clonedParts.dLine = obj;
              if (index === 4) clonedParts.dTop = obj;
              if (index === 5) clonedParts.dBottom = obj;
            });

            // ② 連動するテキスト群の復元とルール再適用
            for (const tData of clipboardData.texts) {
              const clonedText = await fabric.IText.fromObject(tData);
              
              // ★修正：既存の数字・ラベルの厳格なルールをコピペ側にも100%強制適用する
              const isNum = tData.text !== 'W: ' && tData.text !== ' / ' && tData.text !== 'D: ' && tData.text !== 'H: ';
              
              clonedText.set({
                originX: 'left',
                originY: 'center',
                hasControls: false,
                hasBorders: false,
                objectCaching: false,
                selectable: false, // バラバラ移動を防ぐ
                evented: isNum,    // 数字だけダブルクリックを受け付ける
                lockMovementX: true,
                lockMovementY: true,
                lockScalingX: true,
                lockScalingY: true,
                lockRotation: true
              });
              
              // 親子関係の再リンク
              (clonedText as any)._parentGroup = clonedGroup;
              (clonedText as any)._isNewLine = tData._isNewLine;
              (clonedText as any)._customTopOffset = tData._customTopOffset;
              
              newTextElements.push(clonedText);
            }

            // 拡張プロパティの再定義
            (clonedGroup as any)._dimensionParts = clonedParts;
            (clonedGroup as any)._dimMode = dimMode;
            clonedParts.textElements = newTextElements;

            // ★修正：既存ルールにのっとり、モードに応じて「伸縮ハンドル（コントロール）」の表示・非表示を再設定する
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

            // ③ キャンバスへ追加
            fabricCanvas.add(clonedGroup);
            newTextElements.forEach(t => fabricCanvas.add(t));

            // 左揃えレイアウトをその場で再計算
            updateCombinedTextPosition(clonedGroup, clonedParts);
            
            // 連動キー入力ロジック（setupSequence）をペーストした新しい文字たちにも再セットアップする
            // ※新規配置時のW・D・H連鎖ロジックをここでも再適用させるため、setupSequenceを動かします。
            // ただし、このままだとsetupSequenceがスコープ外なので、一番手軽なのは既存の「文字変更時イベント」を再バインドすることですが、
            // 今回はペーストされたオブジェクトに対して、外側からテキスト編集イベントを再定義します。
            newTextElements.forEach((textObj: any) => {
              if (textObj.evented) { // 数字オブジェクトの場合
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
            
            saveHistory(fabricCanvas); // ペースト完了後の状態を確定セーブ
            fabricCanvas.requestRenderAll();
          })();
          return;
        }

        // --- 5. 削除処理 (Delete / Backspace) ---
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          const activeObjects = fabricCanvas.getActiveObjects();
          if (activeObjects.length === 0) return;

          saveHistory(fabricCanvas); // 削除前の歴史を保存
          
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
          saveHistory(fabricCanvas); // 削除完了後の歴史を確定
          fabricCanvas.requestRenderAll();
        }
      });
    }

    return () => {
      fabricCanvas.dispose();
    };
  }, []); // コピペデータの更新をキー監視に同期させる

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
      fontSize: 12, fontWeight: 'bold' as const, fill: color, 
      originX: 'left' as const, originY: 'center' as const,
      hasControls: false, hasBorders: false, objectCaching: false,
      lockScalingX: true, lockScalingY: true, lockRotation: true
    };

    const labelStyle = { ...baseStyle, selectable: false, evented: false };
    const numStyle = { ...baseStyle, backgroundColor: 'rgba(255, 255, 255, 0.85)', selectable: false, evented: true, lockMovementX: true, lockMovementY: true };

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

    (group as any)._dimensionParts = dimensionParts;
    (group as any)._dimMode = dimMode;
    dimensionParts.textElements = textElements;
    
    textElements.forEach((t) => {
      (t as any)._parentGroup = group;
    });

    fCanvas.add(group);
    textElements.forEach(t => fCanvas.add(t));

    updateCombinedTextPosition(group, dimensionParts);

    // --- 3. 連動キー入力ロジック ---
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
        
        // 文字入力確定後の状態をセーブ
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
      saveHistory(canvas); // 回転確定後のセーブ
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

    saveHistory(canvas); // 色変更後のセーブ
    canvas.requestRenderAll();
  };

const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canvas) return;

    // ★核心：ファイル選択ボタンから、ブラウザの強力なフォーカスロックを「強制的に剥ぎ取る」
    // これにより、ブラウザのセキュリティガードをバイパスし、後の自動タイピングを100%有効化します
    e.target.blur();

    const reader = new FileReader();
    reader.onload = async (f) => {
      // 差し替えに伴い、キャンバス内の既存の「古い物件名テキスト」を検索して完全に削除
      const existingObjects = canvas.getObjects();
      existingObjects.forEach((obj: any) => {
        if (obj && obj._isPropertyTitle) {
          canvas.remove(obj);
        }
      });

      // 画像のインポートとリサイズ処理
      const img = await fabric.FabricImage.fromURL(f.target?.result as string);
      const scale = Math.min(canvas.width! / img.width!, canvas.height! / img.height!);
      img.scale(scale < 1 ? scale : 1);
      img.set({ left: canvas.width! / 2, top: canvas.height! / 2, originX: 'center', originY: 'center' });
      canvas.backgroundImage = img;
      
      // 履歴スタックを初期化
      undoStack.current = [];
      redoStack.current = [];

      // ★2. 右下に配置する「物件名入力テキストボックス」を新規生成
      const propertyTitle = new fabric.IText('【ここに物件名を入力】', {
        fontSize: 14,
        fontWeight: 'bold',
        fill: '#1f2937', // 高級感のあるダークグレー
        backgroundColor: 'rgba(255, 255, 255, 0.9)', // 図面に被っても読めるように白背景
        padding: 6,
        originX: 'right', // 右下配置なので右揃え
        originY: 'bottom', // 右下配置なので下揃え
        left: canvas.width! - 20, // 右端から20px内側
        top: canvas.height! - 20, // 下端から20px内側
        hasControls: false, // リサイズハンドルは不要
        hasBorders: true,
        borderColor: '#3b82f6', // 編集時にわかりやすい青枠
        cornerSize: 0,
        lockMovementX: false, // 物件名は図面に応じて位置を微調整できるように移動は許可
        lockMovementY: false,
      });

      // 特製識別フラグを付与（次回画像インポート時の削除用、およびUndo/Redo保存用）
      (propertyTitle as any)._isPropertyTitle = true;

      // ★追加：物件名テキストに専用のキーボード挙動（Enterで確定、Shift+Enterで改行）を仕込む
      propertyTitle.onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          if (e.shiftKey) {
            // ① Shift + Enter の場合は、最新の Fabric.js (v6) の仕様に合わせて安全に改行を挿入する
            (propertyTitle as any).insertChars('\n');
            propertyTitle.canvas?.requestRenderAll();
            return;
          } else {
            // ② 単なる Enter の場合は、標準の改行をキャンセルし、編集を終了（確定）させる
            e.preventDefault();
            propertyTitle.exitEditing(); 
            return;
          }
        }
        // Enter以外のキー（文字のタイピングなど）は、本来のITextの処理にそのまま流す
        fabric.IText.prototype.onKeyDown.call(propertyTitle, e);
      };

      // キャンバスへ追加
      canvas.add(propertyTitle);
      saveHistory(canvas);
      canvas.renderAll();

      // ★核心：配置された瞬間に、即座にフォーカスを奪って自動入力を開始させる
      setTimeout(() => {
        // ① まずブラウザのフォーカスを`<input>`ボタンからキャンバスへ強制的に引っ張ってくる
        canvas.getSelectionElement().focus();

        // ② その上でテキストを編集モード＆全選択状態にする
        canvas.setActiveObject(propertyTitle);
        propertyTitle.enterEditing();
        propertyTitle.selectAll();
        canvas.requestRenderAll();
      }, 300); // 念のため、画像配置から少し時間差を空けて確実にフォーカスさせる
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