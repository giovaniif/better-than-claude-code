# Mermaid diagrams

Completed Mermaid fences in chat automatically show a diagram. Source remains
available, ordinary code stays code, and incomplete or invalid diagrams keep
their source readable. Diagrams stay inside the thread on phones.

## Setup

```sh
yv iso up
yv iso seed
```

## Cleanup

```sh
yv iso down
```

## Recipes

### automatic-diagrams
Viewports: both
Two diagram types render automatically, the source toggle works, and regular
code and surrounding prose survive.

```sh
yv api '{"op":"session.send","sessionId":"{{sid_echo}}","text":"TEST-diagrams\n\nBefore the diagrams.\n\u0060\u0060\u0060mermaid\nflowchart LR\nA[Start] --> B[Finish]\n\u0060\u0060\u0060\nBetween diagrams.\n~~~mermaid\nsequenceDiagram\nAlice->>Bob: Hello\n~~~\n\u0060\u0060\u0060js\nconst ordinary = true;\n\u0060\u0060\u0060\nAfter the diagrams."}' --wait '{"op":"event","event":{"type":"turn_completed"}}'
yv drive 'session:{{sid_echo}}' --steps '[{"expect":"css:.mermaid img","count":2},{"eval":"[...document.querySelectorAll(\".mermaid img\")].every(i => i.complete && i.naturalWidth > 0)","equals":true},{"expect":"css:.prose","text":"Before the diagrams."},{"expect":"css:.prose","text":"After the diagrams."},{"expect":"css:pre.code","text":"const ordinary = true;"},{"shot":"automatic"},{"click":"role:button:Show source"},{"expect":"css:.mermaid pre","text":"A[Start] --> B[Finish]"},{"shot":"source"},{"click":"role:button:Show diagram"},{"expect":"css:.mermaid img","count":2},{"eval":"document.documentElement.scrollWidth <= innerWidth","equals":true},{"reload":true},{"expect":"css:.mermaid img","count":2}]'
```

### diagram-fallbacks
Viewports: both
Malformed, empty and still-open fences show source and a useful status without
breaking the answer.

```sh
yv api '{"op":"session.send","sessionId":"{{sid_claude}}","text":"TEST-fallbacks\n\n\u0060\u0060\u0060mermaid\nflowchart LR\nA --> )\n\u0060\u0060\u0060\n\u0060\u0060\u0060mermaid\n\u0060\u0060\u0060\n\u0060\u0060\u0060mermaid\nflowchart LR\nA -->"}' --wait '{"op":"event","event":{"type":"turn_completed"}}'
yv drive 'session:{{sid_claude}}' --steps '[{"expect":"css:.mermaid","text":"Could not render diagram. Source is shown below."},{"expect":"css:.mermaid pre","text":"A --> )"},{"expect":"css:.mermaid","text":"Empty Mermaid diagram."},{"expect":"css:.mermaid","text":"Waiting for the diagram to finish…"},{"expect":"css:.mermaid img","count":0},{"eval":"document.documentElement.scrollWidth <= innerWidth","equals":true},{"shot":"fallbacks"}]'
```
