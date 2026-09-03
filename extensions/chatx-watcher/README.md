# ChatX Watcher

ChatX Watcher 是 ChatX 的轻量完成提醒扩展。它独立于 ChatX Core 运行，不需要 Electron、第二个浏览器、Playwright 常驻监听页面，也不会读取 ChatGPT 左侧栏的蓝点或转圈状态。

## 第一版范围

- 监听 `https://chatgpt.com/*`
- 从 `/c/<conversation-id>` 获取稳定 conversation ID
- 使用 `MutationObserver` 监听主对话区
- 为每个 conversation 维护独立 run
- `RUNNING -> FINISH_CANDIDATE -> DONE -> ACKNOWLEDGED`
- 每个 run 最多通知一次
- Windows 使用 Chrome 原生通知
- 点击通知激活原 Chrome 窗口并返回对应 ChatGPT Tab
- 仅保存 conversation/run 元数据，不保存 prompt、回答正文、Cookie 或 token

## 安装（开发版）

1. 打开 Chrome 的 `chrome://extensions/`
2. 开启“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选择仓库中的 `extensions/chatx-watcher/`
5. 确保 Windows 已允许 Chrome 通知

扩展默认中文，默认开启完成提醒。

## 完成判定

第一版采用保守联合条件：

```text
assistant 区域连续稳定 >= 3 秒
AND generation controls inactive
AND generation busy signals inactive
AND composer 可正常输入
AND 已观察到本 run 的 assistant mutation
AND 再确认 >= 1.5 秒
```

后台 Tab 的浏览器节流只会让提醒更晚，不会让确认窗口更短。

Selectors 全部集中在 `src/selectors.js`。ChatGPT DOM 变化时优先只调整该文件。

## 资源设计

```text
Idle timers: 0（仅 ACK 事件有 180ms debounce）
Polling: none
Observers per ChatGPT tab: 1 个主对话区 observer + 1 个仅观察其直接父节点的生命周期 observer
Bootstrap observer: 仅主对话区尚未出现时临时存在，找到后立即断开
Background network traffic: none
Extra browser processes: none
GPU workload: none
```

生成期间只使用一个稳定窗口 timer 和一个短确认 timer。没有 100ms/500ms 轮询，也不会周期性扫描整个页面。

## 隐私

持久化状态只包含：

- `conversationId`
- `runId`
- state
- `tabId` / `windowId`
- URL / title
- 时间戳

最多保留 80 个 run，并对旧状态使用 14 天 TTL。不会保存 ChatGPT 消息正文。

## Future sink

完成事件通过 Background 中的 `BrowserNotificationSink` 发出。未来如果实现桌面 Companion，可以并列增加 `ChatXBridgeSink` / `CompanionSink`，无需把 DOM 检测逻辑搬进 ChatX Core。
