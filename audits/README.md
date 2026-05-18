# audits/

Point-in-time read-only diagnostic snapshots of `entuned-0.3`. Not maintained — values reflect the codebase as it stood on the date each audit was run.

These drove the 2026-05 cleanup + testing-backfill sprint. The findings have been triaged into either:
- **acted on** — code changes shipped, regression tests added (see `git log` 2026-05-17 / 2026-05-18 commits)
- **logged for later** — `../FOLLOWUPS.md`
- **intentionally preserved** — e.g. Eno-1 vs Eno-2 split, decomposer v1–v8 sweep (documented experiment surfaces; see `apps/server/src/lib/eno/README.md` and `apps/server/src/lib/decomposer/README.md`)

Treat the files here as **historical reference**. Don't update them to reflect current state — re-run a fresh audit instead if you need an up-to-date diagnostic.

## Index

| File | Date | Scope |
|---|---|---|
| [ASSESSMENT.md](ASSESSMENT.md) | 2026-05-17 | Root-level codebase audit; drove the testing-backfill sprint |
| [ASSESSMENT-eno-comparison.md](ASSESSMENT-eno-comparison.md) | 2026-05-17 | Eno-1 vs Eno-2 parallel-orchestrator deep-read |
| [ASSESSMENT-frontends.md](ASSESSMENT-frontends.md) | 2026-05-17 | player + admin + dashboard frontend audit |
| [ASSESSMENT-tier-bug.md](ASSESSMENT-tier-bug.md) | 2026-05-17 | Drill-down on the `Tier` type drifted across three files |
