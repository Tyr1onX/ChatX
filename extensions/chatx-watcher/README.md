# ChatX Watcher

ChatX Watcher 是一个极轻量的 ChatGPT 完成提醒器。它完全运行在 Chrome MV3 Extension 内，不需要 Electron、Tauri、第二个 Chromium、原生通知进程或常驻 GUI。

## v1 产品路径

```text
RUNNING
-> FINISH_CANDIDATE
-> DONE
-> ChatX Popup
-> 查看对应 conversation
-> ACKNOWLEDGED
```

第一版只保留这一条完成展示路径：

- DONE 时创建一个短生命周期 `chrome.windows.create({ type: "popup" })` 窗口
- 平时 popup 不存在
- 多个 completion 优先复用同一个 popup
- popup 只显示完成数量和 conversation title，不读取 prompt / answer 正文
- 点击“查看”优先处理最早尚未 ACK 的 DONE run
- 先按原 `tabId` 定位，失效时回退到 conversation URL，再聚焦对应 Chrome window
- 成功查看后进入 `ACKNOWLEDGED` 并关闭 popup
- 用户仅关闭 popup 不等于 ACK；同一个 run 不会再次主动弹出

## 安装（开发版）

1. 打开 Chrome 的 `chrome://extensions/`
2. 开启“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选择仓库中的 `extensions/chatx-watcher/`

扩展默认中文，默认开启完成提醒。

## 完成判定

第一版继续使用真实环境已经验证过的保守联合条件：

```text
assistant 区域连续稳定 >= 3 秒
AND button[data-testid="stop-button"] 不存在
AND generation busy signals inactive
AND composer 可正常输入
AND 已观察到本 run 的 assistant mutation
AND 再确认 >= 1.5 秒
```

`/c/WEB:*` 临时 conversation ID 会被忽略。

Selectors 全部集中在 `src/selectors.js`。ChatGPT DOM 变化时优先只调整该文件，不重写状态机。

## Popup

完成 popup 复用扩展现有的 `popup.html / popup.js / popup.css`，通过 `?completion=1` 进入完成提醒模式，因此没有第二套 UI implementation。

字符角色只播放一次短动画：

```text
[._.]
 /|\
 / \

->

[-_-]
 /|\
 / \

->

[^_^] !
 /|\
 / \
```

动画只使用两个短 `setTimeout`，总时长低于 1 秒，结束后停止。

## 多个 completion

DONE run 按 `completedAt` 从早到晚排序。已有 completion popup 时不会为每个 run 新建窗口，而是刷新同一个 popup；“查看”始终处理最早的 DONE run，行为确定且不引入任务中心。

## 资源设计

```text
Idle popup: 不存在
Polling: none
Persistent animation timer: none
Background network traffic: none
Extra Chromium: none
Extra native process: none
```

生成期间仍只使用 detector 自己的稳定窗口 timer 和短确认 timer；没有周期性网络请求或页面 polling。

## 权限

```text
storage
tabs
host: https://chatgpt.com/*
```

不需要 `notifications`，也不使用 `<all_urls>`。

## 隐私

持久化状态只包含：

- `conversationId`
- `runId`
- state
- `tabId` / `windowId`
- conversation URL / title
- 时间戳

最多保留 80 个 run，并对旧状态使用 14 天 TTL。不会保存 ChatGPT 消息正文、Cookie 或 token。
