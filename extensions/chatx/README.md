# ChatX Browser Extension

统一的 ChatX 浏览器扩展，包含三个独立模块：Watcher、Session Guard、Agent Bridge。

顶层功能开关唯一保存在 `chrome.storage.local.features`：

```js
{
  watcher: true,
  sessionGuard: true,
  agentBridge: false
}
```

各模块继续维护自己的业务状态；顶层开关只负责启停，不合并模块状态。

开发安装：在 `chrome://extensions/` 中选择“加载已解压的扩展程序”，加载 `extensions/chatx/`。
