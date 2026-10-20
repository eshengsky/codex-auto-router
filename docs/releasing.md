# 发布流程

本文供项目维护者使用。仓库：[eshengsky/codex-auto-router](https://github.com/eshengsky/codex-auto-router)。

日常 push 和 PR 不触发 GitHub Actions。准备发版时，推送版本 tag，Actions 会执行检查和打包，通过后创建带安装附件的草稿 Release；你填写更新说明后，手动发布。

## 日常开发

向分支 push，或创建、更新 PR，都不会运行工作流。可以积累多次提交后再发版；需要提前检查时，运行下文的本地验证命令。

## 准备发版

在本地切换到准备发布的提交，以 `v0.1.0` 为例：

```sh
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

版本号由你决定，tag 格式为 `v主版本.次版本.修订号`。当前发布流程接受 `v0.1.0`、`v0.2.0` 等正式版本格式，不接受预发布后缀。

Actions 使用 tag 中的版本号生成安装脚本和安装包。例如 `v0.2.0` 对应安装后的工具版本 `0.2.0`，不需要另外修改源码中的 `package.json` 或 `package-lock.json`。

推送 tag 后，Actions 会：

1. 检出 tag 对应的代码，运行测试、构建和安装包验证。
2. 创建同名草稿 Release，上传 `install.sh`、`codex-auto-router-macos.tar.gz` 和 `SHA256SUMS`。
3. 保持草稿状态，等待你填写更新说明并发布。

检查失败时，不会创建草稿 Release。成功后，也可以在对应运行记录的 **Artifacts → macos-release-files** 下载构建产物。

更新说明不会自动生成。工作流使用 GitHub 自动提供的 `GITHUB_TOKEN`，只有创建草稿的任务申请仓库内容写权限。

## 正式发布

等待对应的 Actions 运行全部成功后，打开仓库的 **Releases**：

1. 编辑对应版本的草稿，填写面向用户的更新说明。
2. 确认三个安装附件齐全，将该版本设为 **Latest**，保持 **Pre-release** 未勾选。
3. 点击 **Publish release**。

草稿不会改变用户安装命令的下载目标。发布并设为 Latest 后，README 中的命令才会下载该版本；首次正式发布前，这条命令还不能使用。

安装脚本内部使用具体版本的下载地址，并校验安装包 SHA-256，确保用户下载到同一版本的脚本和安装包。不要修改已经发布的 tag 或替换其附件；需要修复时，发布新版本。

## 失败与重试

- **测试、构建或安装包验证失败**：不会执行创建草稿的任务。修复代码后，用新的版本 tag 再次触发。
- **创建草稿或上传附件时网络中断**：可在 Actions 中选择 **Re-run failed jobs**。已有草稿会补充或替换附件，保留你写过的更新说明。请等重试完成后再发布。
- **提示权限不足**：检查仓库或组织的 Actions 策略是否允许 `GITHUB_TOKEN` 获得 `contents: write` 权限。
- **版本已正式发布**：工作流会停止，不修改该 Release。后续变更请使用新的 tag。

## 本地验证

需要在 push 前验证时，可以运行：

```sh
npm ci --ignore-scripts
npm test
npm run release:prepare
npm run release:verify
```

若要在本地检查某个发布版本的打包结果，可以将打包命令替换为：

```sh
RELEASE_TAG=v0.1.0 npm run release:prepare
```

产物位于 `dist/`。本地命令不会创建 tag、上传文件或创建 Release。未指定 `RELEASE_TAG` 时，打包使用源码 `package.json` 中的版本。

自动验证使用临时用户目录、模拟的 launchd 操作和本地 HTTP 服务，不会调用真实分类模型，也不能代替 Codex 桌面端的实际使用验证。首次发布前，应在测试账号或测试机器上确认：安装后能打开配置页；重开 Codex 后能选择 Auto 并聊天；更新保留配置；登录后服务能启动；卸载后 Codex 恢复正常使用。

草稿阶段可从 Release 或 Actions 下载压缩包，解压后运行其中的 `Install.command`。正式发布后，再用 README 的安装命令验证一次真实的 GitHub 下载与安装流程。
