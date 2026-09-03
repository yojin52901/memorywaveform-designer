---
status: ready-for-agent
title: 可調整 waveform slot 寬度
---

## 問題與目標

目前 SVG renderer 將每個 timeline gap 固定畫為 150 SVG units。當 waveform 需要凸顯特定 interval 時，designer 只能改變 transition 的 order slot，這會改變工程順序並可能影響 timing 與 phase reference。

本功能允許 designer 以拖曳方式調整各 gap 的**視覺寬度**。寬度是可匯出、可回匯的 presentation 資訊；它不代表實際時間，也不改變 marker sequence、timing rule、phase 或任何 semantic ID reference。

## 使用者故事

1. 作為 memory designer，我想拖曳 timeline gap 上方的 handle 調整該 gap 的寬度，讓重要區段更容易閱讀。
2. 作為 memory designer，我想在拖曳期間立即看到右側 marker、signal segment、transition 與 state label 一起重新定位，讓我能精準決定版面。
3. 作為 memory designer，我想讓 timing parameter 的箭頭、端點與所有垂直 connector 隨 marker 同步移動，讓 waveform 關係在調整中始終正確可讀。
4. 作為 memory designer，我想讓 phase interval 與其 label 隨兩端 marker 同步重新定位，讓 phase 不會與 waveform 脫節。
5. 作為 memory designer，我想放開滑鼠後將寬度記錄在 JSON presentation，讓下次開啟與 PNG 匯出維持相同排版。
6. 作為 memory designer，我想取消一次 resize drag 時完全恢復舊版面，避免未確認的 presentation 變更寫入 history。
7. 作為 memory designer，我想在仍使用舊 JSON 的情況下看到原本等寬的 waveform，讓此功能不破壞既有文件。
8. 作為 memory designer，我想在調整寬度後繼續拖曳 transition 或 marker 並命中正確的視覺 slot，讓既有編輯手勢保持可靠。
9. 作為 downstream consumer，我想保證 slot 寬度不改變 semantic transition order 或 timing relation，讓下游仍只依 sequence 與 ID reference 判讀工程內容。

## 資料契約

新增可選的 `presentation.slotWidthUnits` object。key 為某個 gap 的左側 boundary ID：第一個 gap 使用 `timelineStart`，後續 gap 使用其左側 time marker ID。value 是有限數字的視覺寬度倍率。

- 未設定某 key 時使用 `1`，即既有 150 SVG-unit 等寬 gap。
- 可設定範圍為 `0.4..4`；renderer 將其乘上 base gap，形成最小 60 與最大 600 SVG units。
- `timelineEnd` 不得成為 key，因為它沒有右側 gap。
- value 不是 pixel x/y 或實際時間；它只描述相對 layout 寬度。
- 擴充維持 schema `1.1`。舊文件不須 migration；缺欄位代表全部 gap 使用預設寬度。
- validator 對存在的欄位要求 object、合法 boundary key 與範圍內有限數字。建立、移動或刪除 marker 的 domain operation 必須清理失效 key；新 gap 省略 key 以使用預設值。

## Renderer 與互動設計

renderer 會集中計算 ordered boundary 的 x layout，供 signal row、marker column、timing lane、phase lane 與 state label 共用。所有 x 位置必須從同一份 layout 取得，不可另行以 marker index 推算。

每個 gap 的右側 boundary 上方 render 一個可命中的水平 resize handle，並提供其左 boundary ID、初始寬度與幾何資料。handle 的 hit target 與 marker column 分離，pointerdown 優先辨識 resize，避免與 marker move 手勢衝突。

拖曳 handle 時：

1. controller 以 pointer 的 SVG x 座標計算受調 gap 的暫態 width unit，並 clamp 到 `0.4..4`。
2. controller 以暫態 layout 重畫 waveform canvas；不修改 document、history 或 validation 狀態。
3. 所有在受調 gap 右側的 marker 平移；其 signal path、transition target、segment label、timing connector/arrow/label/endpoint、phase interval/label 全部由新的 marker x 投影。
4. pointerup 才以 domain operation 將 width unit 寫入 presentation，產生一次 history snapshot；pointercancel 則捨棄暫態 layout。

`sequenceFromPointer` 必須從 renderer 提供的 layout 讀取位置，而非假設固定 150-unit gap，確保 resize 後的 transition／marker drag 仍與可見 slot 對齊。

## 模組邊界

- `src/domain/document.js`：新文件初始化空的 `slotWidthUnits` presentation object。
- `src/domain/operations.js`：提供只修改 presentation 的設定 slot 寬度 operation，並在 marker lifecycle 時清理失效 key。
- `src/domain/validate.js`：驗證 optional slot-width presentation contract。
- `src/render/svg-renderer.js`：建立唯一 timeline layout seam，render resize handle 與 layout metadata，並接受暫態 width override 供 preview 使用。
- `src/ui/controller.js`：新增 slot-width drag lifecycle、preview canvas rerender、layout-aware pointer conversion 與 drag feedback。
- `docs/spec.md`、README：明確說明 slot 寬度為非語意 presentation。

## 測試決策

以現有 Node integration seams 驗證公開行為：

1. renderer 測試自訂 gap 寬度後，marker、signal segment、transition、timing connector/arrow 與 phase endpoint 使用同一組更新後 x 值。
2. controller drag lifecycle 測試連續 pointermove 立即更新 preview；pointerup 僅提交一次 presentation 變更；pointercancel 不修改 document。
3. controller 測試 resize 後 transition/marker drag 的 pointer x 仍解析到正確 target slot。
4. document/validator/import-export 測試新文件預設、JSON round-trip、舊文件缺欄位相容、無效 key/value 拒絕，以及 marker 刪除後清理失效 key。
5. 保留並重跑完整 suite、JavaScript syntax、browser module graph、build 與 whitespace checks。

## 非目標

- 不將寬度轉換為 ns、clock cycle、比例時間或 timing-rule calculation。
- 不新增 zoom、pan、ruler tick、自由 pixel positioning 或拖曳改變 marker sequence 的新語意。
- 不修改 timing parameter endpoint、phase endpoint、annotation anchor 或任何 semantic object ID。
- 不提供 Inspector 的數值欄位、reset-all 控制或自動依 requirement text 計算寬度。
