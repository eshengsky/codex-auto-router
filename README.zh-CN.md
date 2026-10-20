# Codex Auto Router

[English](README.md)

根据当前任务及其上下文，为 Codex 自动选择合适的模型和推理强度。

在模型菜单中选择 **Auto** 即可使用。想固定使用某个模型时，直接选择它即可。

这是一个非官方开源工具，目前支持 macOS。

https://github.com/user-attachments/assets/6a2b9238-c379-4551-a44b-59604ed348b8

## 安装与开始使用

打开「终端」，执行：

```sh
/usr/bin/curl -fsSL https://github.com/eshengsky/codex-auto-router/releases/latest/download/install.sh | /bin/sh
```

首次安装成功后会自动打开配置页面。按 **Command + Q** 完全退出并重新打开 Codex，然后在模型菜单中选择 **Auto**。

## 配置

在浏览器中打开 [http://127.0.0.1:58555/](http://127.0.0.1:58555/)：

- **分类模型**：设置负责判断任务复杂度的模型、推理强度和超时时间。分类也会消耗 Codex 账号额度。
- **路由配置**：将不同复杂度的任务分配给不同模型，支持二级、三级和五级模板。切换后立即用于后续消息。
- **兜底级别**：指定分类超时或无法判断时使用的级别。
- **回复模型标签**：选择是否在回复顶部显示实际使用的模型和强度。

配置自动保存，在后续发送时生效，无需重启 Codex。三套模板分别保存，可独立恢复默认。配置页支持简体中文和英文。

模型标签示例：

> Auto · GPT-6 Astra · High

## 更新与卸载

**更新：** 等待当前任务结束后，重新执行安装命令，再完全退出并重新打开 Codex。已有配置和记录会保留。版本变化见 [Releases](https://github.com/eshengsky/codex-auto-router/releases)。

**卸载：** 先完全退出 Codex，再执行：

```sh
"$HOME/Library/Application Support/Codex Smart Selection/manage" uninstall
```

卸载后重新打开 Codex，即恢复原有使用方式。用户配置和记录会保留。

## 常见问题

| 问题 | 处理方法 |
| --- | --- |
| 模型菜单没有 Auto | 按 Command + Q 完全退出并重新打开 Codex；仍未出现或配置页打不开时，运行下面的状态检查命令。 |
| Auto 旁边为什么还有「中」等强度？ | Auto 旁边显示的强度不代表本次任务实际使用的强度，实际结果可通过回复中的模型标签查看。 |
| 提示模型或强度不可用 | 到配置页选择账号可用的模型和强度。 |
| 分类超时 | 任务会按配置的兜底级别继续执行。可以在配置页调整分类模型或超时时间。 |
| 安装时提示 58555 端口被占用 | 运行下面的端口检查命令，查看占用程序；确认可以退出该程序后，再重新安装。 |
| 安装后 Codex 无法启动 | 退出 Codex，执行上面的卸载命令后重新打开。 |

检查安装和服务状态：

```sh
"$HOME/Library/Application Support/Codex Smart Selection/manage" status
```

如果安装提示端口被占用，查看占用程序：

```sh
/usr/sbin/lsof -nP -iTCP:58555 -sTCP:LISTEN
```

无法解决时，可以附上报错和检查结果[提交 Issue](https://github.com/eshengsky/codex-auto-router/issues)。如果状态检查提示找不到 `manage`，请提供安装命令的报错。

## 更多信息

- [工作原理与数据存储](docs/architecture.md)
- [MIT 许可证](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md)
