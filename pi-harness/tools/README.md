# Pi Tool Contract

Tools are registered globally by `pi-harness/package.json`. Each entry points to a versioned JSON manifest. The Node runtime maps the manifest's `handler` identifier to trusted built-in code; manifests cannot load arbitrary modules.

Effective availability is the intersection of the project and role tool assignments. A personal assistant without an explicit assignment receives only `web_fetch`. `system_command` must be explicitly assigned.

## Manifest fields

- `name`: stable function name exposed to the model.
- `version`: integer contract version.
- `description`: model-facing capability description.
- `risk`: `read`, `write`, `execute`, or `network`.
- `timeoutMs`: runtime-enforced default deadline.
- `handler`: trusted runtime handler identifier.
- `inputSchema`: JSON Schema sent to compatible model APIs.

Handlers implement `execute(input, context)` and return serializable output. The registry wraps all results as `{ ok, output|error, metadata }`, applies deadlines, and records only tool name, success, and duration in the conversation trace.

## Assignment API

- `GET /pi/tools`
- `PUT /pi/projects/:id/tools` with `{ "toolNames": ["web_fetch"] }`
- `PUT /pi/roles/:id/tools` with `{ "toolNames": ["web_fetch", "system_command"] }`
