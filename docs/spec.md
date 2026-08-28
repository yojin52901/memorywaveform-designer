---
status: ready-for-agent
labels: [ready-for-agent]
title: 結構化 Memory Waveform Editor MVP
---

## 問題描述

Memory waveform 常以 PNG、PDF 或截圖交換。下游若要取得 signal state transition、timing parameter 與其關係，只能從像素猜測：箭頭可能連錯 edge、文字可能對錯區段，且版面變動也可能改變模型判讀。這不可靠、不可稽核，也無法成為 timing-rule engine、知識庫或後續程式生成的穩定輸入。

Designer 需要一個以 waveform domain 為中心的 GUI：畫圖時直接建立 signal、state segment、transition、timing parameter、phase 與 annotation 等工程物件。系統必須由同一份結構化文件生成畫面、PNG 與 JSON，而不是畫完圖再從圖片回推 JSON。

## 解決方案

建立靜態瀏覽器型 **Structured Memory Waveform Editor**。它以語意資料模型作為唯一 source of truth；SVG waveform 與 PNG 都是此模型的投影。JSON 為可回匯、可版本控管、可交給下游程式消費的文件格式。

第一版採用**位置與順序時間軸**：由左至右的 time marker sequence 表示 transition 發生順序。畫面距離與 arrow 長度不代表實際時間。`tWP >= 20 ns` 等數值屬於 timing parameter 的工程規則／註記，不會改變 marker 間距或圖上的 interval 長度。

MVP 優先服務新建 waveform spec 與設計 review；不處理既有 PNG/PDF 的 OCR 或 VLM 轉換。

## 名詞與核心原則

- **Signal**：畫布上的一列（row），可自訂名稱與 type。
- **State segment**：signal 在兩個 timeline boundary 間的狀態區段。
- **Transition**：相鄰 state segment 狀態不同時，在共同邊界產生的事件。它可選取、可引用，但由 segment 推導。
- **Time marker**：一條垂直 column，代表 left-to-right 順序中的一個位置；可包含多個同步 transition。
- **Timing parameter**：由起始與結束 transition 定義的可重疊區段，例如 `tWP`。
- **Phase**：由兩個 transition 定義的操作階段，例如 `Program`；可重疊與巢狀。
- **Presentation**：row 順序與 timing lane 順序等顯示偏好；不影響工程語意。

所有語意關係都必須使用 immutable object ID reference。名稱只是可修改的顯示欄位；canvas pixel 不得成為 JSON 或下游判讀依據。

## 使用者故事

1. 作為 memory designer，我想建立帶有 title、operation、description、memory technology 與 tags 的 waveform 文件，讓下游不看圖也能理解工程背景。
2. 作為 memory designer，我想新增、重新命名與刪除 signal row，讓圖可表示任意操作所需訊號。
3. 作為 memory designer，我想指定 signal 的 type、subtype 與 tags，讓下游能區分 control、power、data、clock 與自訂訊號。
4. 作為 memory designer，我想指定 initial state，讓第一個 transition 前的波形具明確語意。
5. 作為 memory designer，我想以 HIGH、LOW、UNKNOWN 與 UNSPECIFIED 表達 state，讓未知值與尚未建模的範圍不被混淆。
6. 作為 memory designer，我想直接建立及調整 state segment，讓 waveform 由工程狀態而非 pixel path 構成。
7. 作為 memory designer，我想在 state 邊界取得穩定的 transition ID，讓 timing parameter 能精準引用轉折點。
8. 作為 memory designer，我想讓多個 signal transition 位於同一 time marker，表示它們在同一 column 同步發生。
9. 作為 memory designer，我想拖動整個 marker 來移動所有同步 transition，讓同步語意不被意外拆散。
10. 作為 memory designer，我想拖動單一 transition 到新 marker 或既有 marker，讓單一訊號能調整位置。
11. 作為 memory designer，我想用拖拉或兩次點選，從一個 transition 指向另一個 transition 建立 timing parameter。
12. 作為 memory designer，我想讓多個 timing parameter 共用 endpoint 且能重疊，讓複雜 timing relation 可被完整表達。
13. 作為 memory designer，我想為 timing parameter 填寫自由格式註解，記錄 datasheet requirement 或工程備註，但不影響文件有效性。
14. 作為 memory designer，我想建立由兩個 transition 定義的 phase，並允許 phase 巢狀或重疊，讓 operation context 可被標示。
15. 作為 memory designer，我想將 annotation 錨定在文件、signal、transition、parameter 或 phase，讓 review 語境可與正確物件一起保存。
16. 作為 memory designer，我想拖拉 state segment 的邊界時同步更新相鄰 segment 與 transition，避免資料矛盾。
17. 作為 memory designer，我想在刪除被引用 transition 前看到所有依賴物件，讓我能取消或安全地級聯刪除。
18. 作為 memory designer，我想在匯出前看到 validation 結果，避免不完整或不可解析資料進入下游。
19. 作為 memory designer，我想匯出 validated JSON 與對應 PNG，讓文件同時可供自動化與設計文件使用。
20. 作為 memory designer，我想將平台輸出的 JSON 再匯入並續編，讓 JSON 成為唯一的版本控管工程檔。
21. 作為 downstream timing-rule developer，我想取得正規化 ID reference、transition 順序與可解析 requirement，讓程式不需要解析圖片。
22. 作為知識庫或 LLM 使用者，我想取得 metadata、signal type、phase、annotation 與 timing relationship，讓檢索與審查有足夠語境。
23. 作為 reviewer，我想在一般編輯有錯時匯出帶水印 PNG 草稿，讓討論不必等待所有規則完成。
24. 作為 designer，我想在匯入錯誤 JSON 時進入不渲染的修復模式，讓錯誤資料不會被誤畫成正確 waveform。

## 實作決策

### 應用邊界與資料流

MVP 為不需帳號、資料庫、API key 或 build pipeline 的靜態瀏覽器應用。瀏覽器記憶體中的 waveform document 是編輯中的 canonical model；pure renderer 由它生成 SVG，PNG 由 SVG rasterization 取得。JSON 匯出序列化同一份 validated snapshot。

資料流為：Designer 操作 palette、canvas 與 inspector → document model 維護 segment、derived transition 與 reference → validator 判定可匯出／草稿／修復狀態 → renderer 只讀取有效 model 與 presentation → SVG／PNG／JSON 由同一份快照產生。renderer 沒有修改工程語意的權限。

### Signal 與 state segment

Signal 的主要 type 固定為 `control`、`power`、`data`、`clock`、`custom`；designer 可補充自由的 `subtype` 與 `tags`。所有 signal 第一版共用狀態集合：`HIGH`、`LOW`、`UNKNOWN`、`UNSPECIFIED`。

新增 signal 時，designer 選擇 `initialState`；系統從 timeline start 到 timeline end 建立初始 state segment。每個 signal 的 segment 在有效文件中必須覆蓋整個 timeline，不可重疊。尚未描述範圍必須明確成為 `UNSPECIFIED` segment，視覺上可畫為淡灰空白；它不等同於明確不確定值 `UNKNOWN`。

Segment 的 start 與 end 一律 reference timeline boundary 或 time marker。拖動共享邊界時，左右相鄰 segment 同步變更範圍；不允許留下 gap 或同一邊界有兩套互相矛盾的資料。

### Transition 與 time marker

Transition 由同一 signal 在相鄰 segment 邊界的 state 差異推導。`LOW -> HIGH` 為 rising、`HIGH -> LOW` 為 falling，其餘狀態變更為 general state change。Transition 擁有穩定 immutable ID，可被選取、拖動與引用；但它的 `fromState`、`toState` 與 marker 必須能由相鄰 segment 驗證。

Timeline 固定包含 `timelineStart` 與 `timelineEnd`。除兩個固定 boundary 外，每個 time marker 都必須至少包含一個 transition；畫面 grid、zoom 與 marker 的 x pixel 不寫入 semantic JSON。

每個 marker 具有唯一 `sequence`，它是 transition 左到右順序的唯一真相。同 marker 的 transition 視為同步，不得捏造彼此的先後。第一版不儲存 marker 實際物理時間或 unit；不比較 marker 間距，也不從它推算 timing requirement。

拖動 marker 會移動其全部 transition。拖動單一 transition 時，系統將它移至既有 marker 或建立新 marker，並同步調整該 signal 的相鄰 segment。若 marker 因此沒有任何 transition，系統移除它。無關物件的 ID 與 reference 必須保持不變。

### Timing parameter 與 phase

Timing parameter 必須 reference 兩個不同 transition：`startTransitionId` 與 `endTransitionId`。兩 endpoint 的 marker sequence 必須嚴格由左至右；同 marker 或反向 endpoint 是 validation error。start 與 end 可來自同一或不同 signal。多個 parameter 可自由重疊，也可共用任一 endpoint。

建立 parameter 時支援兩種等價手勢：

- 從 palette 拖出物件，端點依序吸附起始與結束 transition。
- 先點選起始 transition，再點選結束 transition。

拖動 parameter 端點只會重新綁定其 start 或 end transition；絕不移動 signal、segment、marker 或其他 parameter。畫面 interval 與 arrow 由 endpoint marker sequence 推導。

Timing parameter 可填入選填的 `requirementText`，第一版將它視為純文字註解。內容可使用任意格式，不解析、不驗證，也不產生 warning 或 invalid；因此不會阻擋 waveform、PNG 或 JSON 匯出。為相容舊資料，匯入時可保留既有 `parsedRequirement`，但平台不使用它判斷有效性；新建或編輯後固定輸出 `parsedRequirement: null` 與 `validationStatus: "note"`。

Phase 沒有 timing rule text，但同樣必須由兩個左到右的 transition endpoint 定義。Phase 可以重疊與巢狀，名稱與 tags 描述 operation context。

### Annotation、metadata 與 presentation

文件 metadata 必填 `title`；可選 `operation`、`description`、`memoryTechnology` 與 `tags`。Annotation 保存描述文字與 anchor reference；anchor 可指向 document、signal、transition、timing parameter 或 phase。Annotation 不是 machine-verifiable timing rule。

JSON 可保留選填 `presentation`，以支援回匯後的相同 review 排版，例如 signal row order、timing lane order、折疊狀態與顯示偏好。presentation 不得含 object pixel x/y，也不得改變任何工程意義。

### JSON 傳遞契約

匯出採用單一、正規化文件，並以 `schemaVersion` 標示相容性。主要物件位於獨立 collection，以 immutable ID reference 連結；不使用名稱作為主鍵，也不複製巢狀資料作為第二份真相。

```json
{
  "schemaVersion": "1.0",
  "metadata": {
    "title": "Program waveform",
    "operation": "program",
    "tags": ["NVM", "write"]
  },
  "semantic": {
    "signals": [
      {
        "id": "sig_we",
        "name": "WE#",
        "type": "control",
        "subtype": "write-enable",
        "tags": ["active-low"],
        "initialState": "HIGH"
      }
    ],
    "timeline": {
      "startMarkerId": "tm_start",
      "endMarkerId": "tm_end",
      "timeMarkers": [
        {
          "id": "tm_10",
          "sequence": 10,
          "transitionIds": ["tr_we_fall", "tr_ce_fall"]
        },
        {
          "id": "tm_20",
          "sequence": 20,
          "transitionIds": ["tr_we_rise"]
        }
      ]
    },
    "stateSegments": [
      {
        "id": "seg_we_high_1",
        "signalId": "sig_we",
        "startMarkerId": "tm_start",
        "endMarkerId": "tm_10",
        "state": "HIGH"
      },
      {
        "id": "seg_we_low",
        "signalId": "sig_we",
        "startMarkerId": "tm_10",
        "endMarkerId": "tm_20",
        "state": "LOW"
      }
    ],
    "transitions": [
      {
        "id": "tr_we_fall",
        "signalId": "sig_we",
        "markerId": "tm_10",
        "fromState": "HIGH",
        "toState": "LOW",
        "derivedFromSegmentIds": ["seg_we_high_1", "seg_we_low"]
      },
      {
        "id": "tr_we_rise",
        "signalId": "sig_we",
        "markerId": "tm_20",
        "fromState": "LOW",
        "toState": "HIGH"
      }
    ],
    "timingParameters": [
      {
        "id": "tp_twp",
        "name": "tWP",
        "startTransitionId": "tr_we_fall",
        "endTransitionId": "tr_we_rise",
        "requirementText": ">= 20 ns",
        "parsedRequirement": null,
        "validationStatus": "note"
      }
    ],
    "phases": [
      {
        "id": "phase_program",
        "name": "Program",
        "startTransitionId": "tr_we_fall",
        "endTransitionId": "tr_we_rise"
      }
    ],
    "annotations": []
  },
  "presentation": {
    "signalRowOrder": ["sig_we"],
    "timingLaneOrder": ["tp_twp", "phase_program"]
  }
}
```

下游取得 transition 順序時，必須將 `timeMarkers` 依 `sequence` 排序，再依每個 marker 的 `transitionIds` 讀取同步群組。第一版不額外輸出重複的 `transitionSequence` projection。下游不得由 presentation 或 PNG 推導工程關係。

### Validation、刪除與匯出

Validator 至少檢查：

- schema version、必填 title、object ID 唯一性與 reference 存在性；
- 每個 signal 的 segment 是否完整覆蓋 timeline、依序相接且不重疊；
- transition 是否與相鄰 segment state 及 marker 一致；
- marker 是否為固定 boundary 或至少包含一個 transition，且 sequence 唯一；
- timing parameter 與 phase endpoint 是否存在、不同且嚴格由左至右；
- timing parameter 的 endpoint reference 與順序是否合法；`requirementText` 僅為註解，不參與 validation；
- annotation anchor 與 presentation reference 是否存在。

刪除被 reference 的 transition 時，UI 必須列出所有相依 timing parameter 與 phase。Designer 可取消，或確認級聯刪除依賴物件；不得留下 dangling reference。

一般編輯中的 validation error 禁止 JSON 匯出。PNG 可匯出為 review 草稿，但必須加上明顯 `DRAFT / INVALID` watermark。文件 valid 時，JSON 與 PNG 皆由同一 snapshot 產生。

### 匯入與修復模式

平台必須能回讀自己輸出的 JSON。相容且 valid 的文件會直接載入、render 並可續編。JSON 出現 schema 不相容、reference 遺失或 semantic validation error 時，平台進入修復模式：顯示錯誤清單、structured object list、property inspector 與 raw JSON editor。

修復模式不 render waveform canvas，不產生 SVG，不允許 PNG 或 JSON 匯出。只有 user 修正到 validation 全數通過後，才可退出修復模式並首次 render 正式圖面。系統不得靜默捨棄物件、猜測 reference 或自動修復資料。

### 模組與測試 seam

最高且最穩定的 seam 是純 waveform document model。它負責 document mutation、segment-to-transition 推導、marker 重排、reference 維護與 validation；DOM controller 只將互動轉為 model operation，renderer 只讀取 model。

建議分離以下責任：

- document factory 與 immutable ID generation；
- signal、segment、marker、transition、timing parameter、phase、annotation 的純操作；
- transition derivation 與 dependency/cascade analysis；
- timing requirement 自由格式註解與 endpoint validator；
- SVG renderer 與 PNG exporter；
- import loader、repair-mode controller；
- palette、inspector、JSON preview 與 DOM interaction controller。

## 測試決策

測試以使用者可觀察的文件行為為主，不測 DOM 結構或 renderer 實作細節。至少涵蓋：

- 新增 signal 後以 initial state 建立完整 segment coverage；
- 移動共享 segment boundary 時，兩側 segment 與 derived transition 一致，既有 transition ID 在可保留時不改變；
- 同 marker transition 視為同步，marker sequence 改變後左到右順序正確；
- 移動單一 transition 能拆出或合併 marker，且空 marker 被移除；
- timing parameter 與 phase 僅能綁定存在、不同、且由左至右的 transition；
- 多個 parameter 可共用 endpoint；刪除 endpoint 能精確列出與級聯刪除 dependency；
- 任意 timing requirement 註解（包含空白或非 DSL 文字）都不影響文件有效性與匯出；
- JSON 匯出包含語意資料且不需要 pixel；回匯後可得到相同 document；
- invalid authoring document 阻擋 JSON、允許帶水印 PNG；invalid import 進 repair mode 且不 render；
- valid document 生成的 SVG 與 PNG 對應同一 model snapshot。

使用原生 Node test runner 驗證 model、parser 與 validator。手動 browser smoke test 應涵蓋新增 signal、建立／移動 transition、建立 parameter／phase、annotation、JSON 回匯、repair mode、JSON 匯出與 PNG 匯出。

## 不在範圍內

- 既有 PNG/PDF waveform 的 OCR、VLM extraction 或自動轉換。
- Analog curve、任意 spline、精準 voltage ramp、SPICE-level 電氣行為。
- Bus decoding、複雜 data-value encoding 與完整 EDA waveform interchange format。
- Verilog、SystemVerilog assertion、timing-rule 程式碼自動生成；本版本僅輸出後續模組所需 JSON 契約。
- 多人即時協作、帳號、權限、雲端儲存、revision service 與 server API。
- 以圖上距離或 pixel 轉換實際時間、按實際時間比例繪圖，或以 timing rule 自動改變 marker 間距。
- 讀取外部工具產生但不符合本 schema 的 JSON；第一版僅保證回匯平台自身輸出。

## 補充說明

本產品的核心價值不在於畫出 waveform 圖，而在於讓 waveform 從建立開始就是可驗證的結構化工程資料。Designer 仍使用熟悉的 row、column、拖拉與 arrow 操作，但每一個關鍵關係都落到 signal、segment、transition、marker 與 endpoint reference。

未來可在維持 schema version 相容性的前提下擴充 analog signal、bus、legacy image annotation、rule/code generation、版本比較與多人協作；這些功能不得改變「語意模型為真相、畫面與 PNG 是投影」的基本原則。
