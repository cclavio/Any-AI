# Frontend Agent — Any AI Phase 5

You are the frontend implementation agent for Any AI. You build the ProviderSetup UI component and integrate it into the Settings page.

## Critical Rules

- **`ANY_AI_PLAN.md` is your source of truth** — it contains the exact UI layout, component behavior, and API contracts
- **Match existing design system**: Use the existing Tailwind classes, Radix UI components, and styling patterns already in the codebase
- **Read before write**: Study the existing Settings.tsx, App.tsx, and component patterns before creating anything
- **Minimal changes**: Only create/modify what the plan requires

## Reference: Existing Frontend Files to Study

| File | Study For |
|------|-----------|
| `src/frontend/App.tsx` | Routing, page structure, overall app layout |
| `src/frontend/pages/Settings.tsx` | Current settings page (you'll add ProviderSetup here) |
| `src/frontend/api/settings.api.ts` | Existing API client pattern (you'll extend this) |
| `src/frontend/components/ui/*.tsx` | Available UI primitives (button, card, input, switch, tabs, etc.) |
| `src/frontend/ui/setting-item.tsx` | Setting item component pattern |
| `src/frontend/ui/toggle-switch.tsx` | Toggle pattern |
| `src/frontend/styles/theme.css` | Theme variables and color system |
| `src/frontend/index.css` | Global styles |

## Tasks

### Task 1: Study Existing Patterns

Read these files FIRST to understand the design language:
- `Settings.tsx` — how settings are structured, what components are used
- `settings.api.ts` — how API calls are made
- `components/ui/` — what UI primitives are available
- `App.tsx` — routing and layout

### Task 2: Extend API Client

Add to `frontend/api/settings.api.ts`:
```typescript
// Provider config API functions
export async function getProviderConfig(): Promise<ProviderConfigResponse> { ... }
export async function saveProviderConfig(config: SaveProviderRequest): Promise<SaveProviderResponse> { ... }
export async function validateApiKey(provider: string, apiKey: string): Promise<{ valid: boolean }> { ... }
export async function deleteProviderConfig(purpose: string): Promise<void> { ... }
export async function getProviderCatalog(): Promise<ProviderCatalogResponse> { ... }
```

### Task 3: Create ProviderSetup Component

Create `src/frontend/components/ProviderSetup.tsx` following the layout in `ANY_AI_PLAN.md` Frontend section:

```
┌─ Personalization ─────────────────┐
│  Assistant Name: [input field]     │
│  Wake Word:      [input field]     │
└────────────────────────────────────┘

┌─ LLM (Chat) ──────────────────────┐
│  Provider:  [dropdown]             │
│  Model:     [dropdown]             │
│  API Key:   [masked input] [Test]  │
│  Status:    ✅ Connected           │
└────────────────────────────────────┘

☐ Use same provider for vision

┌─ Vision (Camera) ─────────────────┐
│  Provider:  [dropdown]             │
│  Model:     [dropdown]             │
│  API Key:   [masked input] [Test]  │
│  Status:    ✅ Connected           │
└────────────────────────────────────┘

[Save Configuration]
```

**Behavior:**
1. On mount: Fetch `GET /api/settings/provider` + `GET /api/providers/catalog`
2. Provider dropdown: Filters model dropdown to that provider's models
3. Vision filter: Only shows models where `supportsVision: true`
4. "Use same provider" checkbox: Copies LLM config to vision, hides vision section
5. Test button: Calls `POST /api/settings/provider/validate` — shows pass/fail
6. Save button: Calls `POST /api/settings/provider` for LLM and vision separately
7. API key display: Always masked after save, never fetched back from server

### Task 4: Mount in Settings Page

Modify `frontend/pages/Settings.tsx` to include the ProviderSetup component. Place it prominently — this is the primary new feature.

### Task 5: Verify

- Settings page loads without errors
- Provider catalog populates dropdowns
- Can enter and validate an API key
- Save persists configuration
- Switching providers updates model dropdown
- "Use same provider" checkbox works correctly

## Style Guidelines

- Use existing color variables from `theme.css`
- Use existing `Card`, `Button`, `Input`, `Switch`, `Tabs` from `components/ui/`
- Match the spacing, typography, and interaction patterns of the existing Settings page
- Dark theme is default — ensure all states look good on dark backgrounds

## API Contracts

See `ANY_AI_PLAN.md` → API Endpoints → New Provider Config APIs for exact request/response shapes.

## MCP Servers to Use

- **Magic (21st.dev)**: For component inspiration and modern UI patterns if needed
- **Context7**: For React 19 patterns, Radix UI docs
