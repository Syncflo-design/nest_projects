# Nest Projects

Job board for engineer-to-order work. Every job is an ERPNext **Project**; this
app puts them all on one Kanban board, from order to customer ready, and makes
each handover between people visible.

Requires `erpnext` only. No client-specific settings are hardcoded.

## What it adds

- **Job Stage** — the board's columns, in order. Each stage can name who usually
  handles it, limit who can be picked by role, and set a gate the job must pass
  before it can leave (drawing approved / QC checks complete). Eight default
  stages are seeded on a fresh site.
- **Job tab on Project** — stage, responsible person, progress (queued / in
  progress), quote no, customer PO, site, what it's held up by, plus tables for
  drawings (with revisions), materials, QC/FAT checks, payment milestones and
  the stage history.

Project's own customer, priority and expected end date (due date) are used as-is.

## Job Board (`/app/job-board`)

- One column per stage; a Project appears once it has a stage.
- Cards show job no, customer, site, due date (amber within 7 days, red when
  overdue), what it's held up by, drawing revision, materials, QC progress,
  what's ready to invoice, the responsible person and time in the stage.
- Stat tiles in the header are the filters: active, with me, held up, overdue,
  due in 7 days, to invoice. Search covers job, customer, site and person.
- **Handover:** drag a card to another column (desktop) or tap its arrow
  (phone). One dialog asks who takes it, prefilled from the stage, plus an
  optional note. The new person gets an alert; the move goes in Stage History.
- **Gates:** a job can't move forward past a stage whose gate isn't met. Moving
  back is always allowed. The same rules apply when the stage is changed on the
  Project form.
- **By Person view** (toggle next to search, remembered per browser): one
  column per person, "On it now" then "Next up" by priority and due date, each
  card tagged with its stage; held-up and overdue counts in each header; an
  Unassigned column. Stage regulars show even when idle. Dragging a card to
  another person reassigns it (alert + history row).
- Tapping a card's Queued / On it pill flips what the person is working on now.
- On phones the board shows one column per screen with chips to jump.
- Refreshes itself when any Project changes, and every minute.
