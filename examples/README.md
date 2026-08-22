# Registering ApplyOnce with a Claude client

## Claude Desktop
Merge `claude_desktop_config.json` into your client config and replace the absolute path:

| OS | Config file |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

## Claude Code
```bash
claude mcp add applyonce -- node /absolute/path/to/ApplyOnce/dist/mcp/server.js
```

Restart the client, then ask: *"Use ApplyOnce to list the portals you've learned."*
