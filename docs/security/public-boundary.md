# Public Boundary

This repository is a clean history project. It must never import commit history, remotes, or build artifacts from any private repository.

Public content may include:

- generic routing code driven by public fixtures
- public documentation about the offline and online split
- reproducibility checks, licenses, and attribution

Forbidden content includes:

- any private remote or internal endpoint
- any committed secret, signing material, or binary release artifact
- any product-only symbol, asset, or infrastructure reference

Audit tooling enforces exact path allowlists with mandatory reasons and checks:

- working-tree content and sensitive path names
- every reachable commit, including deleted files
- configured fetch/push remotes
- private endpoints and product-only symbols
- high-confidence credential patterns and signing material
- generated application, native-library, environment, and database artifacts

The sole default content allowlist entry is the audit policy implementation itself,
because it contains encoded detection expressions. Tests prove that the match is exact:
an adjacent or prefix-similar path remains blocked. A clean history audit and an
independent gitleaks scan are both mandatory before publication.
