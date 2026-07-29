# Project Structure

This document describes the reorganized project structure.

## Directory Layout

```
/workspace
├── apps/                    # Application directories
│   ├── desktop-app/        # Desktop application
│   ├── extension-builder/  # Extension building tools
│   └── robotic_organism/   # Robotic organism system
│
├── benchmarks/             # Performance benchmarks
│   └── results/           # Benchmark results
│
├── config/                 # Configuration files
│
├── dist/                   # Build output
│   └── build/             # Compiled artifacts
│
├── docs/                   # Documentation
│   ├── architecture/      # Architecture documents
│   ├── deployment/        # Deployment guides
│   └── guides/            # User/developer guides
│
├── interface/              # User interface components
│
├── plugins/                # Plugin system
│
├── public/                 # Public assets
│
├── scripts/                # Build and deployment scripts
│
├── src/                    # Main source code
│   ├── asi_core/          # ASI core engine
│   ├── models-skills/     # Models and skills system
│   ├── model-skills-manager/  # Model management
│   ├── plugin_manager/    # Plugin management
│   ├── blink/             # Blink components
│   ├── components/        # UI components
│   ├── features/          # Feature modules
│   ├── layouts/           # Layout components
│   ├── lib/               # Library code
│   └── routes/            # Application routes
│
├── test/                   # Test directory (legacy)
│
├── tests/                  # Test files
│
├── tools/                  # Development tools
│   └── patches/           # Patch files
│
├── types/                  # Type definitions
│   └── node-types/        # Node.js type definitions
│
├── vendor/                 # Third-party dependencies
│   ├── ollama/            # Ollama integration
│   ├── pennylane/         # PennyLane quantum ML
│   ├── typescript/        # TypeScript compiler
│   └── undici-types/      # Undici type definitions
│
├── wiki/                   # Wiki documentation
│
├── bun.lock                # Bun package lock
├── components.json         # Component configuration
├── package.json            # NPM package configuration
├── pnpm-lock.yaml         # PNPM package lock
├── tsconfig.json          # TypeScript configuration
└── vite.config.ts         # Vite build configuration
```

## Key Changes

### Documentation Consolidation
- All architecture documents moved to `docs/architecture/`
- Deployment guides moved to `docs/deployment/`
- Installation and testing guides moved to `docs/guides/`

### Source Code Organization
- `asi_core/` → `src/asi_core/`
- `plugin_manager/` → `src/plugin_manager/`
- `models && skills` → `src/models-skills/` (renamed, removed spaces)
- `model && skills manager` → `src/model-skills-manager/` (renamed, removed spaces)
- `index.ts` → `src/index.ts`

### Application Separation
- `desktop-app/`, `extension-builder/`, `robotic_organism/` → `apps/`

### Test Files
- All test files moved to `tests/`

### Tools and Patches
- Patch files moved to `tools/patches/`
- Configuration tools moved to `tools/`

### Vendor Dependencies
- Third-party directories moved to `vendor/`
- `@types/` → `types/node-types/`

### Naming Convention Fixes
- Removed spaces from directory names
- Used hyphens for multi-word names
- Consistent lowercase naming

## Migration Notes

If you have existing references to the old paths, update them:
- `models && skills/` → `src/models-skills/`
- `model && skills manager/` → `src/model-skills-manager/`
- `ARCHITECTURE.md` → `docs/architecture/ARCHITECTURE.md`
- `test/*.py` → `tests/*.py`
