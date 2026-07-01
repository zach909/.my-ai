# Plugins

Plugins are API connections to external services and system features in Prometheus Elastic Core. They provide the AI with access to hardware, applications, and external data sources.

## Overview

**Definition**: A plugin is an API connection to another service.

**Key Feature**: Thanks to all-to-all connectivity in the neuron mesh, plugins drop in easily without complex integration.

## Plugin Categories

### System Access Plugins

| Plugin | Description |
|--------|-------------|
| [[File System|Plugin-FileSystem]] | Read/write files, directory navigation |
| [[Terminal|Plugin-Terminal]] | Execute shell commands, run scripts |
| [[Multi-Desktop|Plugin-MultiDesktop]] | GNOME multi-desktop management |
| [[Multi-Input|Plugin-MultiInput]] | Multiple mouse/keyboard support |

### Hardware Plugins

| Plugin | Description |
|--------|-------------|
| [[Camera|Plugin-Camera]] | Camera access, photo capture |
| [[Microphone|Plugin-Microphone]] | Audio input, voice recording |
| [[Location|Plugin-Location]] | GPS and location services |
| [[Screenshots|Plugin-Screenshots]] | Screen capture and recording |

### Communication Plugins

| Plugin | Description |
|--------|-------------|
| [[Email|Plugin-Email]] | Email sending/receiving |
| [[Messaging|Plugin-Messaging]] | SMS and instant messaging |
| [[Phone Calls|Plugin-PhoneCalls]] | Voice call management |
| [[Call History|Plugin-CallHistory]] | Call log access |
| [[Contacts|Plugin-Contacts]] | Contact management |
| [[Notifications|Plugin-Notifications]] | System notifications |

### Application Plugins

| Plugin | Description |
|--------|-------------|
| [[Browser|Plugin-Browser]] | Web browsing, web automation |
| [[Calendar|Plugin-Calendar]] | Calendar events, scheduling |
| [[Tasks|Plugin-Tasks]] | Task management, to-do lists |
| [[Radios|Plugin-Radios]] | Radio streaming |
| [[Voice Activation|Plugin-VoiceActivation]] | Voice command activation |
| [[App Diagnostics|Plugin-AppDiagnostics]] | Application monitoring |

### Security & Identity Plugins

| Plugin | Description |
|--------|-------------|
| [[Passkeys|Plugin-Passkeys]] | Passkey authentication |
| [[Account Info|Plugin-AccountInfo]] | Account management |

### Advanced Plugins

| Plugin | Description |
|--------|-------------|
| [[Other Devices|Plugin-OtherDevices]] | Cross-device communication |
| [[Self-Heal|Plugin-SelfHeal]] | Self-repair and error recovery |

## Creating a Plugin

### Plugin Structure

```typescript
// Example plugin structure
import { PluginBase } from './plugin_base';

export class MyPlugin extends PluginBase {
    name: string = "my-plugin";
    version: string = "1.0.0";
    
    async initialize(): Promise<void> {
        // Setup plugin
    }
    
    async execute(command: string): Promise<any> {
        // Handle commands
    }
    
    async shutdown(): Promise<void> {
        // Cleanup
    }
}
```

### Python Plugin Example

```python
# plugins/plugin_example.py
from plugin_base import PluginBase

class ExamplePlugin(PluginBase):
    def __init__(self):
        super().__init__()
        self.name = "example"
    
    def execute(self, command):
        # Process command
        return result
```

### Registration

Plugins are automatically discovered in the `plugins/` directory. The plugin manager handles loading and initialization.

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

```typescript
// Access plugin through plugin manager
const fileSystem = pluginManager.getPlugin('file-system');
const files = await fileSystem.listDirectory('/home/user');

const camera = pluginManager.getPlugin('camera');
const photo = await camera.capture();
```

## Plugin Manager

The plugin manager (`plugin_manager/`) handles:

- **Discovery**: Finding plugins in the plugins directory
- **Loading**: Initializing plugins on startup
- **Routing**: Directing commands to appropriate plugins
- **Lifecycle**: Managing plugin state (start, stop, reload)

### Plugin Manager API

```typescript
// Get a plugin by name
getPlugin(name: string): PluginBase

// List all available plugins
listPlugins(): string[]

// Check if plugin is loaded
isPluginLoaded(name: string): boolean

// Reload a plugin
reloadPlugin(name: string): Promise<void>
```

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
