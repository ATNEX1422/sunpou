"use client";

import React, { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';

const FloorPlanEditor = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
  const [isPlacing, setIsPlacing] = useState<boolean>(false);
  const [dimMode, setDimMode] = useState<'W' | 'W_D' | 'W_H' | 'W_D_H'>('W');

  useEffect(() => {
    if (!canvasRef.current) return;

    const fabricCanvas = new fabric.Canvas(canvasRef.current, {
      width: 800,
      height: 600,
      backgroundColor: '#f3f4f6',
      centeredScaling: true,
    });

    // ★共通ヘルパー：オブジェクトの回転・サイズに合わせてテキストを常に「右上45度」へ正確に回り込ませる
    const updateCombinedTextPosition = (target: fabric.Group, parts: any) => {
      if (!parts || !parts.combinedText) return;

      const angleRad = (target.angle || 0) * (Math.PI / 180);
      
      // 十字の中心からテキストまでの距離（サイズに応じて外側に逃がす）
      const offsetX = (target.width / 2) + 20;
      const offsetY = (target.height / 2) + 20;

      // 0度のときの理想の位置（右上45度：Xはプラス、Yはマイナス）
      const localX = offsetX;
      const localY = -offsetY;

      // 回転行列を使って、グループが回転した後の世界でのテキストの絶対座標を計算
      const rotatedX = target.left! + (localX * Math.cos(angleRad) - localY * Math.sin(angleRad));
      const rotatedY = target.top! + (localX * Math.sin(angleRad) + localY * Math.cos(angleRad));

      parts.combinedText.set({
        left: rotatedX,
        top: rotatedY,
      });
      parts.combinedText.setCoords();
    };

    // 1. 移動時の追従
    fabricCanvas.on('object:moving', (options: any) => {
      const target = options.target;
      if (!target || !(target instanceof fabric.Group)) return;
      updateCombinedTextPosition(target, (target as any)._dimensionParts);
      fabricCanvas.requestRenderAll();
    });

    // 2. 伸縮時の追従（後半のテキスト追従部分をヘルパーに差し替え）
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
        parts.wText.set({ left: 0, scaleX: 1, scaleY: 1 });
        parts.wLine.setCoords(); parts.wLeft.setCoords(); parts.wRight.setCoords(); parts.wText.setCoords();
      }

      if (parts.dLine && sY !== 1) {
        const newHeight = currentGroupHeight;
        parts.dLine.set({ height: newHeight });
        const halfHeight = newHeight / 2;
        parts.dTop.set({ top: -halfHeight, scaleX: 1, scaleY: 1 });
        parts.dBottom.set({ top: halfHeight, scaleX: 1, scaleY: 1 });
        if (parts.dText) parts.dText.set({ top: 0, scaleX: 1, scaleY: 1 });
        parts.dLine.setCoords(); parts.dTop.setCoords(); parts.dBottom.setCoords(); if (parts.dText) parts.dText.setCoords();
      }

      target.set({ width: currentGroupWidth, height: currentGroupHeight, scaleX: 1, scaleY: 1 });

      // ★追加したヘルパーで位置を精密計算
      updateCombinedTextPosition(target, parts);

      target.setCoords();
      fabricCanvas.requestRenderAll();
    });

    // 3. 回転時の制御（水平を維持しつつ、位置もぐるっと追従させる）
    fabricCanvas.on('object:rotating', (options: any) => {
      const target = options.target;
      if (!target || !(target instanceof fabric.Group)) return;

      const rawEvent = options.e as MouseEvent;
      if (rawEvent && rawEvent.shiftKey) {
        const snapAngle = 15;
        const currentAngle = target.angle || 0;
        target.set('angle', Math.round(currentAngle / snapAngle) * snapAngle);
      }

      const targetAngle = target.angle || 0;
      
      // グループ内の全テキストの角度を逆相殺（画面に対して常に真っ直ぐ水平を維持）
      target.getObjects().forEach((obj: any) => {
        if (obj instanceof fabric.IText) {
          obj.set('angle', -targetAngle);
        }
      });

      const parts = (target as any)._dimensionParts;
      if (parts && parts.combinedText) {
        // ★修正：グループ外なので相殺は不要。常に画面に対して「0度（真っ直ぐ）」を指定する
        parts.combinedText.set('angle', 0);
        
        // 回転した角度に合わせて、位置も右上45度の軌道へ回り込ませる
        updateCombinedTextPosition(target, parts);
      }

      fabricCanvas.requestRenderAll();
    });

    // 4. グループを解除せずに内部のテキストを直接編集する
    fabricCanvas.on('mouse:dblclick', (options) => {
      const target = options.target;
      
      if (target instanceof fabric.Group && (target as any)._dimensionParts) {
        const { text } = (target as any)._dimensionParts;

        // グループを維持したまま子要素へのアクセスを許可する
        target.subTargetCheck = true; 
        fabricCanvas.setActiveObject(text);
        
        text.enterEditing();
        text.selectAll();
        fabricCanvas.renderAll();

// 編集が終了した時の処理
        const handleExit = () => {
          text.off('editing:exited', handleExit);
          
          text.setCoords(); 

          // ★修正：left: 0 を削除し、現在の位置（45度オフセットなど）を維持させる
          text.set({
            originX: 'center',
            originY: 'center', // 念のため追加
            textAlign: 'center',
          });
                    
          target.subTargetCheck = false;
          
          // 親グループ自体の幅を最新の文字サイズなども加味して再計算
          target.setCoords(); 
          
          fabricCanvas.setActiveObject(target);
          fabricCanvas.renderAll();
        };
        text.on('editing:exited', handleExit);
      }
    });

    setCanvas(fabricCanvas);

    // ★配置トリガーをキャッチして生成し、モードを解除する

    const handleKeyDown = (e: KeyboardEvent) => {
      const active = fabricCanvas.getActiveObject();
      if (active && (active as any).isEditing) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeObjects = fabricCanvas.getActiveObjects();
        activeObjects.forEach(obj => {
          fabricCanvas.remove(obj);
        });
        
        fabricCanvas.discardActiveObject();
        fabricCanvas.renderAll();
      }
    };

// ★修正：タイピングミスを修正し、純粋な座標データを渡す
    fabricCanvas.on('mouse:down', (options) => {
      if (!(fabricCanvas as any)._isPlacingMode) return;

const pointer = fabricCanvas.getScenePoint(options.e);
      if (pointer) {
        // ★修正：キャンバスに記憶させておいた最新のモードを取得
        const currentMode = (fabricCanvas as any)._currentDimMode || 'W';
        
        // 生成ロジックに現在のモードを伝える（※このあと引数を受け取れるように関数側も1文字直します）
        createDimensionAtPosition(fabricCanvas, pointer.x, pointer.y, '#ef4444', currentMode);

        // 2. 配置待機モードを即座に解除
        (fabricCanvas as any)._isPlacingMode = false;
        setIsPlacing(false);
        fabricCanvas.defaultCursor = 'default';
        
        // 3. 全オブジェクトの選択機能を元に戻す
        fabricCanvas.getObjects().forEach(obj => {
          obj.selectable = true;
          obj.evented = true;
        });
        
        fabricCanvas.renderAll();
      }
    });    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      fabricCanvas.dispose();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

const createDimensionAtPosition = (
    fCanvas: fabric.Canvas, 
    x: number, 
    y: number, 
    color: string = '#ef4444', 
    currentMode: 'W' | 'W_D' | 'W_H' | 'W_D_H' = 'W'
  ) => {    

    const dimMode = currentMode;

    const length = 150;
    const arrowSize = 10;
    const objectsToGroup: fabric.Object[] = [];
    const dimensionParts: any = {};

    // --- 1. W（幅）方向の寸法線生成（全モード共通） ---
    const wLine = new fabric.Line([-length / 2, 0, length / 2, 0], {
      stroke: color, strokeWidth: 2, originX: 'center', originY: 'center',
    });
    const wLeft = new fabric.Triangle({
      width: arrowSize, height: arrowSize, fill: color, angle: -90, originX: 'center', originY: 'center', left: -length / 2
    });
    const wRight = new fabric.Triangle({
      width: arrowSize, height: arrowSize, fill: color, angle: 90, originX: 'center', originY: 'center', left: length / 2
    });

    let wTextString = 'W: 00';
    if (dimMode === 'W_H') wTextString = 'W: 00\nH: 00';
    // ★追加：W_D_Hのときは、ここにすべての情報を美しく集約する
    if (dimMode === 'W_D_H') wTextString = 'W: 00 / D: 00\nH: 00';

    const wText = new fabric.IText(wTextString, {
      fontSize: 16, fontWeight: 'bold', fill: color, backgroundColor: 'rgba(255, 255, 255, 0.8)',
      originX: 'center', originY: 'center', top: -25, textAlign: 'center',
    });

    objectsToGroup.push(wLine, wLeft, wRight, wText);
    dimensionParts.wLine = wLine;
    dimensionParts.wLeft = wLeft;
    dimensionParts.wRight = wRight;
    dimensionParts.wText = wText;
    // 後チャネルでダブルクリック時にどれをアクティブにするかの参照用
    dimensionParts.text = wText; 

    // --- 2. D（奥行き）方向の寸法線生成（W_D, W_D_H のみ：十字化） ---
    if (dimMode === 'W_D' || dimMode === 'W_D_H') {
      const dLine = new fabric.Line([0, -length / 2, 0, length / 2], {
        stroke: color, strokeWidth: 2, originX: 'center', originY: 'center',
      });
      const dTop = new fabric.Triangle({
        width: arrowSize, height: arrowSize, fill: color, angle: 0, originX: 'center', originY: 'center', top: -length / 2
      });
      const dBottom = new fabric.Triangle({
        width: arrowSize, height: arrowSize, fill: color, angle: 180, originX: 'center', originY: 'center', top: length / 2
      });

// --- 2. D（奥行き）方向の寸法線生成（W_D, W_D_H のみ：十字化） ---
    if (dimMode === 'W_D' || dimMode === 'W_D_H') {
      // 既存のW用テキスト(wText)は今回のモードでは不要なのでグループから除外
      const wTextIndex = objectsToGroup.indexOf(wText);
      if (wTextIndex > -1) objectsToGroup.splice(wTextIndex, 1);

      // 縦線（D）の生成
      const dLine = new fabric.Line([0, -length / 2, 0, length / 2], {
        stroke: color, strokeWidth: 2, originX: 'center', originY: 'center',
        height: length
      });
      const dTop = new fabric.Triangle({
        width: arrowSize, height: arrowSize, fill: color, angle: 0, originX: 'center', originY: 'center', top: -length / 2
      });
      const dBottom = new fabric.Triangle({
        width: arrowSize, height: arrowSize, fill: color, angle: 180, originX: 'center', originY: 'center', top: length / 2
      });

      // 線と矢印だけをまずグループのベースに追加
      objectsToGroup.push(dLine, dTop, dBottom);
      dimensionParts.dLine = dLine;
      dimensionParts.dTop = dTop;
      dimensionParts.dBottom = dBottom;

      // ★統一デザイン：W, D, (H) をすべて集約した「統合テキスト」を斜め上45度に配置
      let combinedTextString = 'W: 00 / D: 00';
      if (dimMode === 'W_D_H') {
        combinedTextString = 'W: 00 / D: 00\nH: 00';
      }

const combinedText = new fabric.IText(combinedTextString, {
        fontSize: 10,
        fontWeight: 'bold',
        fill: color,
        backgroundColor: 'rgba(255, 255, 255, 0.85)',
        originX: 'center',
        originY: 'center',
        // ★修正：テキストを少しだけ遠くへ逃がす（引き出し線効果もアップ）
        left: 100,
        top: -100,
        textAlign: 'center',
      });
      
      // ガードロジック（数字以外を消させない処理）
      combinedText.on('changed', () => {
        const textStr = combinedText.text;
        if (dimMode === 'W_D_H') {
          const lines = textStr.split('\n');
          const wdPart = lines[0] || 'W: 00 / D: 00';
          const hPart = lines[1] || 'H: 00';
          
          const wdNums = wdPart.replace(/[^0-9]/g, '');
          const hNums = hPart.replace(/[^0-9]/g, '');
          
          // 前半の2つに切り分ける
          const wNum = wdNums.substring(0, wdNums.length / 2) || '00';
          const dNum = wdNums.substring(wdNums.length / 2) || '00';
          
          combinedText.text = `W: ${wNum} / D: ${dNum}\nH: ${hNums || '00'}`;
        } else {
          const numbers = textStr.replace(/[^0-9]/g, '');
          const wNum = numbers.substring(0, numbers.length / 2) || '00';
          const dNum = numbers.substring(numbers.length / 2) || '00';
          combinedText.text = `W: ${wNum} / D: ${dNum}`;
        }
      });

      // グループとパーツ参照に統合テキストを登録
      dimensionParts.text = combinedText; // ダブルクリック編集の対象をこれに差し替え
      dimensionParts.combinedText = combinedText;
    }    }

// --- 3. グループ化とコントロール制御 ---
    // 十字モード（W_D, W_D_H）のときは、斜め上のテキストのせいで枠が歪まないよう、サイズを線の長さ(150)に強制指定する
// --- 3. グループ化とコントロール制御 ---
    const group = new fabric.Group(objectsToGroup, {
      left: x, top: y, originX: 'center', originY: 'center', objectCaching: false,
    });

    (group as any)._dimensionParts = dimensionParts;
    (group as any)._dimMode = dimMode; 

    // ★追加：十字モードの時だけ、統合テキストをキャンバスに直接乗せる
    if (dimMode === 'W_D' || dimMode === 'W_D_H') {
      fCanvas.add(dimensionParts.combinedText);
    }

    // 十字か単線かでリサイズハンドルを切り替える
    if (dimMode === 'W' || dimMode === 'W_H') {
      group.setControlsVisibility({
        mt: false, mb: false, ml: true, mr: true, bl: false, br: false, tl: false, tr: false, mtr: true,
      });
      group.lockScalingY = true;
    } else {
      // 十字の場合は上下（Dの伸縮）と左右（Wの伸縮）の両方を許可する
      group.setControlsVisibility({
        mt: true, mb: true, ml: true, mr: true, bl: false, br: false, tl: false, tr: false, mtr: true,
      });
    }

    fCanvas.add(group);
    fCanvas.setActiveObject(group);
    
// --- 4. 配置直後に自動編集モードへ入る ---
    setTimeout(() => {
      // 十字モードの時は、ここで確実にテキストの位置を斜め上45度に同期・確定させる
      if (dimMode === 'W_D' || dimMode === 'W_D_H') {
        if (dimensionParts.combinedText) {
          dimensionParts.combinedText.set({
            left: group.left + (group.width / 2) + 15,
            top: group.top - (group.height / 2) - 15,
          });
          dimensionParts.combinedText.setCoords();
        }
      }

      const activeText = dimensionParts.combinedText || wText;
      if (!activeText) return;

      // 十字モード（グループ外テキスト）と通常モードでフラグを切り替える
      if (dimMode === 'W_D' || dimMode === 'W_D_H') {
        group.subTargetCheck = false; // グループ外なのでfalseでOK
      } else {
        group.subTargetCheck = true;
      }

      // エラーの原因だった bringToFront は完全削除し、そのままアクティブ化
      fCanvas.setActiveObject(activeText);
      activeText.enterEditing();
      activeText.selectAll(); 
      
      // キャンバス全体を強制的に今すぐ再描画（これでテキストが一瞬で画面に映る）
      fCanvas.requestRenderAll();

      const handleExit = () => {
        activeText.off('editing:exited', handleExit);
        activeText.setCoords();
        
        activeText.set({ 
          originX: 'center', 
          originY: 'center',
          textAlign: 'center' 
        });
        
        group.subTargetCheck = false;
        group.setCoords();
        
        // 編集完了後は、十字グループを選択状態に戻す
        fCanvas.setActiveObject(group);
        fCanvas.requestRenderAll();
      };
      activeText.on('editing:exited', handleExit);
    }, 50);    
    fCanvas.renderAll();
  };
  
  // ★ボタンを押した時は「生成」ではなく「配置待機モードの切り替え」にする
  const addDimension = () => {
    if (!canvas) return;

    (canvas as any)._currentDimMode = dimMode;

    const nextMode = !isPlacing;
    setIsPlacing(nextMode);
    (canvas as any)._isPlacingMode = nextMode;

    if (nextMode) {
      canvas.defaultCursor = 'crosshair'; // 十字カーソルにする
      // 配置中の誤操作を防ぐため、既存オブジェクトを一時的に選択不可にする
      canvas.getObjects().forEach(obj => {
        obj.selectable = false;
        obj.evented = false;
      });
      canvas.discardActiveObject();
    } else {
      canvas.defaultCursor = 'default';
      canvas.getObjects().forEach(obj => {
        obj.selectable = true;
        obj.evented = true;
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
        active._dimensionParts.text.set('angle', -newAngle);
      }
      canvas.renderAll();
    }
  };

  const changeSelectedColor = (newColor: string) => {
    if (!canvas) return;
    canvas.getActiveObjects().forEach((obj: any) => {
      if (obj._dimensionParts) {
        const { line, leftArrow, rightArrow, text } = obj._dimensionParts;
        line.set('stroke', newColor);
        leftArrow.set('fill', newColor);
        rightArrow.set('fill', newColor);
        text.set('fill', newColor);
        canvas.renderAll();
      }
    });
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
            <button 
              onClick={() => setDimMode('W')} 
              className={`px-3 py-1.5 rounded-md transition ${dimMode === 'W' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
            >
              ↔ W
            </button>
            <button 
              onClick={() => setDimMode('W_D')} 
              className={`px-3 py-1.5 rounded-md transition ${dimMode === 'W_D' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
            >
              ✛ W×D
            </button>
            <button 
              onClick={() => setDimMode('W_H')} 
              className={`px-3 py-1.5 rounded-md transition ${dimMode === 'W_H' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
            >
              ↔ W×H
            </button>
            <button 
              onClick={() => setDimMode('W_D_H')} 
              className={`px-3 py-1.5 rounded-md transition ${dimMode === 'W_D_H' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
            >
              ✛ W×D×H
            </button>
          </div>

        <button 
          onClick={addDimension} 
          className={`px-4 py-2 rounded-lg transition font-medium shadow-sm ${
            isPlacing 
              ? 'bg-amber-500 text-white animate-pulse ring-2 ring-amber-300' 
              : 'bg-green-600 text-white hover:bg-green-700' 
          }`}
        >
          {isPlacing ? '寸法追加' : '寸法追加'}
        </button>

        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          <button onClick={() => rotateSelected(-90)} className="p-2 hover:bg-white rounded-md transition shadow-sm" title="左90度回転">↺</button>
          <button onClick={() => rotateSelected(90)} className="p-2 hover:bg-white rounded-md transition shadow-sm" title="右90度回転">↻</button>
        </div>
        <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
          {['#ef4444', '#3b82f6', '#22c55e'].map(c => (
            <button key={c} onClick={() => changeSelectedColor(c)} className="w-8 h-8 rounded-md" style={{ backgroundColor: c }} />
          ))}
        </div>
        <button onClick={() => {
          if (canvas) {
            const dataURL = canvas.toDataURL({ format: 'jpeg', quality: 0.8, multiplier: 1 });
            const link = document.createElement('a');
            link.download = 'floorplan-dim.jpg';
            link.href = dataURL;
            link.click();
          }
        }} className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-black transition font-medium ml-auto">保存 (JPEG)</button>
      </div>

      <div className="border-4 border-white shadow-2xl rounded-lg overflow-hidden bg-white">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};

export default FloorPlanEditor;
