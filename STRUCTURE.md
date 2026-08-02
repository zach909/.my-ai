# Project Structure

This document describes the organized structure of the project.

## Directory Organization

### Root Level
- `README.md` - Project overview and quick start guide
- `package.json` - Node.js dependencies and scripts
- `vite.config.ts` - Vite build configuration
- `tsconfig*.json` - TypeScript configuration files
- `eslint.config.js` - ESLint configuration
- `components.json` - Shadcn/ui configuration
- `.gitignore` - Git ignore rules

### Core Directories

#### `/asi_core/`
Core ASI (Artificial Super Intelligence) components including neural core, mesh, and states.

#### `/benchmarks/`
Performance benchmarking tools for hyperdimensional, mesh, MoE, and RLM components.

#### `/config/`
Configuration files including encryption salts and assets.

#### `/desktop-app/`
Desktop application with cross-platform support.

#### `/dist/`
Distribution builds and compiled outputs.

#### `/docs/`
Comprehensive documentation:
- `architecture/` - System architecture documents
- `deployment/` - Deployment guides
- `api/` - API documentation
- `self-improvement/` - Self-improvement plans
- Root level markdown files (ARCHITECTURE.md, DEPLOYMENT.md, etc.)

#### `/extension-builder/`
Tools for building and managing extensions.

#### `/extension_system/`
Extension System: lifecycle, versioning, dependency resolution, permissions,
and content-addressable storage (with compression/quantization) for
automatically-created memory, logic, skill, and plugin extensions. See
`docs/EXTENSION_SYSTEM.md`.

#### `/interface/`
User interface components and CLI tools.

#### `/model && skills manager/`
Go-based model and skills management system with extensive submodules.

#### `/models && skills/`
JavaScript/TypeScript AI models, skills, and self-improvement modules.

#### `/plugin_manager/`
Plugin management system with SDK and registry.

#### `/plugins/`
System plugins for various functionalities (browser, camera, email, etc.).

#### `/public/`
Public assets and static files.

#### `/scripts/`
Build and utility scripts:
- `build-backend.mjs` - Backend build script
- `check-css-*.js` - CSS validation scripts
- `finalize-static-build.mjs` - Static build finalization
- `install.sh` - Installation script
- `patches/` - Various patch files

#### `/src/`
Main source code (React/TypeScript):
- `components/` - React components
- `features/` - Feature modules
- `layouts/` - Layout components
- `lib/` - Utility libraries
- `routes/` - Application routes
- `server/` - Server-side code

#### `/test/`
Test files including core tests and integration tests.

#### `/tests/`
Additional test suites:
- `security/` - Security-focused tests

#### `/wiki/`
Wiki documentation.

## Key Files

### Configuration
- `.gitignore` - Git ignore patterns
- `eslint.config.js` - Linting rules
- `tsconfig.json` - TypeScript compiler options
- `vite.config.ts` - Build tool configuration

### Documentation
- `docs/README.md` - Documentation index
- `docs/ARCHITECTURE.md` - Main architecture document
- `docs/DEPLOYMENT.md` - Deployment instructions
- `docs/SECURITY.md` - Security guidelines

### Build & Deploy
- `scripts/install.sh` - Installation script
- `scripts/build-backend.mjs` - Backend build
- `scripts/finalize-static-build.mjs` - Build finalization

## Naming Conventions

- **Directories**: lowercase with hyphens (e.g., `plugin_manager`)
- **Source files**: camelCase or PascalCase for components
- **Tests**: prefixed with `test_` or suffixed with `.test.`
- **Documentation**: UPPERCASE.md for major docs

## Module Systems

The project uses multiple module systems:
- **Node.js/CommonJS** - `.cjs`, `.mjs`
- **TypeScript** - `.ts`, `.tsx`
- **Python** - `.py`
- **Go** - `.go` (in model && skills manager)

## Best Practices

1. Keep related files together in feature-based directories
2. Use clear, descriptive names for directories and files
3. Document public APIs and complex logic
4. Write tests alongside features
5. Follow established coding conventions per language
