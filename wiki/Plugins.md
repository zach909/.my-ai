# Plugins

Plugins are API connections to external services and system features in Prometheus Elastic Core. They provide the AI with access to hardware, applications, and external data sources.

## Overview

**Definition**: A plugin is an API connection to another service.

**Key Feature**: Thanks to all-to-all connectivity in the neuron mesh, plugins drop in easily without complex integration.

## Plugin Categories

None of these plugins have a dedicated wiki page yet (the individual
`Plugin-*` pages this section used to link to don't exist), so the entries
below are plain names, not links.

### System Access Plugins

| Plugin | Description |
|--------|-------------|
| File System | Read/write files, directory navigation |
| Terminal | Execute shell commands, run scripts |
| Multi-Desktop | GNOME multi-desktop management |
| Multi-Input | Multiple mouse/keyboard support |

### Hardware Plugins

| Plugin | Description |
|--------|-------------|
| Camera | Camera access, photo capture |
| Microphone | Audio input, voice recording |
| Location | GPS and location services |
| Screenshots | Screen capture and recording |

### Communication Plugins

| Plugin | Description |
|--------|-------------|
| Email | Email sending/receiving |
| Messaging | SMS and instant messaging |
| Phone Calls | Voice call management |
| Call History | Call log access |
| Contacts | Contact management |
| Notifications | System notifications |

### Application Plugins

| Plugin | Description |
|--------|-------------|
| Browser | Web browsing, web automation |
| Calendar | Calendar events, scheduling |
| Tasks | Task management, to-do lists |
| Radios | Radio streaming |
| Voice Activation | Voice command activation |
| App Diagnostics | Application monitoring |

### Security & Identity Plugins

| Plugin | Description |
|--------|-------------|
| Passkeys | Passkey authentication |
| Account Info | Account management |

### Advanced Plugins

| Plugin | Description |
|--------|-------------|
| Other Devices | Cross-device communication |
| Self-Heal | Self-repair and error recovery |

## Creating a Plugin

There are two, unrelated plugin systems in this codebase — a TypeScript one
(`plugin_manager/sdk.ts`'s `BasePlugin`, used by the live `plugins/*.ts`
files wired into `interface/main.ts`) and a separate Python one
(`plugins/plugin_base.py`'s `Plugin`, used by the Python `plugins/plugin_*.py`
files). Neither is named `PluginBase` with an `execute(command)` method —
that shape doesn't exist anywhere in the codebase.

### TypeScript Plugin Structure

```typescript
// Example plugin structure, matching the real plugins/browser.ts
import { BasePlugin } from '../plugin_manager/sdk.js';
import type { PluginDefinition } from '../plugin_manager/types.js';

export class MyPlugin extends BasePlugin {
    constructor(definition: PluginDefinition) {
        super(definition);
    }

    // Called once the registry activates this plugin instance.
    async onActivate(context: PluginContext): Promise<void> {
        await super.onActivate(context);
        // Setup plugin
    }

    // Handle a message routed to this plugin.
    async onMessage(message: unknown): Promise<unknown> {
        // Handle commands
        return message;
    }

    async onDeactivate(): Promise<void> {
        await super.onDeactivate();
        // Cleanup
    }
}
```

### Python Plugin Example

```python
# plugins/plugin_example.py — matching the real plugins/plugin_base.py
from .plugin_base import Plugin

class ExamplePlugin(Plugin):
    name = "example"

    def _setup(self) -> None:
        # Populate self.tools with {tool_name: callable}
        self.tools["do_thing"] = self._do_thing

    def _do_thing(self, *args, **kwargs):
        return result
```

Call a Python plugin's tool with `plugin.call("do_thing", ...)`, not a generic
`execute(command)` method.

### Registration

TypeScript plugins are wired up explicitly in `interface/main.ts`'s
`buildCore()`/`PluginRegistry.bootstrap()` — they are not auto-discovered
just by existing in `plugins/`. The registry's real API
(`plugin_manager/registry.ts`): `register(definition, instance)`,
`activate(pluginId)`/`deactivate(pluginId)`, `listPlugins()`, `getPlugin(pluginId)`
(returns the plugin's `PluginDefinition`, not a live instance with methods
on it), `dispatch(input, intent)`, `healthCheck()`.

## Using Plugins

### Command Interface

```
> Open browser
> Take a photo
> Send email to john@example.com
> List files in Documents
> Set calendar reminder
```

### Programmatic Access

`PluginRegistry.getPlugin(pluginId)` returns the plugin's `PluginDefinition`
(metadata) — not a live instance with plugin-specific methods like
`.listDirectory()`/`.capture()`. To actually run something, dispatch through
the registry instead:

```typescript
// Real PluginRegistry API (plugin_manager/registry.ts)
const definition = registry.getPlugin('file-system'); // PluginDefinition | undefined
const active = registry.listActivePlugins();           // PluginDefinition[]

// dispatch(input, intent)'s second argument is an intent bucket key
// ('command', 'analysis', 'exploration', ...), not a plugin id -- passing
// a plugin id like 'file-system' matches no bucket and always returns null.
// 'command' is one of several intents whose candidate list includes
// file-system (so does 'analysis'); dispatch tries each active candidate
// in order until one returns a non-null result.
const result = await registry.dispatch('list files in Documents', 'command');
```

## Plugin Manager

The plugin registry (`plugin_manager/registry.ts`, the class actually wired
up in `interface/main.ts`) handles:

- **Registration**: `register(definition, instance)` adds a plugin instance
- **Lifecycle**: `activate(pluginId)`/`deactivate(pluginId)`
- **Routing**: `dispatch(input, intent)` sends input to the right plugin
- **Health**: `healthCheck()` reports each active plugin's `onHealthCheck()` result

### Plugin Registry API

```typescript
// plugin_manager/registry.ts's real, live PluginRegistry class
register(definition: PluginDefinition, instance: BasePlugin): void
activate(pluginId: string): Promise<void>
deactivate(pluginId: string): Promise<void>
listPlugins(): PluginDefinition[]
listActivePlugins(): PluginDefinition[]
getPlugin(pluginId: string): PluginDefinition | undefined
dispatch(input: string, intent: string): Promise<string | null>
healthCheck(): Promise<Map<string, boolean>>
```

(A separate, differently-shaped `PluginManager` class also exists in
`models && skills/plugin-manager.js` (JS-only module; no `.ts` source has
ever existed here) — it is not the one `interface/main.ts` actually uses,
so its `executePlugin(pluginId, action, data)`-style API isn't what's
documented above.)

## Security Considerations

### Permissions

Plugins request specific permissions:
- File system access (read/write/execute)
- Hardware access (camera, microphone)
- Network access
- System commands

### Privacy

- All plugin data stays local by default
- No external APIs unless explicitly configured
- End-to-end encryption for sensitive data

### Sandboxing

Plugins can be sandboxed for security:
- Limited file system access
- Restricted system commands
- Isolated execution context

## Best Practices

1. **Minimal Permissions**: Request only necessary permissions
2. **Error Handling**: Gracefully handle failures
3. **Resource Management**: Clean up resources on shutdown
4. **Documentation**: Document plugin capabilities and usage
5. **Testing**: Test plugins thoroughly before deployment

## Troubleshooting

### Plugin Not Loading

Check:
- Plugin file exists in `plugins/` directory
- Plugin exports correct interface
- No syntax errors in plugin code
- Dependencies are installed

### Plugin Crashes

Debug:
- Check plugin logs
- Verify permissions
- Test in isolation
- Review error messages

## See Also

- [[Home]] - Main wiki page
- [[Skills]] - Expert modules for MoE
- [[Extensions]] - Self-built extensions
- [[Architecture]] - System architecture
- [[System-Access]] - System access configuration

---

*Plugins extend Prometheus Elastic Core's capabilities by connecting to system features and external services.*
