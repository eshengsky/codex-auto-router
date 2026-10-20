# Architecture and data handling

## Components

1. `install.sh` is a release-specific downloader. The release build fills in the tool version and archive digest. It downloads the corresponding tagged archive, verifies the archive bytes, extracts to a temporary directory and invokes the Node installer. The digest concerns the downloaded router package, not the installed Codex application.
2. `scripts/install.mjs` copies the runtime into the user's application-support directory and registers a LaunchAgent. It keeps a stable `bridge-cli` entry and switches the `current` symlink to the new runtime. Failed installation attempts restore the previous registration and selected runtime where possible.
3. `src/login-service.mjs` sets the GUI session's bridge environment and runs the local configuration/classification service. macOS launchd owns this process. Neither the browser nor the Codex window owns its lifetime.
4. `bridge-cli` and `src/entry.mjs` load the bridge, then start the native Codex app-server. Unsupported invocation forms pass through. Startup fallback occurs before dispatch; it never retries an already dispatched request.
5. `src/bridge.mjs` exposes the Auto option and intercepts Auto turns. Existing threads preserve their real native model when switched to Auto; new threads use the native default until a task is routed. Manual model selection bypasses classification.
6. `src/service.mjs` serves the prebuilt settings page and classifies requests. The classifier uses the native Codex backend with no tools. It receives task context and returns a constrained tier identifier. Timeouts and uncertain classifications use the chosen fallback; unavailable model/effort settings produce an actionable error.

The public plugin system does not provide this model-menu integration. `CODEX_CLI_PATH`, app-server request handling and the bundled executable layout are integration dependencies that can change. The project does not modify `app.asar`, application signatures or the user's global `config.toml`.

## Runtime and dependency packaging

The release archive contains backend source modules, three installer support modules, the shell entries, package metadata, notices and the built settings page. No `node_modules`, Codex executable, Node executable, developer reports or local logs are distributed. The backend only requires Node built-ins. The frontend's dependencies are compiled into its static assets, with third-party notices included.

The application-support and data directory names retain the prototype names to avoid migrating existing installations during this release. Package version identifies this tool for status and support; service protocol version identifies the local service contract. Neither is a Codex compatibility gate.

The current installer expects Codex at `/Applications/ChatGPT.app` and uses its bundled Node runtime. The settings page uses [Apps SDK UI](https://github.com/openai/apps-sdk-ui).

## Default configuration

The classifier defaults to **GPT-6 Luna · Light**, with a **20-second timeout**. The three-level template is initially active:

| Level | Execution model | Reasoning effort |
| --- | --- | --- |
| Simple | GPT-6 Luna | Medium |
| Regular (fallback) | GPT-6.1 Sol | Medium |
| Complex | GPT-6 Astra | High |

These are starting settings, not a guarantee of account availability. An unavailable classifier or selected execution model/effort stops the send with an error linking to settings. Classification timeouts and uncertain results use the selected fallback, whose model and effort must also be available.

## Data flow

Auto sends the current task and available recent user/assistant messages to a separate classification session through the user's Codex backend. The recent-message limit is six messages. Long history messages keep their first and last 1,200 Unicode code points; a long current message keeps its first and last 6,000. These bounds affect classification input only, not the original chat.

Each prepared classifier session handles one classification, then its process is closed. A spare session can be prepared ahead of time to reduce waiting. This does not reuse previous classification conversation context. Real classification consumes the user's existing Codex quota and can be affected by network conditions and rate limits.

The bridge forwards an allowlisted snapshot of its proxy environment to each classification request. The service does not read shell startup files or discover system proxies. Proxy values are not stored in routing configuration or routing records.

The configuration directory contains routing preferences, per-thread Auto selections, per-turn model/origin records, the most recent 100 classification metadata records, routing diagnostics and service logs. Classification history does not include task bodies or attachments. Diagnostics can include thread identifiers and errors: review logs before sharing them in a public issue. The native backend manages its own storage separately.

Model labels are prepended only to replies sent to the desktop UI. The bridge does not add them to the native transcript or future inference context. Historical labels use recorded turn information; an unknown selection origin is not presented as Auto.

Manually copying a reply can include its visible label. The menu option and automatic-routing label prefix stay **Auto** in either settings-page language.

### Storage locations

| Location | Contents |
| --- | --- |
| `~/Library/Application Support/Codex Smart Selection/` | Installed runtime and management entry point |
| `~/Library/LaunchAgents/local.codex-smart-selection.plist` | Login service registration |
| `~/.codex/smart-selection-prototype/config.json` | Classification and routing settings |
| `~/.codex/smart-selection-prototype/preferences.json` | UI language and reply-label preference |
| `~/.codex/smart-selection-prototype/` | Routing metadata, per-turn origin records and service logs |

If `CODEX_HOME` is set during installation, the data directory is placed there instead of `~/.codex`.

## Local service

The service listens on IPv4 loopback at `127.0.0.1:58555`, without an authentication token. Host, Origin, Fetch Metadata, request-method, JSON content-type and custom-header checks restrict browser cross-site calls. They are not a security boundary against other native programs or users on the same machine.

## Installation boundaries

- Install and uninstall operate on the current macOS user. No system-wide service or administrator installation is required.
- Installation does not close Codex; the user must quit and reopen it to select the newly installed bridge.
- Uninstall refuses to remove a bridge still in use. It preserves configuration and routing records.
- A port or startup environment owned by a different integration causes an error; the installer does not overwrite it.
- The installer does not ensure ordering between macOS's restored applications and login services. If Codex starts first, it may need to be reopened once the service is ready.
- Codex updates are accepted without version or file-hash checks, but app-server incompatibilities can still need code changes. Startup fallback cannot guarantee recovery from every runtime protocol incompatibility.

## Diagnostics

To inspect the installed runtime, login service, local service and bridge startup settings:

```sh
"$HOME/Library/Application Support/Codex Smart Selection/manage" status
```

Add `--json` for a machine-readable report. Service logs are `login-service.log` and `login-service.stderr.log` in the data directory above. Include the relevant error and status output when reporting a problem, after checking for private information.

If a GitHub download fails, check connectivity and retry the installation command. A package download or integrity failure stops before the local installer runs. To install a downloaded release manually, extract `codex-auto-router-macos.tar.gz` and run `/bin/sh` followed by the path to its `Install.command`.

The installer operates as the current user; run it without `sudo`. Router updates are installed by rerunning the installation command. Failed updates attempt to restore the previously installed runtime and service registration.
