# ChatX Watcher

ChatX Watcher 是一个极轻量的 ChatGPT 完成提醒器。检测逻辑只运行在 ChatGPT 页面；完成提醒显示在用户当前正在看的普通 HTTP/HTTPS 页面右下角。

## 产品路径

```text
RUNNING
→ FINISH_CANDIDATE
→ DONE
→ 当前普通网页 In-Page Overlay
→ 查看
→ 对应 ChatGPT conversation
→ ACKNOWLEDGED
```

- ChatGPT detector 只匹配 `https://chatgpt.com/*`。
- 普通网页只加载轻量 Overlay message listener，不扫描 DOM。
- Overlay 使用 Shadow DOM，不创建独立 Chrome completion window。
- 点击“×”只关闭当前提醒，不 ACK，也不会重复主动提醒同一个 run。
- 点击“查看”后由 Background 复用唯一的 `focusConversation()`，成功后 ACK 并移除 Overlay。
- `chrome://`、Chrome Web Store 等受保护页面无法注入时，DONE 保持 pending；用户之后进入可注入页面时再事件驱动展示。

## 权限

```text
storage
tabs
http://*/*
https://*/*
```

HTTP/HTTPS 权限仅用于在当前普通网页显示完成提醒。普通网页脚本不读取正文、表单或剪贴板，不执行网络请求，也不使用 MutationObserver。

## 资源设计

```text
Polling: none
Persistent timers: none
Persistent animation: none
Ordinary-page MutationObserver: 0
Network: none
Extra browser runtime: none
Extra native process: none
Overlay when idle: absent
```

字符动画只播放一次：`[._.] → [-_-] → [^_^] !`，使用两个短 `setTimeout` 后完全停止。

## 安装（开发版）

1. 打开 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择仓库中的 `extensions/chatx-watcher/`。
