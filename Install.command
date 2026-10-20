#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
node_bin=/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node
if [ ! -x "$node_bin" ]; then
  # Use the same terminal locale precedence as install.sh and the Node installer.
  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in
    zh|zh_*|zh-*|ZH|ZH_*|ZH-*|zH|zH_*|zH-*|Zh|Zh_*|Zh-*) printf '%s\n' '未找到 Codex 运行文件，请检查 /Applications 中的 Codex 安装。' >&2 ;;
    *) printf '%s\n' 'Codex runtime not found. Check your Codex installation in /Applications.' >&2 ;;
  esac
  exit 1
fi
exec "$node_bin" "$root/scripts/install.mjs" "$@"
