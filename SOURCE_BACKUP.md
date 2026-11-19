# Windows local7-noselect source backup

This branch backs up reviewed source, build declarations and tests. It is not a release package or a complete reproducible Windows build. The existing main baseline files are retained, with no file deletions.

The desktop ordinary-text selection guard is in `src/useDesktopTextSelection.ts` and `src/desktopTextSelection.css`, mounted by `src/DesktopApp.tsx`. Editable text, business selection, keyboard access and copy actions retain their boundaries.

The backup excludes new original/decrypted saves, real parsed archives or output, account data, credentials, installers, screenshots, generated output, and game assets or extracted data whose upload scope has not been confirmed. Account/service configuration in the reviewed update uses nonfunctional placeholders. This does not configure a login service.

There are 44 missing directly referenced build inputs, including desktop asset manifests and images, font atlases/metrics, skill/title catalogs and positions, plus required parser data. Native research modules and supporting extracted tables are also withheld. Existing baseline files are not a substitute for these newer inputs. Do not count a clone of this branch as a complete local7 App build.

Verification of the isolated update: 6 focused text-selection tests passed, using an explicitly synthetic image adapter with the real menu component. The production build, Windows web build and parser import gate failed on excluded inputs. Full frontend, parser, native EXE and mobile acceptance are not claimed for this source backup. Earlier local application test results are separate evidence.

The focused command, after installing dependencies, is:

```sh
node node_modules/vitest/vitest.mjs run --config vitest.review.config.ts
```

The existing workflow remains manual-only (`workflow_dispatch`). This backup does not authorize a release, deployment, pull request or changes to main.
