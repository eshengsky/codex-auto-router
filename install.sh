#!/bin/sh
# Release preparation fills these values. The source template is not a
# downloadable installer; use Install.command when installing from source.
# Keep execution in main so an incomplete piped download cannot start setup.
main() {
  set -eu
  release_version='@VERSION@'
  archive_sha256='@SHA256@'
  repository='eshengsky/codex-auto-router'
  node_bin='/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node'

  # Match the Node installer's terminal locale rule before Node is available.
  install_locale=${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}
  install_language=en
  case "$install_locale" in zh|zh_*|zh-*|ZH|ZH_*|ZH-*|zH|zH_*|zH-*|Zh|Zh_*|Zh-*) install_language=zh ;; esac
  message() {
    if [ "$install_language" = zh ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi
  }

  for option in "$@"; do
    case "$option" in
      --no-open|--json) ;;
      --help) message '用法：install.sh [--no-open] [--json]' 'Usage: install.sh [--no-open] [--json]'; return 0 ;;
      *) message "未知选项：$option" "Unknown option: $option" >&2; return 1 ;;
    esac
  done
  if [ "$release_version" = '@''VERSION@' ]; then
    message '请使用 GitHub Release 中的 install.sh，或在已构建的源码目录中运行 /bin/sh Install.command。' 'Use install.sh from a GitHub Release, or run /bin/sh Install.command from a built checkout.' >&2
    return 1
  fi
  if [ "$(/usr/bin/uname -s)" != Darwin ]; then
    message 'Codex Auto Router 目前仅支持 macOS。' 'Codex Auto Router currently supports macOS only.' >&2
    return 1
  fi
  if [ "$(/usr/bin/id -u)" -eq 0 ]; then
    message '请使用当前 macOS 用户运行此命令，不要使用 sudo。' 'Run this command as your macOS user, without sudo.' >&2
    return 1
  fi
  if [ ! -x "$node_bin" ]; then
    message '未找到 Codex 运行文件，请检查 /Applications 中的 Codex 安装。' 'Codex runtime not found. Check your Codex installation in /Applications.' >&2
    return 1
  fi

  install_tmp=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/codex-auto-router.XXXXXX")
  trap '/bin/rm -rf "$install_tmp"' 0
  trap 'exit 130' INT
  trap 'exit 143' HUP TERM
  archive="$install_tmp/codex-auto-router-macos.tar.gz"
  # Braces prevent macOS sh from including adjacent UTF-8 punctuation in the variable name.
  message "正在下载 Codex Auto Router ${release_version}…" "Downloading Codex Auto Router ${release_version}…" >&2
  # The release script and archive are pinned together, even if latest changes
  # while this download is in progress. No GitHub API or account is required.
  /usr/bin/curl --fail --show-error --silent --location --retry 2 \
    --connect-timeout 15 --max-time 180 --proto '=https' \
    "https://github.com/$repository/releases/download/v$release_version/codex-auto-router-macos.tar.gz" \
    --output "$archive"
  actual_sha256=$(/usr/bin/shasum -a 256 "$archive")
  actual_sha256=${actual_sha256%% *}
  if [ "$actual_sha256" != "$archive_sha256" ]; then
    message '下载的安装包不完整或与此版本不符，尚未开始安装，请重新执行安装命令。' 'The downloaded package is incomplete or does not match this release. Installation was not started; retry the command.' >&2
    return 1
  fi
  /usr/bin/tar -xzf "$archive" -C "$install_tmp"
  "$node_bin" "$install_tmp/codex-auto-router/scripts/install.mjs" install "$@"
}

main "$@"
