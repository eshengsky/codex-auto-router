# Codex Auto Router

[简体中文](README.zh-CN.md)

Automatically selects a suitable model and reasoning effort in Codex based on the current task and its context.

Choose **Auto** in the model menu to use automatic routing. Select a specific model to keep using it.

An unofficial open-source tool for macOS.

https://github.com/user-attachments/assets/41c80d1e-ca45-411e-9e74-9e7bf9b30697

## Install and start using Auto

Open **Terminal** and run:

```sh
/usr/bin/curl -fsSL https://github.com/eshengsky/codex-auto-router/releases/latest/download/install.sh | /bin/sh
```

The settings page opens after a successful first install. Fully quit Codex with **Command + Q**, reopen it, then select **Auto** in the model menu.

## Configure

Open [http://127.0.0.1:58555/](http://127.0.0.1:58555/) in your browser:

- **Classification model**: choose the model, reasoning effort and timeout used to assess task complexity. Classification also consumes your Codex account quota.
- **Routing**: assign tasks of different complexity to different models using two-, three- or five-level templates. Switching templates applies to subsequent messages immediately.
- **Fallback level**: choose which level handles tasks when classification times out or cannot determine a level.
- **Reply model labels**: choose whether replies show the actual model and reasoning effort used.

Changes save automatically and apply to subsequent messages without restarting Codex. Each template retains its own settings and can be reset independently. The settings page supports English and Simplified Chinese.

Example model label:

> Auto · GPT-6 Astra · High

## Update and uninstall

**Update:** after current tasks finish, run the installation command again, then fully quit and reopen Codex. Your settings and records are retained. See [Releases](https://github.com/eshengsky/codex-auto-router/releases) for changes.

**Uninstall:** fully quit Codex, then run:

```sh
"$HOME/Library/Application Support/Codex Smart Selection/manage" uninstall
```

Reopen Codex to return to its original behavior. Your settings and records are retained.

## Common questions

| Question | What to do |
| --- | --- |
| Auto is missing from the model menu | Fully quit Codex with Command + Q and reopen it. If Auto is still missing or settings will not open, run the status command below. |
| Why does Auto still show an effort such as Medium? | The effort shown next to Auto does not indicate the effort used for this task. Enable reply labels to see the actual model and effort. |
| A model or effort is unavailable | Choose models and efforts available to your account on the settings page. |
| Classification timed out | The task proceeds using your fallback level. You can adjust the classification model or timeout in settings. |
| Installation reports that port 58555 is occupied | Run the port check below to identify the application. If you can quit it, do so and rerun installation. |
| Codex will not start after installation | Quit Codex, run the uninstall command above, and reopen it. |

Check installation and service status:

```sh
"$HOME/Library/Application Support/Codex Smart Selection/manage" status
```

If installation reports a port conflict, identify the application using the port:

```sh
/usr/sbin/lsof -nP -iTCP:58555 -sTCP:LISTEN
```

If the problem persists, [open an issue](https://github.com/eshengsky/codex-auto-router/issues) with the error and check results. If the status command cannot find `manage`, include the installation error instead.

## Further reading

- [Architecture and data handling](docs/architecture.md)
- [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
